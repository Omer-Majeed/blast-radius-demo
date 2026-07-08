import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { DB_PATH } from './config.js';
import type {
  Finding, FlowStatus, FlowResult, Repo, RepoStatus, Scan, ScanRepo, ScanStatus,
} from './types.js';

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      repo_ids TEXT NOT NULL,
      rulepack_ids TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_repos (
      scan_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      PRIMARY KEY (scan_id, repo_id)
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      snippet TEXT NOT NULL,
      message TEXT NOT NULL,
      flow_status TEXT NOT NULL DEFAULT 'pending',
      flow_error TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_findings_scan ON findings(scan_id);
    CREATE INDEX IF NOT EXISTS ix_findings_repo ON findings(repo_id);

    CREATE TABLE IF NOT EXISTS flows (
      finding_id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
}

// ---------- repos ----------

export function createRepo(name: string, path: string): Repo {
  const repo: Repo = {
    id: uuid(),
    name,
    path,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare('INSERT INTO repos (id, name, path, created_at) VALUES (?, ?, ?, ?)')
    .run(repo.id, repo.name, repo.path, repo.created_at);
  return repo;
}

export function listRepos(): Repo[] {
  return db().prepare('SELECT * FROM repos ORDER BY created_at DESC').all() as Repo[];
}

export function getRepo(id: string): Repo | null {
  return (db().prepare('SELECT * FROM repos WHERE id = ?').get(id) as Repo | undefined) ?? null;
}

export function deleteRepo(id: string): void {
  db().prepare('DELETE FROM repos WHERE id = ?').run(id);
}

// ---------- scans ----------

export function createScan(repoIds: string[], rulepackIds: string[]): Scan {
  const scan: Scan = {
    id: uuid(),
    status: 'queued',
    created_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    repo_ids: repoIds,
    rulepack_ids: rulepackIds,
  };
  const tx = db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO scans (id, status, created_at, completed_at, error, repo_ids, rulepack_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        scan.id, scan.status, scan.created_at, null, null,
        JSON.stringify(scan.repo_ids), JSON.stringify(scan.rulepack_ids),
      );
    for (const rid of repoIds) {
      db()
        .prepare('INSERT INTO scan_repos (scan_id, repo_id, status) VALUES (?, ?, ?)')
        .run(scan.id, rid, 'pending');
    }
  });
  tx();
  return scan;
}

export function getScan(id: string): Scan | null {
  const row = db().prepare('SELECT * FROM scans WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    ...row,
    repo_ids: JSON.parse(row.repo_ids),
    rulepack_ids: JSON.parse(row.rulepack_ids),
  } as Scan;
}

export function listScans(): Scan[] {
  const rows = db().prepare('SELECT * FROM scans ORDER BY created_at DESC').all() as any[];
  return rows.map((r) => ({
    ...r,
    repo_ids: JSON.parse(r.repo_ids),
    rulepack_ids: JSON.parse(r.rulepack_ids),
  })) as Scan[];
}

export function updateScanStatus(id: string, status: ScanStatus, error?: string | null): void {
  const completed = status === 'complete' || status === 'failed' ? new Date().toISOString() : null;
  db()
    .prepare('UPDATE scans SET status = ?, completed_at = ?, error = ? WHERE id = ?')
    .run(status, completed, error ?? null, id);
}

// ---------- scan_repos ----------

export function updateScanRepoStatus(
  scanId: string, repoId: string, status: RepoStatus, error?: string | null,
): void {
  db()
    .prepare('UPDATE scan_repos SET status = ?, error = ? WHERE scan_id = ? AND repo_id = ?')
    .run(status, error ?? null, scanId, repoId);
}

export function listScanRepos(scanId: string): ScanRepo[] {
  return db()
    .prepare('SELECT * FROM scan_repos WHERE scan_id = ?')
    .all(scanId) as ScanRepo[];
}

// ---------- findings ----------

export function createFinding(f: Omit<Finding, 'id' | 'flow_status' | 'flow_error'> & { id?: string }): Finding {
  const finding: Finding = {
    id: f.id ?? uuid(),
    scan_id: f.scan_id,
    repo_id: f.repo_id,
    rule_id: f.rule_id,
    severity: f.severity,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    snippet: f.snippet,
    message: f.message,
    flow_status: 'pending',
    flow_error: null,
  };
  db()
    .prepare(
      `INSERT INTO findings
        (id, scan_id, repo_id, rule_id, severity, file, start_line, end_line, snippet, message, flow_status, flow_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      finding.id, finding.scan_id, finding.repo_id, finding.rule_id, finding.severity,
      finding.file, finding.start_line, finding.end_line, finding.snippet, finding.message,
      finding.flow_status, finding.flow_error,
    );
  return finding;
}

export function listFindings(scanId: string): Finding[] {
  return db()
    .prepare('SELECT * FROM findings WHERE scan_id = ? ORDER BY repo_id, file, start_line')
    .all(scanId) as Finding[];
}

export function getFinding(id: string): Finding | null {
  return (db().prepare('SELECT * FROM findings WHERE id = ?').get(id) as Finding | undefined) ?? null;
}

export function updateFindingFlowStatus(id: string, status: FlowStatus, error?: string | null): void {
  db()
    .prepare('UPDATE findings SET flow_status = ?, flow_error = ? WHERE id = ?')
    .run(status, error ?? null, id);
}

// ---------- flows ----------

export function saveFlow(findingId: string, data: FlowResult): void {
  db()
    .prepare('INSERT OR REPLACE INTO flows (finding_id, data) VALUES (?, ?)')
    .run(findingId, JSON.stringify(data));
}

export function getFlow(findingId: string): FlowResult | null {
  const row = db()
    .prepare('SELECT data FROM flows WHERE finding_id = ?')
    .get(findingId) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as FlowResult;
}
