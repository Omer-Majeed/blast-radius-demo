// Wraps joern-parse (build CPG) and joern (run flow script).

import { execa } from 'execa';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CPG_DIR, JOERN_BIN, JOERN_FLOW_SCRIPT, JOERN_PARSE_BIN, SCAN_DIR } from '../config.js';
import { classifySink } from './sinks.js';
import { ensureNpmInstalled, hasFileDeps } from './npm.js';
import type { FlowNode, FlowPath, FlowResult, Finding } from '../types.js';

/**
 * Build the CPG for a repo if it doesn't already exist.
 *
 * npm awareness: for repos with `file:`-linked deps in their
 * package.json (our cross-repo example-repos, or npm workspaces), we
 * ensure `node_modules` is present and DO NOT exclude it from the CPG.
 * This lets Joern's JavaScriptImportResolverPass follow the symlink
 * into the linked package, resolve the import, and link the cross-file
 * call so `reachableByFlows` can cross the repo boundary.
 *
 * Non-file: repos still exclude node_modules to keep the CPG lean.
 */
export async function ensureCpg(repoId: string, repoPath: string, _scanId: string): Promise<string> {
  const cpgPath = join(CPG_DIR, `${repoId}.bin`);
  if (existsSync(cpgPath)) return cpgPath;

  mkdirSync(CPG_DIR, { recursive: true });

  const crossRepoLinked = hasFileDeps(repoPath);
  if (crossRepoLinked) {
    await ensureNpmInstalled(repoPath);
  }

  const args = ['--language', 'javascript', '--output', cpgPath, repoPath];
  const nodeModules = join(repoPath, 'node_modules');

  // Only exclude node_modules when the repo has no file: deps. When it
  // does, we need the symlinks under node_modules to remain in the CPG
  // for cross-repo import resolution.
  if (!crossRepoLinked && existsSync(nodeModules)) {
    args.push('--frontend-args', '--exclude', nodeModules);
  }

  await execa(JOERN_PARSE_BIN, args, {
    stdio: 'inherit',
    maxBuffer: 100 * 1024 * 1024,
  });
  if (!existsSync(cpgPath)) {
    throw new Error(`joern-parse did not produce ${cpgPath}`);
  }
  return cpgPath;
}

/**
 * Run the flow.sc script against a CPG and a set of findings.
 * Returns per-finding paths with sink classification already applied.
 */
export async function runFlowScript(
  cpgPath: string,
  findings: Finding[],
  scanId: string,
  repoId: string,
): Promise<FlowResult[]> {
  if (findings.length === 0) return [];

  const workDir = join(SCAN_DIR, scanId, repoId);
  mkdirSync(workDir, { recursive: true });

  const inPath = join(workDir, 'flow-input.json');
  const outPath = join(workDir, 'flow-output.json');

  const input = findings.map((f) => ({
    id: f.id,
    file: f.file,
    line: f.start_line,
  }));
  writeFileSync(inPath, JSON.stringify(input));

  await execa(
    JOERN_BIN,
    ['--script', JOERN_FLOW_SCRIPT,
     '--param', `cpgPath=${cpgPath}`,
     '--param', `findingsJson=${inPath}`,
     '--param', `outPath=${outPath}`],
    { stdio: 'inherit', maxBuffer: 200 * 1024 * 1024 },
  );

  if (!existsSync(outPath)) {
    throw new Error(`joern flow script did not produce ${outPath}`);
  }

  const rawResults = JSON.parse(readFileSync(outPath, 'utf8')) as Array<{
    finding_id: string;
    flows: Array<{ nodes: Array<{ file: string; line: number; code: string; method: string; callName: string }> }>;
  }>;

  const enriched: FlowResult[] = rawResults.map((rr) => {
    const dedupedFlows = dedupeFlowsByEndpoints(rr.flows);
    const paths: FlowPath[] = dedupedFlows.map((flow, pathIdx) => {
      const nodes: FlowNode[] = flow.nodes.map((n, nodeIdx) => ({
        id: `${rr.finding_id}-p${pathIdx}-n${nodeIdx}`,
        file: n.file,
        line: n.line,
        code: (n.code ?? '').slice(0, 500),
        method: n.method ?? '',
        call_name: n.callName ?? '',
      }));
      if (nodes.length > 0) nodes[0]!.is_source = true;

      // Terminal-node sink classification (only classifies the last node).
      //
      // Joern emits the full call expression as `code` (e.g.
      //   `res.status(201).json({ key, createdAt })`
      //   `ddb.send(new PutCommand({...}))`).
      // We test both `receiver_regex` and `argument_contains` against that
      // same string. It's a coarse match but covers our descriptors well:
      //   - `receiver_regex: "^res\\b"` matches strings starting with `res.`
      //   - `argument_contains: "PutCommand"` matches when PutCommand appears
      //     anywhere in the call expression.
      // If we later need finer disambiguation, extend flow.sc to emit
      // dedicated `receiverCode` and `argsCode` fields per node.
      let terminal: FlowPath['terminal_sink'] = null;
      const last = nodes[nodes.length - 1];
      if (last) {
        const sink = classifySink(last.call_name, last.code, last.code);
        if (sink) {
          last.is_sink = true;
          last.sink_category = sink.category;
          last.sink_label = sink.label;
          last.sink_severity = sink.severity;
          terminal = {
            id: sink.id,
            category: sink.category,
            label: sink.label,
            severity: sink.severity,
          };
        }
      }

      return { nodes, terminal_sink: terminal };
    });

    // Drop paths where source and terminal are on the same file+line
    // AND the terminal isn't a classified sink. These are Joern-IR
    // false positives — the source expression fanned out into internal
    // temps and then "sank" to itself. If a legitimate inline sink
    // (e.g. `res.json(createHash("sha1").digest())` on one line) ever
    // shows up, its terminal WILL be classified so it's preserved.
    const before = paths.length;
    const cleaned = paths.filter((p) => {
      const src = p.nodes[0];
      const term = p.nodes[p.nodes.length - 1];
      if (!src || !term) return false;
      const sameLoc = src.file === term.file && src.line === term.line;
      if (sameLoc && !p.terminal_sink) return false;
      return true;
    });
    if (before !== cleaned.length) {
      console.log(`[joern] finding ${rr.finding_id}: dropped ${before - cleaned.length} in-place path(s) (source==terminal, unclassified)`);
    }

    return { finding_id: rr.finding_id, paths: cleaned };
  });

  return enriched;
}

/**
 * Deduplicate flow paths that share the same source location AND same sink
 * location. Joern's `reachableByFlows` frequently emits multiple paths
 * between the same two endpoints — a short direct one, and longer variants
 * that route through extra intermediate nodes. For UI purposes we want the
 * most descriptive (longest) path per source→sink pair; the shorter ones
 * are strict prefixes/subsets and add no information.
 *
 * Key: "<sourceFile>:<sourceLine>-><sinkFile>:<sinkLine>"
 * Winner: flow with the most nodes.
 */
function dedupeFlowsByEndpoints<T extends { nodes: Array<{ file: string; line: number }> }>(flows: T[]): T[] {
  const bestByKey = new Map<string, T>();
  for (const f of flows) {
    if (!f.nodes || f.nodes.length === 0) continue;
    const src = f.nodes[0]!;
    const sink = f.nodes[f.nodes.length - 1]!;
    const key = `${src.file}:${src.line}->${sink.file}:${sink.line}`;
    const existing = bestByKey.get(key);
    if (!existing || f.nodes.length > existing.nodes.length) {
      bestByKey.set(key, f);
    }
  }
  return [...bestByKey.values()];
}
