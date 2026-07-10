export type ScanStatus = 'queued' | 'running' | 'complete' | 'failed';
export type RepoStatus = 'pending' | 'opengrep_done' | 'cpg_done' | 'complete' | 'failed';
export type FlowStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface Repo {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export interface Scan {
  id: string;
  status: ScanStatus;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  repo_ids: string[];
  rulepack_ids: string[];
}

export interface ScanRepo {
  scan_id: string;
  repo_id: string;
  status: RepoStatus;
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
  flow_status: FlowStatus;
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
  entry_via: string;                            // e.g. "POST /artifacts"
  depth: number;
  paths: FlowPath[];                            // Joern paths in this hop's repo (each may recurse)
  stop_reason?: HopStopReason;
}

export interface LinkedConsumer {
  repo_id: string;
  repo_name: string;
  file: string;
  line: number;
  snippet: string;
  layer: 'scip' | 'grep' | 'code2dfd';
  hop_flow?: HopFlow;                           // populated by hop tracer
}

export interface LinkedConsumersEntry {
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

export interface SinkDescriptor {
  id: string;
  category: string;
  label: string;
  severity: string;
  call_name_regex: string;
  receiver_regex?: string;
  argument_contains?: string;
}

export interface Rulepack {
  id: string;
  path: string;
  label: string;
}
