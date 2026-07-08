import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// This file lives at apps/backend/src/config.ts — go up 3 to reach the
// project root (blast-radius-demo/). Override with BLAST_RADIUS_ROOT if
// you're running the compiled build from a different location.
export const ROOT =
  process.env.BLAST_RADIUS_ROOT
    ? resolve(process.env.BLAST_RADIUS_ROOT)
    : resolve(__dirname, '..', '..', '..');

export const RULES_DIR = resolve(ROOT, 'rules');
export const SINKS_DIR = resolve(ROOT, 'sinks');
export const DATA_DIR = resolve(ROOT, 'data');
export const DB_PATH = resolve(DATA_DIR, 'demo.db');
export const CPG_DIR = resolve(DATA_DIR, 'cpg');
export const SCAN_DIR = resolve(DATA_DIR, 'scans');

export const PORT = Number(process.env.PORT ?? 3001);

export const OPENGREP_BIN = process.env.OPENGREP_BIN ?? 'opengrep';
export const JOERN_PARSE_BIN = process.env.JOERN_PARSE_BIN ?? 'joern-parse';
export const JOERN_BIN = process.env.JOERN_BIN ?? 'joern';

export const JOERN_FLOW_SCRIPT = resolve(__dirname, 'analyzers', 'flow.sc');

// Ensure data directories exist on import.
for (const d of [DATA_DIR, CPG_DIR, SCAN_DIR]) {
  mkdirSync(d, { recursive: true });
}

// Log resolved paths on startup so misconfigurations are obvious.
// (Runs once because config.ts is imported once.)
// eslint-disable-next-line no-console
console.log('[config] ROOT      =', ROOT);
// eslint-disable-next-line no-console
console.log('[config] RULES_DIR =', RULES_DIR);
// eslint-disable-next-line no-console
console.log('[config] SINKS_DIR =', SINKS_DIR);
// eslint-disable-next-line no-console
console.log('[config] DATA_DIR  =', DATA_DIR);
