// Public API of the linkage module. `runLinkage` orchestrates all
// layers, persists signals + edges to the DB, and returns nothing —
// consumers query the DB via routes/linkages.ts.

import { runScipLayer } from './layers/scip.js';
import { runGrepLayer } from './layers/grep/index.js';
import { mergeEdges } from './merger.js';
import { clearLinkageForScan, insertEdges, insertSignals } from './storage.js';
import type { Repo } from '../types.js';
import type { LinkageSignal } from './types.js';

export async function runLinkage(scanId: string, repos: Repo[]): Promise<void> {
  console.log(`[linkage] scan ${scanId}: ${repos.length} repo(s)`);
  clearLinkageForScan(scanId);

  // Independent layers, run serially (cheap enough). Each layer is
  // unaware of the others — grep does not "sit on top of" SCIP; both
  // feed the merger.
  const scipSignals = await runScipLayer(repos, scanId);
  const grepSignals = await runGrepLayer(repos, scanId);
  const allSignals: LinkageSignal[] = [...scipSignals, ...grepSignals];

  // Persist signals first (populates rowid so edges can reference).
  const persisted = insertSignals(allSignals);
  console.log(`[linkage] scan ${scanId}: ${persisted.length} signal(s) persisted`);

  // Compute edges and persist.
  const edges = mergeEdges(scanId, persisted);
  insertEdges(edges);
  console.log(`[linkage] scan ${scanId}: ${edges.length} edge(s) persisted`);
}
