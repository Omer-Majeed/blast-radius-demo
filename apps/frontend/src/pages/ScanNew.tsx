import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Repo, Rulepack } from '../api/types';

export default function ScanNewPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [rulepacks, setRulepacks] = useState<Rulepack[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    Promise.all([api.listRepos(), api.listRulepacks()])
      .then(([r, p]) => {
        setRepos(r.repos);
        setRulepacks(p.rulepacks);
        // Auto-select all rulepacks by default.
        setSelectedPacks(new Set(p.rulepacks.map((x) => x.id)));
      })
      .catch((e) => setErr(e.message));
  }, []);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const start = async () => {
    setErr(null);
    setStarting(true);
    try {
      const { scan } = await api.createScan([...selectedRepos], [...selectedPacks]);
      nav(`/scans/${scan.id}`);
    } catch (e: any) {
      setErr(e.message);
      setStarting(false);
    }
  };

  return (
    <div className="page">
      <h1>New scan</h1>

      <div className="card">
        <h3>Repos</h3>
        {repos.length === 0 ? (
          <div className="muted">No repos registered. Add some on the Repos page first.</div>
        ) : (
          repos.map((r) => (
            <label key={r.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedRepos.has(r.id)}
                onChange={() => toggle(setSelectedRepos, r.id)}
              />
              <span>{r.name}</span>
              <span className="mono small muted">{r.path}</span>
            </label>
          ))
        )}
      </div>

      <div className="card">
        <h3>Rulepacks</h3>
        {rulepacks.map((p) => (
          <label key={p.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={selectedPacks.has(p.id)}
              onChange={() => toggle(setSelectedPacks, p.id)}
            />
            <span>{p.label}</span>
            <span className="mono small muted">{p.id}</span>
          </label>
        ))}
      </div>

      {err && <div className="error">{err}</div>}
      <button
        onClick={start}
        disabled={starting || selectedRepos.size === 0 || selectedPacks.size === 0}
        className="primary"
      >
        {starting ? 'Starting…' : `Start scan (${selectedRepos.size} repo${selectedRepos.size === 1 ? '' : 's'})`}
      </button>
    </div>
  );
}
