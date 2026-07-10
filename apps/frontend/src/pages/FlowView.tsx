import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Finding, FlowResult, LinkedConsumersEntry } from '../api/types';
import FlowGraph from '../components/FlowGraph';

export default function FlowViewPage() {
  const { id } = useParams<{ id: string }>();
  const [finding, setFinding] = useState<Finding | null>(null);
  const [flow, setFlow] = useState<FlowResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pathIdx, setPathIdx] = useState(0);

  useEffect(() => {
    if (!id) return;
    api.getFlow(id)
      .then((r) => { setFinding(r.finding); setFlow(r.flow); })
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <div className="page"><div className="error">{err}</div></div>;
  if (!finding) return <div className="page">Loading…</div>;

  const paths = flow?.paths ?? [];
  const activePath = paths[pathIdx];

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Flow — <span className="mono small">{finding.rule_id}</span></h1>
          <div className="muted small mono">
            {finding.file}:{finding.start_line}
          </div>
          <div className="finding-snippet mono">{finding.snippet}</div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Link to={`/findings/${finding.id}/trace`}>See full trace →</Link>
          <Link to={`/scans/${finding.scan_id}`}>← back to scan</Link>
        </div>
      </div>

      <h2>Reachable paths ({paths.length})</h2>
      {paths.length === 0 ? (
        <div className="muted">
          Joern found no reachable flows from this finding. Either the value
          is used only locally, or the sink lies outside the CPG's coverage.
        </div>
      ) : (
        <>
          <div className="path-selector">
            {paths.map((p, i) => (
              <button
                key={i}
                className={i === pathIdx ? 'primary' : ''}
                onClick={() => setPathIdx(i)}
              >
                Path {i + 1}
                {p.terminal_sink && (
                  <span className={`pill pill-sink-${p.terminal_sink.category}`}>
                    {p.terminal_sink.category}
                  </span>
                )}
                {p.linked_consumers && p.linked_consumers.length > 0 && (
                  <span className="pill pill-linked">
                    {p.linked_consumers.reduce((n, e) => n + e.consumers.length, 0)} linked
                  </span>
                )}
                <span className="muted small">({p.nodes.length} hops)</span>
              </button>
            ))}
          </div>

          {activePath && (
            <>
              {activePath.terminal_sink ? (
                <div className={`card sink-banner sink-${activePath.terminal_sink.category}`}>
                  <strong>Terminal sink:</strong> {activePath.terminal_sink.label}
                  {' '}
                  <span className="pill pill-severity">{activePath.terminal_sink.severity}</span>
                </div>
              ) : (
                <div className="card muted">
                  Terminal sink not classified. Extend <code>sinks/*.yaml</code> to teach the
                  classifier about this call pattern.
                </div>
              )}

              <div className="flow-graph-wrapper">
                <FlowGraph path={activePath} />
              </div>

              {activePath.linked_consumers && activePath.linked_consumers.length > 0 && (
                <CrossRepoCard
                  entries={activePath.linked_consumers}
                  scanId={finding.scan_id}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function CrossRepoCard({
  entries, scanId,
}: {
  entries: LinkedConsumersEntry[];
  scanId: string;
}) {
  return (
    <div className="card cross-repo-card">
      {entries.map((entry, i) => (
        <div key={i}>
          <div className="cross-repo-header">
            Cross-repo blast radius — <code className="mono">{entry.endpoint_key}</code>
          </div>
          <div className="muted small">
            Enclosing route: <span className="mono">{entry.enclosing_route.file}:{entry.enclosing_route.line}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
              Consumed by ({entry.consumers.length}):
            </div>
            <ul className="consumer-list">
              {entry.consumers.map((c, j) => (
                <li key={j}>
                  <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{c.repo_name}</span>
                    <span className="mono small muted">{c.file}:{c.line}</span>
                    <span className="pill" style={{ marginLeft: 'auto' }}>{c.layer}</span>
                  </div>
                  {c.snippet && (
                    <div className="mono small consumer-snippet">{c.snippet}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div style={{ marginTop: 10 }}>
            <Link to={`/scans/${scanId}/linkages`} className="small">
              See in linkage graph →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
