// Grep layer entry point. Runs each registered pattern module against
// every source file of every repo. Per-repo failures are logged and
// don't abort the layer.
//
// Adding new pattern types (DB, queue, cloud resources, RPC): drop a
// file in patterns/ and add it to PATTERNS below. Everything else —
// storage, merger dispatch, frontend rendering — is layer-agnostic.

import type { Repo } from '../../../types.js';
import type { LinkageSignal } from '../../types.js';
import { httpPattern } from './patterns/http.js';
import { scanRepo } from './scan.js';

const PATTERNS = [
  httpPattern,
  // future: dbPattern, queuePattern, resourcePattern, ...
];

export async function runGrepLayer(repos: Repo[], scanId: string): Promise<LinkageSignal[]> {
  const out: LinkageSignal[] = [];

  for (const repo of repos) {
    try {
      const matches = await scanRepo(repo.path, PATTERNS);
      for (const m of matches) {
        out.push({
          scan_id: scanId,
          layer: 'grep',
          kind: m.kind,
          repo_id: repo.id,
          key: m.key,
          file: m.file,
          line: m.line,
          extra: m.extra,
        });
      }
      console.log(`[linkage/grep] ${repo.name}: ${matches.length} signal(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[linkage/grep] ${repo.name}: failed — ${msg}`);
    }
  }

  return out;
}
