// SQLite ops for the linkage module. Three tables, all scoped to
// scan_id so re-scans replace their own rows without cross-scan bleed.

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { db } from '../storage.js';
import type { LinkageEdge, LinkageSignal, LayerId, SignalKind } from './types.js';

export function initLinkageSchema(d: Database.Database = db()): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS linkage_signals (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id TEXT NOT NULL,
      layer TEXT NOT NULL,
      kind TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      key TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      extra_json TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_linkage_signals_scan_key
      ON linkage_signals(scan_id, key, kind);
    CREATE INDEX IF NOT EXISTS ix_linkage_signals_scan_repo
      ON linkage_signals(scan_id, repo_id);

    CREATE TABLE IF NOT EXISTS linkage_edges (
      edge_id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      from_repo TEXT NOT NULL,
      to_repo TEXT NOT NULL,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      source_layers TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_linkage_edges_scan
      ON linkage_edges(scan_id);
    CREATE INDEX IF NOT EXISTS ix_linkage_edges_scan_type
      ON linkage_edges(scan_id, type);

    CREATE TABLE IF NOT EXISTS linkage_edge_signals (
      edge_id TEXT NOT NULL,
      signal_rowid INTEGER NOT NULL,
      side TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_linkage_edge_signals_edge
      ON linkage_edge_signals(edge_id);
  `);
}

/** Wipe all linkage data for a scan (called before writing fresh results). */
export function clearLinkageForScan(scanId: string): void {
  const d = db();
  const tx = d.transaction(() => {
    d.prepare(
      `DELETE FROM linkage_edge_signals WHERE edge_id IN (SELECT edge_id FROM linkage_edges WHERE scan_id = ?)`
    ).run(scanId);
    d.prepare('DELETE FROM linkage_edges WHERE scan_id = ?').run(scanId);
    d.prepare('DELETE FROM linkage_signals WHERE scan_id = ?').run(scanId);
  });
  tx();
}

/** Insert signals and populate their rowid so the merger can reference them. */
export function insertSignals(signals: LinkageSignal[]): LinkageSignal[] {
  if (signals.length === 0) return signals;
  const d = db();
  const stmt = d.prepare(
    `INSERT INTO linkage_signals (scan_id, layer, kind, repo_id, key, file, line, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = d.transaction(() => {
    for (const s of signals) {
      const info = stmt.run(
        s.scan_id, s.layer, s.kind, s.repo_id, s.key, s.file, s.line,
        s.extra ? JSON.stringify(s.extra) : null,
      );
      s.rowid = Number(info.lastInsertRowid);
    }
  });
  tx();
  return signals;
}

/** Persist a batch of edges + their provenance. */
export function insertEdges(edges: LinkageEdge[]): void {
  if (edges.length === 0) return;
  const d = db();
  const insEdge = d.prepare(
    `INSERT INTO linkage_edges (edge_id, scan_id, from_repo, to_repo, type, key, source_layers)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insLink = d.prepare(
    `INSERT INTO linkage_edge_signals (edge_id, signal_rowid, side) VALUES (?, ?, ?)`
  );
  const tx = d.transaction(() => {
    for (const e of edges) {
      insEdge.run(
        e.edge_id, e.scan_id, e.from_repo, e.to_repo, e.type, e.key,
        JSON.stringify(e.source_layers),
      );
      for (const s of e.from_signals) if (s.rowid != null) insLink.run(e.edge_id, s.rowid, 'from');
      for (const s of e.to_signals) if (s.rowid != null) insLink.run(e.edge_id, s.rowid, 'to');
    }
  });
  tx();
}

/** Retrieve all edges for a scan, with their referenced signals. */
export function listEdgesForScan(scanId: string): LinkageEdge[] {
  const d = db();
  const edgeRows = d.prepare(
    `SELECT edge_id, scan_id, from_repo, to_repo, type, key, source_layers
       FROM linkage_edges WHERE scan_id = ? ORDER BY type, from_repo, to_repo, key`
  ).all(scanId) as Array<Omit<LinkageEdge, 'source_layers' | 'from_signals' | 'to_signals'> & { source_layers: string }>;

  const byEdge: Record<string, LinkageEdge> = {};
  const edges: LinkageEdge[] = [];
  for (const r of edgeRows) {
    const e: LinkageEdge = {
      edge_id: r.edge_id,
      scan_id: r.scan_id,
      from_repo: r.from_repo,
      to_repo: r.to_repo,
      type: r.type as LinkageEdge['type'],
      key: r.key,
      source_layers: JSON.parse(r.source_layers),
      from_signals: [],
      to_signals: [],
    };
    byEdge[e.edge_id] = e;
    edges.push(e);
  }
  if (edges.length === 0) return edges;

  const placeholders = edges.map(() => '?').join(',');
  const linkRows = d.prepare(
    `SELECT es.edge_id, es.side, s.rowid, s.scan_id, s.layer, s.kind, s.repo_id, s.key, s.file, s.line, s.extra_json
       FROM linkage_edge_signals es
       JOIN linkage_signals s ON s.rowid = es.signal_rowid
      WHERE es.edge_id IN (${placeholders})`
  ).all(...edges.map((e) => e.edge_id)) as any[];

  for (const r of linkRows) {
    const sig: LinkageSignal = {
      rowid: r.rowid,
      scan_id: r.scan_id,
      layer: r.layer as LayerId,
      kind: r.kind as SignalKind,
      repo_id: r.repo_id,
      key: r.key,
      file: r.file,
      line: r.line,
      extra: r.extra_json ? JSON.parse(r.extra_json) : undefined,
    };
    const edge = byEdge[r.edge_id];
    if (!edge) continue;
    if (r.side === 'from') edge.from_signals.push(sig);
    else edge.to_signals.push(sig);
  }
  return edges;
}

/** Retrieve a single edge by id (with signals). */
export function getEdge(edgeId: string): LinkageEdge | null {
  const d = db();
  const r = d.prepare(
    `SELECT edge_id, scan_id, from_repo, to_repo, type, key, source_layers
       FROM linkage_edges WHERE edge_id = ?`
  ).get(edgeId) as any;
  if (!r) return null;

  const linkRows = d.prepare(
    `SELECT es.side, s.rowid, s.scan_id, s.layer, s.kind, s.repo_id, s.key, s.file, s.line, s.extra_json
       FROM linkage_edge_signals es
       JOIN linkage_signals s ON s.rowid = es.signal_rowid
      WHERE es.edge_id = ?`
  ).all(edgeId) as any[];

  const from_signals: LinkageSignal[] = [];
  const to_signals: LinkageSignal[] = [];
  for (const lr of linkRows) {
    const sig: LinkageSignal = {
      rowid: lr.rowid,
      scan_id: lr.scan_id,
      layer: lr.layer,
      kind: lr.kind,
      repo_id: lr.repo_id,
      key: lr.key,
      file: lr.file,
      line: lr.line,
      extra: lr.extra_json ? JSON.parse(lr.extra_json) : undefined,
    };
    if (lr.side === 'from') from_signals.push(sig);
    else to_signals.push(sig);
  }
  return {
    edge_id: r.edge_id,
    scan_id: r.scan_id,
    from_repo: r.from_repo,
    to_repo: r.to_repo,
    type: r.type,
    key: r.key,
    source_layers: JSON.parse(r.source_layers),
    from_signals,
    to_signals,
  };
}

/** Debug/inspect endpoint — raw signals for a scan, optionally filtered. */
export function listSignalsForScan(
  scanId: string, filter?: { layer?: LayerId; kind?: SignalKind; repo_id?: string },
): LinkageSignal[] {
  const conds = ['scan_id = ?'];
  const params: any[] = [scanId];
  if (filter?.layer) { conds.push('layer = ?'); params.push(filter.layer); }
  if (filter?.kind) { conds.push('kind = ?'); params.push(filter.kind); }
  if (filter?.repo_id) { conds.push('repo_id = ?'); params.push(filter.repo_id); }
  const rows = db().prepare(
    `SELECT rowid, scan_id, layer, kind, repo_id, key, file, line, extra_json
       FROM linkage_signals WHERE ${conds.join(' AND ')} LIMIT 5000`
  ).all(...params) as any[];
  return rows.map((r) => ({
    rowid: r.rowid,
    scan_id: r.scan_id,
    layer: r.layer,
    kind: r.kind,
    repo_id: r.repo_id,
    key: r.key,
    file: r.file,
    line: r.line,
    extra: r.extra_json ? JSON.parse(r.extra_json) : undefined,
  }));
}
