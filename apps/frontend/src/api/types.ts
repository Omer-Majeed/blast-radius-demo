// Mirror of the backend's public shapes.
// Kept minimal — extend as we add fields.

export interface Repo {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export interface Scan {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  created_at: string;
  completed_at: string | null;
  error: string | null;
  repo_ids: string[];
  rulepack_ids: string[];
}

export interface ScanRepo {
  scan_id: string;
  repo_id: string;
  status: 'pending' | 'opengrep_done' | 'cpg_done' | 'complete' | 'failed';
  error: string | null;
}

export interface Finding {
  id: string;
  scan_id: string;
  repo_id: string;
  rule_id: string;
  severity: string;
  file: string;
  start_line: number;
  end_line: number;
  snippet: string;
  message: string;
  flow_status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  flow_error: string | null;
}

export interface FlowNode {
  id: string;
  file: string;
  line: number;
  code: string;
  method: string;
  call_name: string;
  is_source?: boolean;
  is_sink?: boolean;
  sink_category?: string;
  sink_label?: string;
  sink_severity?: string;
}

export type HopStopReason =
  | 'depth-reached'
  | 'cycle-detected'
  | 'no-cpg'
  | 'no-flow'
  | 'error';

export interface HopFlow {
  repo_id: string;
  repo_name: string;
  entry: { file: string; line: number };
  entry_via: string;
  depth: number;
  paths: FlowPath[];
  stop_reason?: HopStopReason;
}

export interface LinkedConsumer {
  repo_id: string;
  repo_name: string;
  file: string;
  line: number;
  snippet: string;
  layer: 'scip' | 'grep' | 'code2dfd';
  hop_flow?: HopFlow;
}

export type LinkType = 'http-call' | 'symbol-import';

export interface LinkedConsumersEntry {
  link_type: LinkType;
  endpoint_key: string;
  enclosing_route: { file: string; line: number };
  consumers: LinkedConsumer[];
}

export interface FlowPath {
  nodes: FlowNode[];
  terminal_sink: { id: string; category: string; label: string; severity: string } | null;
  linked_consumers?: LinkedConsumersEntry[];
}

export interface FlowResult {
  finding_id: string;
  paths: FlowPath[];
}

export interface Rulepack {
  id: string;
  path: string;
  label: string;
}

export interface SinkDescriptor {
  id: string;
  category: string;
  label: string;
  severity: string;
  call_name_regex: string;
  receiver_regex?: string;
  argument_contains?: string;
}

// ---------- Linkage ----------

export type LayerId = 'scip' | 'grep' | 'code2dfd';
export type EdgeType =
  | 'symbol-import'
  | 'http-call'
  | 'db-share'
  | 'queue-pub-sub'
  | 'resource-share';
export type SignalKind =
  | 'symbol_def'
  | 'symbol_ref'
  | 'http_route'
  | 'http_call'
  | 'db_write'
  | 'db_read'
  | 'queue_pub'
  | 'queue_sub'
  | 'resource_ref';

export interface LinkageSignal {
  rowid?: number;
  scan_id: string;
  layer: LayerId;
  kind: SignalKind;
  repo_id: string;
  key: string;
  file: string;
  line: number;
  extra?: Record<string, unknown>;
}

export interface LinkageEdge {
  edge_id: string;
  scan_id: string;
  from_repo: string;
  to_repo: string;
  type: EdgeType;
  key: string;
  source_layers: LayerId[];
  from_signals: LinkageSignal[];
  to_signals: LinkageSignal[];
}

export interface LinkageGraphResponse {
  edges: LinkageEdge[];
  repos: Array<{ id: string; name: string }>;
  counts_by_type: Record<string, number>;
}
