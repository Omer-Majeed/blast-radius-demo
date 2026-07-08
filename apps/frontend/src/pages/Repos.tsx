import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Repo } from '../api/types';

export default function ReposPage() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.listRepos().then((r) => setRepos(r.repos)).catch((e) => setErr(String(e.message)));
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.createRepo(name, path);
      setName(''); setPath('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this repo?')) return;
    await api.deleteRepo(id);
    await load();
  };

  return (
    <div className="page">
      <h1>Repositories</h1>

      <form onSubmit={add} className="card form-inline">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Repo label (e.g. server-1)"
          required
        />
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/absolute/path/to/repo"
          required
          style={{ flex: 1 }}
        />
        <button type="submit">Add</button>
      </form>
      {err && <div className="error">{err}</div>}

      <div className="card">
        {repos === null ? (
          <div>Loading…</div>
        ) : repos.length === 0 ? (
          <div className="muted">No repos yet. Add one above.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Path</th><th>Added</th><th></th></tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="mono small">{r.path}</td>
                  <td className="muted small">{new Date(r.created_at).toLocaleString()}</td>
                  <td><button className="danger" onClick={() => remove(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
