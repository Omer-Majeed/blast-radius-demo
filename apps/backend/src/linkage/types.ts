// Public types for the linkage module. Each layer produces atomic
// `LinkageSignal`s; the merger joins them on `key` into `LinkageEdge`s.

export type LayerId = 'scip' | 'grep' | 'code2dfd';
export type EdgeType = 'symbol-import' | 'http-call' | 'db-share' | 'queue-pub-sub' | 'resource-share';

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
  rowid?: number;          // populated after DB insert
  scan_id: string;
  layer: LayerId;
  kind: SignalKind;
  repo_id: string;
  key: string;             // join key: symbol string, "METHOD /path", table name, ARN, etc.
  file: string;            // repo-relative
  line: number;
  extra?: Record<string, unknown>;
}

export interface LinkageEdge {
  edge_id: string;
  scan_id: string;
  from_repo: string;       // the CONSUMER side (e.g. imports the symbol)
  to_repo: string;         // the DEFINER / PROVIDER side
  type: EdgeType;
  key: string;
  source_layers: LayerId[];
  from_signals: LinkageSignal[];
  to_signals: LinkageSignal[];
}
