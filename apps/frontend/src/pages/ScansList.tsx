import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Scan } from '../api/types';

export default function ScansListPage() {
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listScans().then((r) => setScans(r.scans)).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="page">
      <h1>Scans</h1>
      <div className="card">
        {err && <div className="error">{err}</div>}
        {scans === null ? <div>Loading…</div>
         : scans.length === 0 ? (
          <div className="muted">
            No scans yet. <Link to="/scans/new">Start one</Link>.
          </div>
         ) : (
          <table className="table">
            <thead>
              <tr><th>Scan</th><th>Status</th><th>Started</th><th>Repos</th></tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/scans/${s.id}`}>{s.id.slice(0, 8)}</Link></td>
                  <td><StatusPill status={s.status} /></td>
                  <td className="muted small">{new Date(s.created_at).toLocaleString()}</td>
                  <td>{s.repo_ids.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}
