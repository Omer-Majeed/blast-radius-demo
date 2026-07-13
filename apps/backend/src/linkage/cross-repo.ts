// Cross-repo attribution — two kinds of continuations:
//
//   1. Terminal-triggered (http-call, later db-share/queue-pub-sub/...)
//      Fires when a flow reaches a classified sink. Look up the
//      enclosing route (nearest preceding http_route signal) and
//      follow http-call linkage edges to consumer call sites.
//
//   2. Location-triggered (symbol-import)
//      Fires when we're inside an exported function. Look up the
//      nearest preceding symbol_def in the same file and follow
//      symbol-import linkage edges to consumer call sites.
//
// Both use the same LinkedConsumersEntry shape, discriminated by
// `link_type`. Same downstream traceHop mechanic — same shape, same
// depth cap, same cycle detection.

import { db } from '../storage.js';
import type { LinkedConsumer, LinkedConsumersEntry } from '../types.js';

// Re-export so callers of this module have a single import site. The
// canonical definitions live in `types.ts` — critically, that copy
// includes the optional `hop_flow` field the hop tracer sets.
export type { LinkedConsumer, LinkedConsumersEntry };

type LayerId = LinkedConsumer['layer'];

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

/**
 * Location-triggered lookup. Given a location inside a repo (finding
 * origin or hop entry point), find the enclosing exported function via
 * SCIP `symbol_def` signals, then follow `symbol-import` edges to
 * consumers in other repos.
 *
 * Same shape as findHttpConsumers — just a different linkage type +
 * different SQL predicate.
 */
export function findSymbolImportConsumers(
  scanId: string,
  repoId: string,
  location: { file: string; line: number },
): LinkedConsumersEntry[] {
  if (!location.file || !location.line) return [];
  const d = db();

  // 1. Nearest preceding symbol_def in the same file — the enclosing
  //    exported function's definition site.
  const def = d.prepare(
    `SELECT key, file, line
       FROM linkage_signals
      WHERE scan_id = ?
        AND repo_id = ?
        AND kind = 'symbol_def'
        AND file = ?
        AND line <= ?
      ORDER BY line DESC
      LIMIT 1`
  ).get(scanId, repoId, location.file, location.line) as
    | { key: string; file: string; line: number }
    | undefined;

  if (!def) return [];

  // 2. symbol-import edges pointing at this def.
  const edges = d.prepare(
    `SELECT edge_id, from_repo
       FROM linkage_edges
      WHERE scan_id = ?
        AND type = 'symbol-import'
        AND to_repo = ?
        AND key = ?`
  ).all(scanId, repoId, def.key) as Array<{ edge_id: string; from_repo: string }>;

  if (edges.length === 0) return [];

  // 3. Assemble consumer list (client-side call sites).
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
      link_type: 'symbol-import',
      endpoint_key: def.key,
      enclosing_route: { file: def.file, line: def.line },
      consumers,
    },
  ];
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
      link_type: 'http-call',
      endpoint_key: route.key,
      enclosing_route: { file: route.file, line: route.line },
      consumers,
    },
  ];
}

/**
 * Terminal-triggered lookup — the "callout" direction.
 *
 * If the path's terminal is a call to a symbol defined in ANOTHER
 * registered repo (i.e. an outgoing import from us), find the definer
 * location so the trace can continue into that repo's CPG.
 *
 * Direction is opposite of findSymbolImportConsumers:
 *   findSymbolImportConsumers → who imports me
 *   findImportedCallees       → what do I import and call
 *
 * The returned entries carry `link_type: 'symbol-callout'` and their
 * `consumers` array holds the DEFINER's file:line (which Joern's flow
 * script will seed as a hop entry).
 */
export function findImportedCallees(
  scanId: string,
  repoId: string,
  terminal: { file: string; line: number },
): LinkedConsumersEntry[] {
  if (!terminal.file || !terminal.line) return [];
  const d = db();

  // 1. symbol_ref signals at the terminal's exact line — the imported
  //    functions being called here.
  const refs = d.prepare(
    `SELECT DISTINCT key
       FROM linkage_signals
      WHERE scan_id = ?
        AND repo_id = ?
        AND kind = 'symbol_ref'
        AND file = ?
        AND line = ?`
  ).all(scanId, repoId, terminal.file, terminal.line) as Array<{ key: string }>;

  if (refs.length === 0) return [];

  const entries: LinkedConsumersEntry[] = [];
  const repoNameStmt = d.prepare('SELECT name FROM repos WHERE id = ?');
  const toSigStmt = d.prepare(
    `SELECT s.layer, s.repo_id, s.file, s.line, s.extra_json
       FROM linkage_edge_signals es
       JOIN linkage_signals s ON s.rowid = es.signal_rowid
      WHERE es.edge_id = ? AND es.side = 'to'`
  );

  for (const ref of refs) {
    // 2. symbol-import edges pointing FROM this repo with this symbol.
    //    Their to_repo is where the callee is defined.
    const edges = d.prepare(
      `SELECT edge_id, to_repo
         FROM linkage_edges
        WHERE scan_id = ?
          AND type = 'symbol-import'
          AND from_repo = ?
          AND key = ?`
    ).all(scanId, repoId, ref.key) as Array<{ edge_id: string; to_repo: string }>;

    if (edges.length === 0) continue;

    const consumers: LinkedConsumer[] = [];
    for (const e of edges) {
      const repoRow = repoNameStmt.get(e.to_repo) as { name: string } | undefined;
      const repoName = repoRow?.name ?? e.to_repo.slice(0, 8);
      const toSigs = toSigStmt.all(e.edge_id) as any[];
      for (const ts of toSigs) {
        const extra = ts.extra_json ? safeParse(ts.extra_json) : {};
        const snippet: string =
          (extra?.snippet as string | undefined) ??
          (extra?.match as string | undefined) ??
          '';
        consumers.push({
          repo_id: ts.repo_id,
          repo_name: repoName,
          file: ts.file,
          line: ts.line,
          snippet: snippet.slice(0, 240),
          layer: ts.layer,
        });
      }
    }

    if (consumers.length === 0) continue;

    entries.push({
      link_type: 'symbol-callout',
      endpoint_key: ref.key,
      // enclosing_route repurposed here to point at the CALLOUT site (in
      // our repo) — the terminal itself. Distinct from the consumers'
      // locations which are in the callee's repo.
      enclosing_route: { file: terminal.file, line: terminal.line },
      consumers,
    });
  }

  return entries;
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}
