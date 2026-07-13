import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Finding, FlowPath, FlowResult, HopStopReason, LinkedConsumersEntry } from '../api/types';

export default function TraceViewPage() {
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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Cross-repo trace</h1>
          <div className="muted small mono">
            {finding.rule_id} · {finding.file}:{finding.start_line}
          </div>
          <div className="finding-snippet mono">{finding.snippet}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to={`/findings/${finding.id}/flow`}>← back to flow</Link>
          <Link to={`/scans/${finding.scan_id}/linkages`}>linkage graph →</Link>
        </div>
      </div>

      {paths.length === 0 ? (
        <div className="muted">No flow paths for this finding.</div>
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
                {hasHopFlows(p) && (
                  <span className="pill pill-linked">{countHops(p)} hops</span>
                )}
              </button>
            ))}
          </div>

          {activePath && (
            <TraceTimeline
              rootRepoName={findingRepoName(finding)}
              rootPath={activePath}
              rootEntry={{ file: finding.file, line: finding.start_line }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Timeline rendering ──────────────────────────────────────────────

function TraceTimeline({
  rootRepoName, rootPath, rootEntry,
}: {
  rootRepoName: string;
  rootPath: FlowPath;
  rootEntry: { file: string; line: number };
}) {
  return (
    <div className="trace-timeline">
      <TraceBand
        repoName={rootRepoName}
        entry={rootEntry}
        entryVia={null}
        depth={0}
        paths={[rootPath]}
      />
    </div>
  );
}

function TraceBand({
  repoName, entry, entryVia, depth, paths, stopReason,
}: {
  repoName: string;
  entry: { file: string; line: number };
  entryVia: string | null;
  depth: number;
  paths: FlowPath[];
  stopReason?: HopStopReason;
}) {
  return (
    <div className="trace-band-wrapper" style={{ marginLeft: depth * 16 }}>
      {entryVia && (
        <div className="trace-connector">
          <span className="trace-connector-arrow">↓</span>
          <span className="mono small">{entryVia}</span>
        </div>
      )}

      <div className={`trace-band trace-band-depth-${Math.min(depth, 5)}`}>
        <div className="trace-band-header">
          <span className="trace-band-repo">{repoName}</span>
          <span className="mono small muted">
            entry: {entry.file}:{entry.line}
          </span>
          {depth > 0 && <span className="pill pill-hop-depth">depth {depth}</span>}
        </div>

        {stopReason && (
          <div className={`trace-stop trace-stop-${stopReason}`}>
            STOP — {stopReasonLabel(stopReason)}
          </div>
        )}

        {paths.length === 0 && !stopReason && (
          <div className="muted small">(no flow paths)</div>
        )}

        {paths.map((p, i) => (
          <TracePath key={i} path={p} depth={depth} />
        ))}
      </div>
    </div>
  );
}

function TracePath({ path, depth }: { path: FlowPath; depth: number }) {
  return (
    <div className="trace-path">
      <ul className="trace-nodes">
        {path.nodes.map((n, i) => (
          <li key={i} className="mono small">
            <span className="trace-node-file">{n.file}:{n.line}</span>
            <span className="trace-node-code">
              {n.call_name || truncate(n.code, 80)}
            </span>
          </li>
        ))}
      </ul>

      {path.terminal_sink && (
        <div className={`trace-terminal sink-${path.terminal_sink.category}`}>
          → <strong>{path.terminal_sink.label}</strong>
          <span className={`pill pill-sink-${path.terminal_sink.category}`}>
            {path.terminal_sink.category}
          </span>
        </div>
      )}

      {(path.linked_consumers ?? []).map((entry, i) => (
        <div key={i} className="trace-consumers">
          {entry.consumers.map((c, j) => (
            c.hop_flow ? (
              <TraceBand
                key={j}
                repoName={c.repo_name}
                entry={c.hop_flow.entry}
                entryVia={formatLinkageLabel(entry)}
                depth={depth + 1}
                paths={c.hop_flow.paths}
                stopReason={c.hop_flow.stop_reason}
              />
            ) : null
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function hasHopFlows(p: FlowPath): boolean {
  return (p.linked_consumers ?? []).some((e) =>
    e.consumers.some((c) => c.hop_flow != null),
  );
}

function countHops(p: FlowPath): number {
  let n = 0;
  const visit = (paths: FlowPath[]) => {
    for (const path of paths) {
      for (const entry of path.linked_consumers ?? []) {
        for (const c of entry.consumers) {
          if (c.hop_flow) { n++; visit(c.hop_flow.paths); }
        }
      }
    }
  };
  visit([p]);
  return n;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function stopReasonLabel(r: HopStopReason): string {
  switch (r) {
    case 'depth-reached': return 'max depth (10) reached';
    case 'cycle-detected': return 'cycle detected — already visited this repo/file/line';
    case 'no-cpg': return 'consumer repo CPG unavailable';
    case 'no-flow': return 'Joern found no reachable flow from this entry point';
    case 'error': return 'error while tracing this hop';
  }
}

/**
 * Compact human label for a cross-repo hop's "why we jumped here" annotation.
 *
 *   http-call:      "via HTTP     POST /artifacts"
 *   symbol-import:  "via import   `computeSig`()."   (someone imports us — case 03)
 *   symbol-callout: "via call to  `reply`()."         (we call something in that repo — case 05)
 */
function formatLinkageLabel(entry: LinkedConsumersEntry): string {
  if (entry.link_type === 'http-call') {
    return `via HTTP  ${entry.endpoint_key}`;
  }
  // Both symbol-* variants — strip the SCIP prefix and show only the
  // descriptor (function name / class#method). The verb differs.
  const parts = entry.endpoint_key.split(/\s+/);
  const descriptor = parts.length >= 5 ? parts.slice(4).join(' ') : entry.endpoint_key;
  if (entry.link_type === 'symbol-callout') {
    return `via call to  ${descriptor}`;
  }
  return `via import  ${descriptor}`;
}

function findingRepoName(f: Finding): string {
  // Finding record carries repo_id but not the repo's display name.
  // Show a short id-prefix; the linked hops carry real repo names.
  return `repo ${f.repo_id.slice(0, 8)}`;
}
