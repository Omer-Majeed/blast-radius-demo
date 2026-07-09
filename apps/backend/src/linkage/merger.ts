// Pure signal-to-edge merger. Layers push atomic facts (signals);
// the merger joins them into cross-repo edges.
//
// For this iteration only `symbol-import` edges are produced:
//   symbol_def in repo A + symbol_ref in repo B (same key) →
//     edge(from=B, to=A, type=symbol-import, key=<symbol>)
//
// Adding future edge types (http-call, db-share, ...) is a matter of
// adding another `merge<Type>Edges(signals)` function and pushing its
// output into the final edges list.

import { v4 as uuid } from 'uuid';
import type { LinkageEdge, LinkageSignal } from './types.js';

export function mergeEdges(scanId: string, signals: LinkageSignal[]): LinkageEdge[] {
  return [
    ...mergeSymbolImportEdges(scanId, signals),
    // future:
    // ...mergeHttpCallEdges(scanId, signals),
    // ...mergeDbShareEdges(scanId, signals),
    // ...mergeQueuePubSubEdges(scanId, signals),
    // ...mergeResourceShareEdges(scanId, signals),
  ];
}

function mergeSymbolImportEdges(scanId: string, signals: LinkageSignal[]): LinkageEdge[] {
  const defsByKey = new Map<string, LinkageSignal[]>();
  const refsByKey = new Map<string, LinkageSignal[]>();

  for (const s of signals) {
    if (s.kind === 'symbol_def') push(defsByKey, s.key, s);
    else if (s.kind === 'symbol_ref') push(refsByKey, s.key, s);
  }

  // For each key with both a def and a ref, produce one edge per
  // (consumer_repo, definer_repo) pair. Multiple defs/refs on the
  // same key from the same pair collapse into one edge with all
  // signals attached.
  const edgesByPair = new Map<string, LinkageEdge>();

  for (const [key, defs] of defsByKey) {
    const refs = refsByKey.get(key);
    if (!refs) continue;

    for (const def of defs) {
      for (const ref of refs) {
        if (def.repo_id === ref.repo_id) continue;  // same-repo — skip
        // The edge goes: consumer (ref side) → provider (def side).
        const pairKey = `${ref.repo_id}::${def.repo_id}::symbol-import::${key}`;
        let edge = edgesByPair.get(pairKey);
        if (!edge) {
          edge = {
            edge_id: uuid(),
            scan_id: scanId,
            from_repo: ref.repo_id,
            to_repo: def.repo_id,
            type: 'symbol-import',
            key,
            source_layers: ['scip'],
            from_signals: [],
            to_signals: [],
          };
          edgesByPair.set(pairKey, edge);
        }
        edge.from_signals.push(ref);
        edge.to_signals.push(def);
      }
    }
  }

  // Deduplicate signal arrays within each edge (multiple refs at
  // different lines for the same key produce distinct signals; keep
  // them all but avoid duplicating identical rowids).
  for (const edge of edgesByPair.values()) {
    edge.from_signals = dedupe(edge.from_signals);
    edge.to_signals = dedupe(edge.to_signals);
  }

  return [...edgesByPair.values()];
}

function push<K, V>(m: Map<K, V[]>, key: K, v: V) {
  const arr = m.get(key);
  if (arr) arr.push(v); else m.set(key, [v]);
}

function dedupe(signals: LinkageSignal[]): LinkageSignal[] {
  const seen = new Set<string>();
  const out: LinkageSignal[] = [];
  for (const s of signals) {
    const id = `${s.repo_id}::${s.kind}::${s.file}::${s.line}::${s.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}
