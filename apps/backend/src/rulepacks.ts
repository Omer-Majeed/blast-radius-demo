import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RULES_DIR } from './config.js';
import type { Rulepack } from './types.js';

/**
 * A "rulepack" is a subdirectory under rules/ containing one or more
 * opengrep .yaml/.yml rule files. e.g. rules/weak-crypto/{sha1,md5}.yaml
 * becomes rulepack `weak-crypto`.
 */
export function listRulepacks(): Rulepack[] {
  let entries: string[] = [];
  try { entries = readdirSync(RULES_DIR); } catch { return []; }
  const packs: Rulepack[] = [];
  for (const name of entries) {
    const full = join(RULES_DIR, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    packs.push({
      id: name,
      path: full,
      label: humanize(name),
    });
  }
  return packs;
}

export function getRulepack(id: string): Rulepack | null {
  return listRulepacks().find((r) => r.id === id) ?? null;
}

function humanize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
