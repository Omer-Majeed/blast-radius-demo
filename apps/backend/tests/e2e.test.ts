// End-to-end integration tests against a running backend.
//
// Prereqs:
//   1. Backend running at http://localhost:3001 (in another terminal:
//      `npm run dev:backend`).
//   2. Opengrep + Joern installed on PATH.
//
// Run:
//   npm --workspace apps/backend run test:e2e
//
// The suite:
//   - Wipes DB state via DELETE /api/dev/reset before running.
//   - Iterates each example-repos/<case>/ scenario declared in CASES.
//   - For cross-repo cases, runs `npm install` in the entry repo first
//     so the `file:`-linked symlink is in place.
//   - Registers the repos, creates a scan, polls until complete, then
//     asserts the expected shape of findings + flows.
//
// Currently-failing cases (03-06) are marked `todo` — they document
// the cross-repo tracking gap. Flip `todo` → undefined when the fix
// lands.

import { after, before, describe, test } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// apps/backend/tests/ → blast-radius-demo/example-repos
const EXAMPLES = resolve(__dirname, '..', '..', '..', 'example-repos');

const BASE = process.env.BLAST_RADIUS_BASE ?? 'http://localhost:3001';
const API = `${BASE}/api`;

const SCAN_TIMEOUT_MS = 10 * 60 * 1000;   // 10 min per case (CPG builds are slow)
const POLL_INTERVAL_MS = 2500;

// ---------------------------------------------------------------------------
// Case configuration
// ---------------------------------------------------------------------------

type ExpectMode = 'positive' | 'negative';

interface CaseConfig {
  id: string;
  dir: string;                          // subdir of example-repos/
  register: string[];                   // subdirs of the case to register
  install?: string[];                   // subdirs to `npm install` before scan
  expect: {
    minFindings: number;
    mode: ExpectMode;                   // positive: expect classified sink; negative: expect none
    minClassifiedFlows?: number;        // origin-only: min # of classified sink flows at the finding's own path
    minClassifiedFlowsInTree?: number;  // trace-tree: min # of classified sinks anywhere in the full hop tree
    requireTerminalCallNames?: string[]; // e.g. ['json', 'send'] — at least one flow per name (origin only)
    terminalSinkCategory?: string;      // default 'http-out'
    minSymbolImportEdges?: number;      // linkage: minimum symbol-import edges expected
  };
  todo?: string;                        // if set, test is skipped with this reason
}

