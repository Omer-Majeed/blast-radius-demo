// Runs opengrep against a repo path with a set of rules. Parses JSON output.

import { execa } from 'execa';
import { OPENGREP_BIN } from '../config.js';

export interface OpengrepFinding {
  rule_id: string;
  severity: string;
  file: string;         // relative to repo root
  start_line: number;
  end_line: number;
  snippet: string;
  message: string;
}

// Opengrep's JSON schema (same as Semgrep's).
interface OgResultsEnvelope {
  results: OgResult[];
  errors?: unknown[];
}
interface OgResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    lines: string;
  };
}

/**
 * Run opengrep and parse results.
 *
 * @param repoPath absolute path to the repo
 * @param ruleConfigs array of rule paths (files or directories)
 */
export async function runOpengrep(repoPath: string, ruleConfigs: string[]): Promise<OpengrepFinding[]> {
  const args: string[] = ['scan', '--json', '--quiet', '--disable-version-check'];
  for (const rc of ruleConfigs) {
    args.push('--config', rc);
  }
  args.push(repoPath);

  const { stdout } = await execa(OPENGREP_BIN, args, {
    reject: false,
    maxBuffer: 100 * 1024 * 1024,
  });

  // If opengrep prints anything to stderr but produced output, we still parse.
  let parsed: OgResultsEnvelope;
  try {
    parsed = JSON.parse(stdout) as OgResultsEnvelope;
  } catch (e) {
    throw new Error(`opengrep JSON parse failed: ${(e as Error).message}\nstdout head: ${stdout.slice(0, 300)}`);
  }

  const findings: OpengrepFinding[] = (parsed.results ?? []).map((r) => {
    // Convert absolute path to repo-relative
    let file = r.path;
    if (file.startsWith(repoPath)) file = file.slice(repoPath.length).replace(/^\/+/, '');
    return {
      rule_id: r.check_id,
      severity: (r.extra?.severity ?? 'WARNING').toLowerCase(),
      file,
      start_line: r.start.line,
      end_line: r.end.line,
      snippet: (r.extra?.lines ?? '').trim().slice(0, 500),
      message: r.extra?.message ?? '',
    };
  });

  return findings;
}
