import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Finding, FlowResult } from '../api/types';
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
        <Link to={`/scans/${finding.scan_id}`}>← back to scan</Link>
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
            </>
          )}
        </>
      )}
    </div>
  );
}