const CASES: CaseConfig[] = [
  {
    id: '01',
    dir: '01-same-file-cross-function',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '02',
    dir: '02-cross-file-same-repo',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '03',
    dir: '03-cross-repo-lib-consumer',
    // Register BOTH sides so opengrep scans hash-lib directly (the
    // SHA-1 lives there). Cross-repo trace continues into consumer via
    // symbol-import + through Joern's node_modules-aware CPG on consumer.
    register: ['hash-lib', 'consumer'],
    install: ['consumer'],
    expect: {
      minFindings: 1,
      mode: 'positive',
      minClassifiedFlowsInTree: 1,      // sink lives in consumer hop, not on hash-lib's own path
      minSymbolImportEdges: 1,
    },
  },
  {
    id: '04',
    dir: '04-cross-repo-two-hops',
    register: ['hash-lib', 'hash-middleware', 'consumer'],
    install: ['hash-middleware', 'consumer'],
    expect: {
      minFindings: 1,
      mode: 'positive',
      minClassifiedFlowsInTree: 1,      // sink at the far end of a 2-hop chain
      minSymbolImportEdges: 1,          // hash-lib → hash-middleware at minimum
    },
  },
  {
    id: '05',
    dir: '05-cross-repo-sink-in-lib',
    register: ['consumer', 'response-lib'],
    install: ['consumer'],
    expect: {
      minFindings: 1,
      mode: 'positive',
      // Source in consumer; sink lives in response-lib. Either:
      //   (a) Joern's node_modules-aware CPG on consumer sees res.json in the
      //       linked response-lib and classifies at origin, OR
      //   (b) trace hops into response-lib via symbol-import.
      minClassifiedFlowsInTree: 1,
    },
  },
  {
    id: '06',
    dir: '06-cross-repo-through-barrel',
    register: ['barrel-lib', 'consumer'],
    install: ['consumer'],
    expect: {
      minFindings: 1,
      mode: 'positive',
      minClassifiedFlowsInTree: 1,
      minSymbolImportEdges: 1,
    },
  },
  {
    id: '07',
    dir: '07-negative-hash-not-reaching-sink',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'negative' },
    // Joern's JS DDG conflates variables in the same handler scope —
    // it reports a taint path from `createHash("md5")` at line 7 to the
    // `res.json` at line 14, even though the res.json argument
    // structurally does not contain the digest. Real analysis-precision
    // limit, not a test-config issue. Revisit if we ever tighten
    // taint tracking (field-sensitive interprocedural).
    todo: 'Joern JS DDG false positive: method-scope variable conflation',
  },
  {
    id: '08',
    dir: '08-multi-sink-fan-out',
    register: ['repo'],
    expect: {
      minFindings: 1,
      mode: 'positive',
      minClassifiedFlows: 2,
      requireTerminalCallNames: ['json', 'send'],
    },
  },
  {
    id: '09',
    dir: '09-async-await-boundary',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '10',
    dir: '10-object-field-aggregation',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(`${init?.method ?? 'GET'} ${path}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForScanComplete(scanId: string): Promise<any> {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const details = await api<any>(`/scans/${scanId}`);
    if (details.scan.status === 'complete' || details.scan.status === 'failed') {
      return details;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`scan ${scanId} did not complete within ${SCAN_TIMEOUT_MS}ms`);
}

async function ensureInstalled(repoPath: string): Promise<void> {
  const nm = resolve(repoPath, 'node_modules');
  if (existsSync(nm)) return;
  await execa('npm', ['install', '--no-audit', '--no-fund'], { cwd: repoPath });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('example-repos e2e', () => {
  before(async () => {
    // Preflight: backend reachable?
    let healthy = false;
    try {
      const r = await fetch(`${API}/health`);
      healthy = r.ok;
    } catch { /* network error */ }
    if (!healthy) {
      throw new Error(
        `Backend not reachable at ${BASE}/api/health.\n` +
        `Start it first with:  npm run dev:backend`
      );
    }
    // Wipe DB so we start clean.
    await api('/dev/reset', { method: 'DELETE' });
  });

  for (const c of CASES) {
    test(`${c.id} — ${c.dir}`, { skip: c.todo }, async () => {
      const caseRoot = resolve(EXAMPLES, c.dir);
      ok(existsSync(caseRoot), `case dir not found: ${caseRoot}`);

      // 1. npm install for cross-repo cases so file: symlinks exist
      for (const sub of c.install ?? []) {
        const p = resolve(caseRoot, sub);
        await ensureInstalled(p);
      }

      // 2. Register repos
      const repoIds: string[] = [];
      for (const sub of c.register) {
        const path = resolve(caseRoot, sub);
        const { repo } = await api<{ repo: any }>('/repos', {
          method: 'POST',
          body: JSON.stringify({ name: `${c.id}-${sub}`, path }),
        });
        repoIds.push(repo.id);
      }

      // 3. Start scan
      const { scan } = await api<{ scan: any }>('/scans', {
        method: 'POST',
        body: JSON.stringify({ repo_ids: repoIds, rulepack_ids: ['weak-crypto'] }),
      });

      // 4. Wait for completion
      const details = await waitForScanComplete(scan.id);
      equal(details.scan.status, 'complete', `scan ended with status ${details.scan.status}` + (details.scan.error ? `: ${details.scan.error}` : ''));

      // 5. Assert findings count
      const findings = details.findings as any[];
      ok(
        findings.length >= c.expect.minFindings,
        `expected >= ${c.expect.minFindings} findings, got ${findings.length}`
      );

      // 6. Collect classified flow paths across all findings.
      //    - classifiedPaths: origin-only (paths on the finding's own flow)
      //    - classifiedInTree: walk the full trace tree (origin + all hops).
      //      Needed for cross-repo cases where the sink terminates inside
      //      a hop rather than on the origin path.
      const classifiedPaths: any[] = [];
      const terminalCallNames = new Set<string>();
      const classifiedInTree: any[] = [];
      const inTreeCategories = new Set<string>();

      function walkTreePath(path: any, findingRef: any) {
        if (path?.terminal_sink) {
          classifiedInTree.push({ finding: findingRef, path });
          inTreeCategories.add(path.terminal_sink.category);
        }
        for (const entry of path?.linked_consumers ?? []) {
          for (const consumer of entry.consumers ?? []) {
            const hop = consumer?.hop_flow;
            if (!hop) continue;
            for (const hopPath of hop.paths ?? []) {
              walkTreePath(hopPath, findingRef);
            }
          }
        }
      }

      for (const f of findings) {
        if (f.flow_status !== 'complete') continue;
        const { flow } = await api<{ flow: any }>(`/findings/${f.id}/flow`);
        if (!flow) continue;
        for (const p of flow.paths ?? []) {
          if (p.terminal_sink) {
            classifiedPaths.push({ finding: f, path: p });
            const last = p.nodes[p.nodes.length - 1];
            if (last?.call_name) terminalCallNames.add(last.call_name);
          }
          walkTreePath(p, f);
        }
      }

      // 7. Mode-specific assertions
      if (c.expect.mode === 'negative') {
        equal(
          classifiedInTree.length, 0,
          `negative case expected zero classified sinks in the trace tree, got ${classifiedInTree.length}. ` +
          `Categories seen: ${[...inTreeCategories].join(', ')}. ` +
          `Terminal call names (origin): ${[...terminalCallNames].join(', ')}`
        );
      } else {
        const wantCategory = c.expect.terminalSinkCategory ?? 'http-out';

        // Origin-only classified check (opt-in via minClassifiedFlows).
        if (c.expect.minClassifiedFlows != null) {
          const inCategory = classifiedPaths.filter((cp) => cp.path.terminal_sink.category === wantCategory);
          ok(
            inCategory.length >= c.expect.minClassifiedFlows,
            `expected >= ${c.expect.minClassifiedFlows} ORIGIN classified flow(s) with category=${wantCategory}, got ${inCategory.length}. ` +
            `All origin classified categories: ${classifiedPaths.map((cp) => cp.path.terminal_sink.category).join(', ') || '(none)'}`
          );
        }

        // Trace-tree classified check (opt-in via minClassifiedFlowsInTree).
        // Cross-repo cases use this — the sink may live in a hop.
        if (c.expect.minClassifiedFlowsInTree != null) {
          const inTreeCategory = classifiedInTree.filter((cp) => cp.path.terminal_sink.category === wantCategory);
          ok(
            inTreeCategory.length >= c.expect.minClassifiedFlowsInTree,
            `expected >= ${c.expect.minClassifiedFlowsInTree} classified flow(s) with category=${wantCategory} anywhere in trace tree, got ${inTreeCategory.length}. ` +
            `All categories in tree: ${[...inTreeCategories].join(', ') || '(none)'}`
          );
        }

        if (c.expect.requireTerminalCallNames) {
          for (const name of c.expect.requireTerminalCallNames) {
            ok(
              terminalCallNames.has(name),
              `expected at least one flow terminating at call name "${name}"; got: ${[...terminalCallNames].join(', ') || '(none)'}`
            );
          }
        }
      }

      // 8. Linkage assertions (SCIP-only for this iteration).
      if (c.expect.minSymbolImportEdges != null) {
        const linkage = await api<any>(`/scans/${scan.id}/linkages`);
        const symbolImportEdges = (linkage.edges as any[]).filter(
          (e) => e.type === 'symbol-import',
        );
        ok(
          symbolImportEdges.length >= c.expect.minSymbolImportEdges,
          `expected >= ${c.expect.minSymbolImportEdges} symbol-import edge(s), got ${symbolImportEdges.length}. ` +
            `Edge types seen: ${JSON.stringify(linkage.counts_by_type)}`,
        );
      }
    });
  }

  after(async () => {
    // Best-effort cleanup for future runs — leave nothing behind.
    try { await api('/dev/reset', { method: 'DELETE' }); } catch { /* ignore */ }
  });
});
