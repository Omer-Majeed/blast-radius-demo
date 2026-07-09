import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api/client';
import type { LinkageEdge, LinkageGraphResponse } from '../api/types';

// Simple client-side layout: place repos on a circle.
function circleLayout(n: number, cx = 450, cy = 300, r = 220): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / Math.max(n, 1);
    positions.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  return positions;
}

export default function LinkageViewPage() {
  const { id: scanId } = useParams<{ id: string }>();
  const [data, setData] = useState<LinkageGraphResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<LinkageEdge | null>(null);

  // Filters
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set());
  const [fromRepo, setFromRepo] = useState<string>('');
  const [toRepo, setToRepo] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [showThirdParty, setShowThirdParty] = useState<boolean>(true);

  useEffect(() => {
    if (!scanId) return;
    api.getLinkages(scanId)
      .then((r) => {
        setData(r);
        setEnabledTypes(new Set(Object.keys(r.counts_by_type)));
      })
      .catch((e) => setErr(e.message));
  }, [scanId]);

  // Repo id → name lookup.
  const repoName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.repos ?? []) m.set(r.id, r.name);
    return m;
  }, [data]);

  // Filter edges.
  const filteredEdges = useMemo(() => {
    const edges = data?.edges ?? [];
    return edges.filter((e) => {
      if (!enabledTypes.has(e.type)) return false;
      if (fromRepo && e.from_repo !== fromRepo) return false;
      if (toRepo && e.to_repo !== toRepo) return false;
      if (search && !e.key.toLowerCase().includes(search.toLowerCase())) return false;
      if (!showThirdParty && isThirdParty(e.key)) return false;
      return true;
    });
  }, [data, enabledTypes, fromRepo, toRepo, search, showThirdParty]);

  // Which repo nodes to show: participants in the filtered edges,
  // plus everything in data.repos (so lone/unlinked repos still render).
  const repos = data?.repos ?? [];

  // Aggregate filtered edges by (from, to, type) for a cleaner graph.
  // Individual edges (one per symbol key) collapse into a single arrow
  // labeled with a count. Click → drawer with all constituent edges.
  const aggregated = useMemo(() => {
    const map = new Map<string, { from: string; to: string; type: string; edges: LinkageEdge[] }>();
    for (const e of filteredEdges) {
      const k = `${e.from_repo}::${e.to_repo}::${e.type}`;
      const existing = map.get(k);
      if (existing) existing.edges.push(e);
      else map.set(k, { from: e.from_repo, to: e.to_repo, type: e.type, edges: [e] });
    }
    return [...map.values()];
  }, [filteredEdges]);

  // React-flow node/edge conversion.
  const flowNodes: Node[] = useMemo(() => {
    const positions = circleLayout(repos.length);
    return repos.map((r, i) => ({
      id: r.id,
      position: positions[i] ?? { x: 0, y: 0 },
      data: { label: r.name },
      style: {
        border: '2px solid #111827',
        borderRadius: 8,
        padding: 10,
        background: 'white',
        fontWeight: 600,
        width: 180,
      },
      sourcePosition: 'right' as any,
      targetPosition: 'left' as any,
    }));
  }, [repos]);

  const flowEdges: Edge[] = useMemo(() => {
    return aggregated.map((agg, idx) => ({
      id: `agg-${idx}`,
      source: agg.from,
      target: agg.to,
      label: `${labelFor(agg.type)} (${agg.edges.length})`,
      labelStyle: { fontSize: 11, fontWeight: 600 },
      style: { stroke: colorFor(agg.type), strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: colorFor(agg.type) },
      data: agg,
    }));
  }, [aggregated]);

  if (err) return <div className="page"><div className="error">{err}</div></div>;
  if (!data) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Linkages</h1>
          <div className="muted small mono">scan {scanId?.slice(0, 8)} · {filteredEdges.length} / {data.edges.length} edge(s) shown</div>
        </div>
        <Link to={`/scans/${scanId}`}>← back to scan</Link>
      </div>

      {/* Filters */}
      <div className="card linkage-filters">
        <div className="row wrap">
          <div>
            <label className="muted small">Type</label>
            <div className="chip-row">
              {Object.entries(data.counts_by_type).map(([t, n]) => (
                <button
                  key={t}
                  onClick={() => toggle(setEnabledTypes, t)}
                  className={`chip ${enabledTypes.has(t) ? 'chip-active' : ''}`}
                  style={{ borderColor: colorFor(t) }}
                >
                  {labelFor(t)} <span className="muted">({n})</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="muted small">From repo</label>
            <select value={fromRepo} onChange={(e) => setFromRepo(e.target.value)}>
              <option value="">(any)</option>
              {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div>
            <label className="muted small">To repo</label>
            <select value={toRepo} onChange={(e) => setToRepo(e.target.value)}>
              <option value="">(any)</option>
              {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div>
            <label className="muted small">Search key</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="substring of symbol / path / table"
              style={{ width: 260 }}
            />
          </div>

          <label className="checkbox-row" style={{ marginTop: 20 }}>
            <input
              type="checkbox"
              checked={showThirdParty}
              onChange={(e) => setShowThirdParty(e.target.checked)}
            />
            <span className="small">Include third-party symbols (npm shared deps)</span>
          </label>
        </div>
      </div>

      {/* Graph */}
      <div className="linkage-graph-wrapper">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          onEdgeClick={(_, edge) => {
            // Show details for the first constituent edge; drawer can
            // page through them if there are multiple.
            const agg = (edge.data as { edges: LinkageEdge[] } | undefined);
            if (agg?.edges?.length) setSelectedEdge(agg.edges[0] ?? null);
          }}
        >
          <Background gap={16} />
          <Controls />
        </ReactFlow>
      </div>

      {/* Drawer */}
      {selectedEdge && (
        <EdgeDrawer
          edge={selectedEdge}
          allEdgesInPair={aggregated.find(
            (a) => a.from === selectedEdge.from_repo && a.to === selectedEdge.to_repo && a.type === selectedEdge.type,
          )?.edges ?? []}
          repoName={repoName}
          onClose={() => setSelectedEdge(null)}
          onSwitch={setSelectedEdge}
        />
      )}
    </div>
  );
}

function EdgeDrawer({
  edge, allEdgesInPair, repoName, onClose, onSwitch,
}: {
  edge: LinkageEdge;
  allEdgesInPair: LinkageEdge[];
  repoName: Map<string, string>;
  onClose: () => void;
  onSwitch: (e: LinkageEdge) => void;
}) {
  const fromName = repoName.get(edge.from_repo) ?? edge.from_repo.slice(0, 8);
  const toName = repoName.get(edge.to_repo) ?? edge.to_repo.slice(0, 8);
  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="mono small muted">{labelFor(edge.type)}</div>
          <div style={{ fontWeight: 600 }}>{fromName} → {toName}</div>
          <div className="mono small">{edge.key}</div>
        </div>
        <button onClick={onClose}>Close</button>
      </div>

      {allEdgesInPair.length > 1 && (
        <div className="chip-row">
          {allEdgesInPair.map((e) => (
            <button
              key={e.edge_id}
              onClick={() => onSwitch(e)}
              className={`chip ${e.edge_id === edge.edge_id ? 'chip-active' : ''}`}
            >
              {shortKey(e.key)}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
        <SignalList title={`From (${fromName}) — refs`} signals={edge.from_signals} />
        <SignalList title={`To (${toName}) — defs`} signals={edge.to_signals} />
      </div>

      <div className="muted small">Contributed by layers: {edge.source_layers.join(', ')}</div>
    </div>
  );
}

function SignalList({ title, signals }: { title: string; signals: LinkageEdge['from_signals'] }) {
  return (
    <div style={{ flex: 1 }}>
      <div className="muted small" style={{ marginBottom: 4 }}>{title}</div>
      {signals.length === 0 ? (
        <div className="muted small">(none)</div>
      ) : (
        <ul className="signal-list">
          {signals.map((s, i) => (
            <li key={i} className="mono small">
              <span className="muted">[{s.layer}/{s.kind}]</span>{' '}
              <span>{s.file}:{s.line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------ helpers ------------------------

function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function labelFor(t: string): string {
  return {
    'symbol-import': 'Symbol import',
    'http-call': 'HTTP call',
    'db-share': 'Shared DB',
    'queue-pub-sub': 'Queue pub/sub',
    'resource-share': 'Shared resource',
  }[t] ?? t;
}

function colorFor(t: string): string {
  return {
    'symbol-import': '#2563eb',
    'http-call': '#ea580c',
    'db-share': '#be185d',
    'queue-pub-sub': '#7c3aed',
    'resource-share': '#0891b2',
  }[t] ?? '#6b7280';
}

/**
 * Heuristic: symbol keys pointing at third-party npm packages
 * (anything that isn't a first-party path). Very rough — SCIP symbols
 * for user code look like `scip-typescript npm <pkg> <version> <file>`
 * where <pkg> is the user's package name. Anything that looks like a
 * well-known npm package (has `@types/` or is in a common list) is
 * flagged.
 *
 * For now: treat any symbol NOT starting with our fleet's package
 * prefix as third-party. Refined heuristic later.
 */
function isThirdParty(key: string): boolean {
  // Cheap filter — anything that mentions a common node module.
  const commonNpm = ['express', 'react', 'axios', 'fetch', '@aws-sdk', 'crypto', 'node:', 'typescript'];
  const low = key.toLowerCase();
  return commonNpm.some((p) => low.includes(` ${p.toLowerCase()} `) || low.includes(`/${p.toLowerCase()}/`));
}

function shortKey(k: string): string {
  const parts = k.split(/\s+/);
  if (parts.length >= 5) return parts.slice(3).join(' ').slice(0, 40);
  return k.slice(0, 40);
}
