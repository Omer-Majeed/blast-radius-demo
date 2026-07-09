// End-to-end integration tests against a running backend.
//
// Prereqs:
//   1. Backend running at http://localhost:3001 (in another terminal:
//      `npm run dev:backend`).
//   2. Opengrep + Joern installed on PATH.
//
// Run:
//   npm --workspace apps/backend run test:e2e
//
// The suite:
//   - Wipes DB state via DELETE /api/dev/reset before running.
//   - Iterates each example-repos/<case>/ scenario declared in CASES.
//   - For cross-repo cases, runs `npm install` in the entry repo first
//     so the `file:`-linked symlink is in place.
//   - Registers the repos, creates a scan, polls until complete, then
//     asserts the expected shape of findings + flows.
//
// Currently-failing cases (03-06) are marked `todo` — they document
// the cross-repo tracking gap. Flip `todo` → undefined when the fix
// lands.

import { after, before, describe, test } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// apps/backend/tests/ → blast-radius-demo/example-repos
const EXAMPLES = resolve(__dirname, '..', '..', '..', 'example-repos');

const BASE = process.env.BLAST_RADIUS_BASE ?? 'http://localhost:3001';
const API = `${BASE}/api`;

const SCAN_TIMEOUT_MS = 10 * 60 * 1000;   // 10 min per case (CPG builds are slow)
const POLL_INTERVAL_MS = 2500;

// ---------------------------------------------------------------------------
// Case configuration
// ---------------------------------------------------------------------------

type ExpectMode = 'positive' | 'negative';

interface CaseConfig {
  id: string;
  dir: string;                          // subdir of example-repos/
  register: string[];                   // subdirs of the case to register
  install?: string[];                   // subdirs to `npm install` before scan
  expect: {
    minFindings: number;
    mode: ExpectMode;                   // positive: expect classified sink; negative: expect none
    minClassifiedFlows?: number;        // minimum # of classified sink flows across findings
    requireTerminalCallNames?: string[]; // e.g. ['json', 'send'] — at least one flow per name
    terminalSinkCategory?: string;      // default 'http-out'
    minSymbolImportEdges?: number;      // linkage: minimum symbol-import edges expected
  };
  todo?: string;                        // if set, test is skipped with this reason
}

