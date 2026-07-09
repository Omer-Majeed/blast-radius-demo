import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Finding, Scan, ScanRepo } from '../api/types';

export default function ScanViewPage() {
  const { id } = useParams<{ id: string }>();
  const [scan, setScan] = useState<Scan | null>(null);
  const [repos, setRepos] = useState<ScanRepo[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        const r = await api.getScan(id);
        setScan(r.scan);
        setRepos(r.repos);
        setFindings(r.findings);
        setErr(null);
        return r.scan.status;
      } catch (e: any) {
        setErr(e.message);
        return null;
      }
    };

    load().then((status) => {
      if (status === 'running' || status === 'queued') {
        pollRef.current = window.setInterval(async () => {
          const s = await load();
          if (s === 'complete' || s === 'failed') {
            if (pollRef.current) window.clearInterval(pollRef.current);
          }
        }, 2500);
      }
    });

    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [id]);

  if (err) return <div className="page"><div className="error">{err}</div></div>;
  if (!scan) return <div className="page">Loading…</div>;

  const findingsByRepo = groupBy(findings, (f) => f.repo_id);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Scan <span className="mono">{scan.id.slice(0, 8)}</span></h1>
          <div className="row">
            <div className={`pill pill-${scan.status}`}>{scan.status}</div>
            <div className="muted small">
              started {new Date(scan.created_at).toLocaleString()}
              {scan.completed_at && ` · finished ${new Date(scan.completed_at).toLocaleString()}`}
            </div>
          </div>
        </div>
        <Link to={`/scans/${scan.id}/linkages`}>
          <button className="primary">View linkages →</button>
        </Link>
      </div>
      {scan.error && <div className="error">{scan.error}</div>}

      <h2>Per-repo status</h2>
      <div className="card">
        <table className="table">
          <thead><tr><th>Repo</th><th>Status</th><th>Error</th></tr></thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r.repo_id}>
                <td className="mono small">{r.repo_id.slice(0, 8)}</td>
                <td><span className={`pill pill-${r.status}`}>{r.status}</span></td>
                <td className="small">{r.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Findings ({findings.length})</h2>
      {findings.length === 0 ? (
        <div className="muted">
          {scan.status === 'complete' ? 'No findings.' : 'Waiting for scan to complete…'}
        </div>
      ) : (
        [...findingsByRepo.entries()].map(([repoId, list]) => (
          <div className="card" key={repoId}>
            <h3 className="mono small muted">repo {repoId.slice(0, 8)} — {list.length} finding(s)</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Rule</th><th>File</th><th>Line</th><th>Snippet</th>
                  <th>Flow</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td className="mono small">{f.rule_id}</td>
                    <td className="mono small">{f.file}</td>
                    <td>{f.start_line}</td>
                    <td className="mono small ellipsis">{f.snippet}</td>
                    <td><span className={`pill pill-${f.flow_status}`}>{f.flow_status}</span></td>
                    <td>
                      {f.flow_status === 'complete' && (
                        <Link to={`/findings/${f.id}/flow`}>View flow</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(item);
  }
  return m;
}
