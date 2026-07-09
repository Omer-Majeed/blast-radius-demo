// SCIP layer for the linkage module.
//
// For each repo:
//   1. If package.json exists, ensure npm install has run (idempotent).
//   2. Run scip-typescript to produce a .scip binary per repo, cached at
//      data/scip/<repo-id>.scip.
//   3. Decode the .scip and emit LinkageSignals: `symbol_def` for
//      every occurrence with the Definition role, `symbol_ref` for
//      every non-definition occurrence. Locals (`local N`) are skipped
//      — they can't cross repos.
//
// Language scope: TypeScript only for now. Repos without a tsconfig.json
// or any .ts files get a warning and produce zero signals.

import { execa } from 'execa';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeSCIP } from '@c4312/scip';
import { ensureNpmInstalled } from '../../analyzers/npm.js';
import { DATA_DIR } from '../../config.js';
import type { LinkageSignal } from '../types.js';
import type { Repo } from '../../types.js';

const SCIP_DIR = resolve(DATA_DIR, 'scip');
const SCIP_TS_BIN = process.env.SCIP_TS_BIN ?? 'scip-typescript';

/**
 * Run the SCIP layer for a set of repos. Returns pooled signals across
 * all repos. Failures on individual repos are logged and produce zero
 * signals for that repo without aborting the whole layer.
 */
export async function runScipLayer(repos: Repo[], scanId: string): Promise<LinkageSignal[]> {
  mkdirSync(SCIP_DIR, { recursive: true });
  const all: LinkageSignal[] = [];

  for (const repo of repos) {
    try {
      if (!looksLikeTypescript(repo.path)) {
        console.warn(`[linkage/scip] ${repo.name}: no tsconfig.json / .ts files — skipping (TS-only support for now)`);
        continue;
      }
      const scipPath = await ensureScipIndex(repo);
      const signals = extractSignals(scipPath, repo, scanId);
      console.log(`[linkage/scip] ${repo.name}: ${signals.length} signal(s)`);
      all.push(...signals);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[linkage/scip] ${repo.name}: failed — ${msg}`);
      // continue with the next repo
    }
  }

  return all;
}

/**
 * Build the .scip index for a repo if it doesn't already exist. Cached
 * by repo_id so re-scans reuse the previous index.
 */
async function ensureScipIndex(repo: Repo): Promise<string> {
  const scipPath = join(SCIP_DIR, `${repo.id}.scip`);
  if (existsSync(scipPath)) return scipPath;

  await ensureNpmInstalled(repo.path);

  await execa(SCIP_TS_BIN, ['index', '--output', scipPath], {
    cwd: repo.path,
    stdio: 'inherit',
    maxBuffer: 100 * 1024 * 1024,
  });
  if (!existsSync(scipPath)) {
    throw new Error(`scip-typescript did not produce ${scipPath}`);
  }
  return scipPath;
}

/** Cheap language probe. */
function looksLikeTypescript(repoPath: string): boolean {
  if (existsSync(join(repoPath, 'tsconfig.json'))) return true;
  return anyTsFileUnder(repoPath, 4);
}

function anyTsFileUnder(dir: string, depth: number): boolean {
  if (depth < 0) return false;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (anyTsFileUnder(p, depth - 1)) return true;
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      return true;
    }
  }
  return false;
}

/**
 * Decode a .scip file and produce signals. Skips locals and empty
 * symbols. Uses SCIP's role bit 0x1 (Definition) to distinguish def
 * from ref.
 */
function extractSignals(scipPath: string, repo: Repo, scanId: string): LinkageSignal[] {
  const buf = readFileSync(scipPath);
  const idx = deserializeSCIP(buf);
  const signals: LinkageSignal[] = [];

  for (const doc of idx.documents ?? []) {
    const relPath = doc.relativePath ?? '';
    for (const occ of doc.occurrences ?? []) {
      const symbol = occ.symbol ?? '';
      if (!symbol || symbol.startsWith('local ')) continue;

      const roles = occ.symbolRoles ?? 0;
      const isDef = (roles & 0x1) === 0x1;

      const line = (occ.range?.[0] ?? 0) + 1;   // SCIP ranges are 0-indexed

      signals.push({
        scan_id: scanId,
        layer: 'scip',
        kind: isDef ? 'symbol_def' : 'symbol_ref',
        repo_id: repo.id,
        key: symbol,
        file: relPath,
        line,
      });
    }
  }
  return signals;
}
