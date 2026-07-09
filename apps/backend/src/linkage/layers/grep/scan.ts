// Recursive file walker + dispatcher for the grep layer. Each
// registered `GrepPatternModule` gets called on every file whose
// extension it supports.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { SignalKind } from '../../types.js';

export interface PatternMatch {
  kind: SignalKind;
  key: string;
  file: string;                                // repo-relative
  line: number;
  extra?: Record<string, unknown>;
}

export interface GrepPatternModule {
  id: string;
  fileExts: string[];
  // Contract: file is guaranteed to be a source file (not skipped),
  // relPath is repo-relative with forward slashes.
  scanFile(content: string, relPath: string): Array<Omit<PatternMatch, 'file'>>;
}

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo',
  '.git', '.svn', '.hg', '.idea', '.vscode',
]);

const SKIP_FILE_SUFFIXES = [
  '.d.ts',
  '.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.test.mjs',
  '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx', '.spec.mjs',
];

const SKIP_PATH_SEGMENTS = new Set(['test', 'tests', '__tests__', 'e2e']);

export async function scanRepo(
  repoPath: string,
  patterns: GrepPatternModule[],
): Promise<PatternMatch[]> {
  const allExts = new Set(patterns.flatMap((p) => p.fileExts));
  const files: string[] = [];
  walkFiles(repoPath, repoPath, allExts, files);

  const out: PatternMatch[] = [];
  for (const relPath of files) {
    const absPath = join(repoPath, relPath);
    let content: string;
    try { content = readFileSync(absPath, 'utf8'); }
    catch { continue; }

    const ext = extname(relPath).toLowerCase();
    for (const p of patterns) {
      if (!p.fileExts.includes(ext)) continue;
      for (const m of p.scanFile(content, relPath)) {
        out.push({ ...m, file: relPath });
      }
    }
  }
  return out;
}

function walkFiles(root: string, current: string, exts: Set<string>, out: string[]) {
  let entries: string[] = [];
  try { entries = readdirSync(current); } catch { return; }

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.') && name !== '.') continue;

    const abs = join(current, name);
    let st;
    try { st = statSync(abs); } catch { continue; }

    if (st.isDirectory()) {
      walkFiles(root, abs, exts, out);
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (!exts.has(ext)) continue;
      if (SKIP_FILE_SUFFIXES.some((sfx) => name.endsWith(sfx))) continue;

      const relPath = abs.slice(root.length + 1);
      if (relPath.split('/').some((p) => SKIP_PATH_SEGMENTS.has(p))) continue;

      out.push(relPath);
    }
  }
}
