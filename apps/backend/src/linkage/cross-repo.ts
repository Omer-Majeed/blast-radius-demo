// Cross-repo attribution for finding flow terminals.
//
// Given a finding's flow terminal (file, line, sink_category), find
// which other registered repos are downstream via the linkage graph.
//
// Supported sink categories (this iteration):
//   http-out  → look up the enclosing HTTP route (nearest preceding
//               `http_route` signal in the same file) and return every
//               repo that CALLS that route (http-call edges).
//
// Deferred (contract slot exists):
//   db-out    → requires the DB grep layer to emit `db_write` signals
//               with the resolved table name.
//   queue-*   → same story for the queue grep layer.
//   symbol-*  → for findings whose enclosing method is exported, follow
//               the SCIP symbol-import edges.
//
// Everything happens as scoped SQLite queries — no re-parsing, no new
// caches. The join is pure runtime.

import { db } from '../storage.js';
import type { LayerId } from './types.js';

export interface LinkedConsumer {
  repo_id: string;
  repo_name: string;
  file: string;
  line: number;
  snippet: string;
  layer: LayerId;
}

export interface LinkedConsumersEntry {
  endpoint_key: string;                     // e.g. "POST /artifacts"
  enclosing_route: { file: string; line: number };
  consumers: LinkedConsumer[];
}

interface Terminal {
  file: string;
  line: number;
  sink_category: string | undefined;
}

export function findLinkedConsumers(
  scanId: string,
  repoId: string,
  terminal: Terminal | null,
): LinkedConsumersEntry[] {
  if (!terminal || !terminal.sink_category) return [];
  if (terminal.sink_category !== 'http-out') return [];   // http-out only for now
  if (!terminal.file || !terminal.line) return [];

  return findHttpConsumers(scanId, repoId, terminal);
}

function findHttpConsumers(
  scanId: string,
  repoId: string,
  terminal: Terminal,
): LinkedConsumersEntry[] {
  const d = db();

  // 1. Enclosing route: nearest preceding http_route signal in the
  //    same file (max line ≤ terminal.line). ORDER BY line DESC LIMIT 1
  //    gives us the closest preceding route by construction.
  const route = d.prepare(
    `SELECT key, file, line
       FROM linkage_signals
      WHERE scan_id = ?
        AND repo_id = ?
        AND kind = 'http_route'
        AND file = ?
        AND line <= ?
      ORDER BY line DESC
      LIMIT 1`
  ).get(scanId, repoId, terminal.file, terminal.line) as
    | { key: string; file: string; line: number }
    | undefined;

  if (!route) return [];

  // 2. Find http-call edges pointing at this repo with this key.
  const edges = d.prepare(
    `SELECT edge_id, from_repo
       FROM linkage_edges
      WHERE scan_id = ?
        AND type = 'http-call'
        AND to_repo = ?
        AND key = ?`
  ).all(scanId, repoId, route.key) as Array<{ edge_id: string; from_repo: string }>;

  if (edges.length === 0) return [];

  // 3. For each matching edge, fetch its `from` signals (the client-side
  //    call sites) and the from-repo name.
  const consumers: LinkedConsumer[] = [];
  const repoNameStmt = d.prepare('SELECT name FROM repos WHERE id = ?');
  const fromSigStmt = d.prepare(
    `SELECT s.layer, s.repo_id, s.file, s.line, s.extra_json
       FROM linkage_edge_signals es
       JOIN linkage_signals s ON s.rowid = es.signal_rowid
      WHERE es.edge_id = ? AND es.side = 'from'`
  );

  for (const e of edges) {
    const repoRow = repoNameStmt.get(e.from_repo) as { name: string } | undefined;
    const repoName = repoRow?.name ?? e.from_repo.slice(0, 8);

    const fromSigs = fromSigStmt.all(e.edge_id) as any[];
    for (const fs of fromSigs) {
      const extra = fs.extra_json ? safeParse(fs.extra_json) : {};
      const snippet: string =
        (extra?.snippet as string | undefined) ??
        (extra?.match as string | undefined) ??
        '';
      consumers.push({
        repo_id: fs.repo_id,
        repo_name: repoName,
        file: fs.file,
        line: fs.line,
        snippet: snippet.slice(0, 240),
        layer: fs.layer as LayerId,
      });
    }
  }

  if (consumers.length === 0) return [];

  return [
    {
      endpoint_key: route.key,
      enclosing_route: { file: route.file, line: route.line },
      consumers,
    },
  ];
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}
