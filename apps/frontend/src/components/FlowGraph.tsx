import 'reactflow/dist/style.css';
import ReactFlow, {
  Background, Controls, MarkerType,
  type Edge, type Node,
} from 'reactflow';
import type { FlowPath } from '../api/types';

const NODE_WIDTH = 320;
const NODE_HEIGHT = 100;
const V_GAP = 140;

export default function FlowGraph({ path }: { path: FlowPath }) {
  const nodes: Node[] = path.nodes.map((n, i) => ({
    id: n.id,
    position: { x: 0, y: i * V_GAP },
    data: { label: renderLabel(n, i, path.nodes.length) },
    style: {
      width: NODE_WIDTH,
      minHeight: NODE_HEIGHT,
      padding: 10,
      borderRadius: 8,
      border: nodeBorder(n, i, path.nodes.length),
      background: nodeBg(n, i, path.nodes.length),
      textAlign: 'left',
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      fontSize: 12,
    },
    sourcePosition: 'bottom' as any,
    targetPosition: 'top' as any,
  }));

  const edges: Edge[] = [];
  for (let i = 0; i < path.nodes.length - 1; i++) {
    edges.push({
      id: `e-${path.nodes[i]!.id}-${path.nodes[i + 1]!.id}`,
      source: path.nodes[i]!.id,
      target: path.nodes[i + 1]!.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5 },
    });
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} />
      <Controls />
    </ReactFlow>
  );
}

function renderLabel(n: FlowPath['nodes'][number], i: number, total: number) {
  const tag =
    i === 0 ? 'SOURCE'
    : i === total - 1 && (n.is_sink || n.sink_category) ? `SINK · ${n.sink_label ?? n.sink_category ?? ''}`
    : i === total - 1 ? 'terminal'
    : 'step';
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, marginBottom: 4 }}>{tag}</div>
      <div style={{ fontWeight: 600 }}>{n.call_name || '(node)'}</div>
      <div style={{ opacity: 0.7 }}>{n.file}:{n.line}</div>
      <div style={{ marginTop: 6, wordBreak: 'break-all' }}>{truncate(n.code, 160)}</div>
    </div>
  );
}

function nodeBorder(n: FlowPath['nodes'][number], i: number, total: number): string {
  if (i === 0) return '2px solid #d97706';                             // amber for source
  if (i === total - 1 && n.sink_category) return '2px solid #dc2626';  // red if sink
  if (i === total - 1) return '2px solid #6b7280';                     // gray if unclassified terminal
  return '1px solid #d4d4d8';
}

function nodeBg(_n: FlowPath['nodes'][number], i: number, total: number): string {
  if (i === 0) return '#fef3c7';
  if (i === total - 1) return '#fee2e2';
  return '#ffffff';
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