const CASES: CaseConfig[] = [
  {
    id: '01',
    dir: '01-same-file-cross-function',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '02',
    dir: '02-cross-file-same-repo',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '03',
    dir: '03-cross-repo-lib-consumer',
    register: ['consumer'],
    install: ['consumer'],
    // SCIP layer should see @demo/hash-lib def in consumer's linked
    // node_modules and the ref in consumer/src/index.ts.
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1, minSymbolImportEdges: 1 },
  },
  {
    id: '04',
    dir: '04-cross-repo-two-hops',
    register: ['consumer'],
    install: ['hash-middleware', 'consumer'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '05',
    dir: '05-cross-repo-sink-in-lib',
    register: ['consumer'],
    install: ['consumer'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '06',
    dir: '06-cross-repo-through-barrel',
    register: ['consumer'],
    install: ['consumer'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '07',
    dir: '07-negative-hash-not-reaching-sink',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'negative' },
  },
  {
    id: '08',
    dir: '08-multi-sink-fan-out',
    register: ['repo'],
    expect: {
      minFindings: 1,
      mode: 'positive',
      minClassifiedFlows: 2,
      requireTerminalCallNames: ['json', 'send'],
    },
  },
  {
    id: '09',
    dir: '09-async-await-boundary',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
  {
    id: '10',
    dir: '10-object-field-aggregation',
    register: ['repo'],
    expect: { minFindings: 1, mode: 'positive', minClassifiedFlows: 1 },
  },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(`${init?.method ?? 'GET'} ${path}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForScanComplete(scanId: string): Promise<any> {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const details = await api<any>(`/scans/${scanId}`);
    if (details.scan.status === 'complete' || details.scan.status === 'failed') {
      return details;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`scan ${scanId} did not complete within ${SCAN_TIMEOUT_MS}ms`);
}

async function ensureInstalled(repoPath: string): Promise<void> {
  const nm = resolve(repoPath, 'node_modules');
  if (existsSync(nm)) return;
  await execa('npm', ['install', '--no-audit', '--no-fund'], { cwd: repoPath });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('example-repos e2e', () => {
  before(async () => {
    // Preflight: backend reachable?
    let healthy = false;
    try {
      const r = await fetch(`${API}/health`);
      healthy = r.ok;
    } catch { /* network error */ }
    if (!healthy) {
      throw new Error(
        `Backend not reachable at ${BASE}/api/health.\n` +
        `Start it first with:  npm run dev:backend`
      );
    }
    // Wipe DB so we start clean.
    await api('/dev/reset', { method: 'DELETE' });
  });

  for (const c of CASES) {
    test(`${c.id} — ${c.dir}`, { skip: c.todo }, async () => {
      const caseRoot = resolve(EXAMPLES, c.dir);
      ok(existsSync(caseRoot), `case dir not found: ${caseRoot}`);

      // 1. npm install for cross-repo cases so file: symlinks exist
      for (const sub of c.install ?? []) {
        const p = resolve(caseRoot, sub);
        await ensureInstalled(p);
      }

      // 2. Register repos
      const repoIds: string[] = [];
      for (const sub of c.register) {
        const path = resolve(caseRoot, sub);
        const { repo } = await api<{ repo: any }>('/repos', {
          method: 'POST',
          body: JSON.stringify({ name: `${c.id}-${sub}`, path }),
        });
        repoIds.push(repo.id);
      }

      // 3. Start scan
      const { scan } = await api<{ scan: any }>('/scans', {
        method: 'POST',
        body: JSON.stringify({ repo_ids: repoIds, rulepack_ids: ['weak-crypto'] }),
      });

      // 4. Wait for completion
      const details = await waitForScanComplete(scan.id);
      equal(details.scan.status, 'complete', `scan ended with status ${details.scan.status}` + (details.scan.error ? `: ${details.scan.error}` : ''));

      // 5. Assert findings count
      const findings = details.findings as any[];
      ok(
        findings.length >= c.expect.minFindings,
        `expected >= ${c.expect.minFindings} findings, got ${findings.length}`
      );

      // 6. Collect classified flow paths across all findings
      const classifiedPaths: any[] = [];
      const terminalCallNames = new Set<string>();
      for (const f of findings) {
        if (f.flow_status !== 'complete') continue;
        const { flow } = await api<{ flow: any }>(`/findings/${f.id}/flow`);
        if (!flow) continue;
        for (const p of flow.paths ?? []) {
          if (p.terminal_sink) {
            classifiedPaths.push({ finding: f, path: p });
            const last = p.nodes[p.nodes.length - 1];
            if (last?.call_name) terminalCallNames.add(last.call_name);
          }
        }
      }

      // 7. Mode-specific assertions
      if (c.expect.mode === 'negative') {
        equal(
          classifiedPaths.length, 0,
          `negative case expected zero classified sinks, got ${classifiedPaths.length}. ` +
          `Terminal call names: ${[...terminalCallNames].join(', ')}`
        );
      } else {
        const wantCategory = c.expect.terminalSinkCategory ?? 'http-out';
        const inCategory = classifiedPaths.filter((cp) => cp.path.terminal_sink.category === wantCategory);
        const minFlows = c.expect.minClassifiedFlows ?? 1;
        ok(
          inCategory.length >= minFlows,
          `expected >= ${minFlows} classified flow(s) with category=${wantCategory}, got ${inCategory.length}. ` +
          `All classified terminal categories: ${classifiedPaths.map((cp) => cp.path.terminal_sink.category).join(', ') || '(none)'}`
        );
        if (c.expect.requireTerminalCallNames) {
          for (const name of c.expect.requireTerminalCallNames) {
            ok(
              terminalCallNames.has(name),
              `expected at least one flow terminating at call name "${name}"; got: ${[...terminalCallNames].join(', ') || '(none)'}`
            );
          }
        }
      }

      // 8. Linkage assertions (SCIP-only for this iteration).
      if (c.expect.minSymbolImportEdges != null) {
        const linkage = await api<any>(`/scans/${scan.id}/linkages`);
        const symbolImportEdges = (linkage.edges as any[]).filter(
          (e) => e.type === 'symbol-import',
        );
        ok(
          symbolImportEdges.length >= c.expect.minSymbolImportEdges,
          `expected >= ${c.expect.minSymbolImportEdges} symbol-import edge(s), got ${symbolImportEdges.length}. ` +
            `Edge types seen: ${JSON.stringify(linkage.counts_by_type)}`,
        );
      }
    });
  }

  after(async () => {
    // Best-effort cleanup for future runs — leave nothing behind.
    try { await api('/dev/reset', { method: 'DELETE' }); } catch { /* ignore */ }
  });
});
