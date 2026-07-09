// Idempotent npm helpers used by both the taint (Joern) and linkage
// (SCIP) tracks. They're kept independent so each track can be reasoned
// about on its own — but calls are cheap on the second invocation
// because node_modules already exists.

import { execa } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ensure `node_modules` exists in a repo. No-op if `package.json` is
 * missing or `node_modules` is already there. Runs `npm install` with
 * audit + funding checks off (they slow the install and print noise).
 */
export async function ensureNpmInstalled(repoPath: string): Promise<void> {
  const pkgJson = join(repoPath, 'package.json');
  if (!existsSync(pkgJson)) return;
  if (existsSync(join(repoPath, 'node_modules'))) return;

  console.log(`[npm] installing in ${repoPath}`);
  await execa('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: repoPath,
    stdio: 'inherit',
  });
}

/**
 * Returns true if the repo's package.json declares any `file:` dep.
 * These are `file:../sibling`-style local links used to model
 * cross-repo relationships in our example-repos and (potentially) real
 * npm workspaces. When present, Joern's JS frontend needs
 * `node_modules` in the CPG so `JavaScriptImportResolverPass` can
 * resolve the linked symbols across the boundary.
 */
export function hasFileDeps(repoPath: string): boolean {
  const pkgJson = join(repoPath, 'package.json');
  if (!existsSync(pkgJson)) return false;
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(pkgJson, 'utf8'));
  } catch {
    return false;
  }
  const deps = { ...(doc.dependencies ?? {}), ...(doc.devDependencies ?? {}) };
  for (const v of Object.values(deps)) {
    if (typeof v === 'string' && v.startsWith('file:')) return true;
  }
  return false;
}
