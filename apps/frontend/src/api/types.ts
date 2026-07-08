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

export interface FlowPath {
  nodes: FlowNode[];
  terminal_sink: { id: string; category: string; label: string; severity: string } | null;
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
