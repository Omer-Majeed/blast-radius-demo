// Orchestrates the per-scan work: opengrep → joern-parse → joern-flow →
// classify sinks → persist findings & flows.
//
// Runs in-process, async. For a demo we don't need a real job queue.
// Concurrency is 1 repo at a time (Joern is heavy).

import {
  createFinding, getRepo, getScan, listFindings, saveFlow,
  updateFindingFlowStatus, updateScanRepoStatus, updateScanStatus,
} from './storage.js';
import { runOpengrep } from './analyzers/opengrep.js';
import { ensureCpg, runFlowScript } from './analyzers/joern.js';
import { getRulepack } from './rulepacks.js';

/**
 * Kick off a scan (fire-and-forget). Errors are captured to the scan record.
 */
export function startScan(scanId: string): void {
  // Deliberate — no `await`. Errors caught inside.
  runScan(scanId).catch((err) => {
    console.error(`scan ${scanId} failed:`, err);
    try { updateScanStatus(scanId, 'failed', String(err?.message ?? err)); } catch {}
  });
}

async function runScan(scanId: string): Promise<void> {
  const scan = getScan(scanId);
  if (!scan) throw new Error(`scan ${scanId} not found`);

  updateScanStatus(scanId, 'running');

  const ruleConfigs: string[] = [];
  for (const rpid of scan.rulepack_ids) {
    const rp = getRulepack(rpid);
    if (rp) ruleConfigs.push(rp.path);
  }
  if (ruleConfigs.length === 0) {
    updateScanStatus(scanId, 'failed', 'no valid rulepacks selected');
    return;
  }

  for (const repoId of scan.repo_ids) {
    const repo = getRepo(repoId);
    if (!repo) {
      updateScanRepoStatus(scanId, repoId, 'failed', 'repo not found');
      continue;
    }

    try {
      // 1. Opengrep — find candidate weak-crypto occurrences.
      console.log(`[scan ${scanId}] opengrep on ${repo.name}`);
      const ogFindings = await runOpengrep(repo.path, ruleConfigs);
      for (const f of ogFindings) {
        createFinding({
          scan_id: scanId,
          repo_id: repoId,
          rule_id: f.rule_id,
          severity: f.severity,
          file: f.file,
          start_line: f.start_line,
          end_line: f.end_line,
          snippet: f.snippet,
          message: f.message,
        });
      }
      updateScanRepoStatus(scanId, repoId, 'opengrep_done');
      console.log(`[scan ${scanId}] opengrep found ${ogFindings.length} finding(s) in ${repo.name}`);

      // 2. Joern CPG build (or reuse).
      const cpgPath = await ensureCpg(repoId, repo.path, scanId);
      updateScanRepoStatus(scanId, repoId, 'cpg_done');

      // 3. Joern flow analysis for every finding in this repo.
      const repoFindings = listFindings(scanId).filter((f) => f.repo_id === repoId);
      if (repoFindings.length === 0) {
        updateScanRepoStatus(scanId, repoId, 'complete');
        continue;
      }

      for (const f of repoFindings) updateFindingFlowStatus(f.id, 'running');
      const flowResults = await runFlowScript(cpgPath, repoFindings, scanId, repoId);

      const byId = new Map(flowResults.map((r) => [r.finding_id, r] as const));
      for (const f of repoFindings) {
        const fr = byId.get(f.id);
        if (fr) {
          saveFlow(f.id, fr);
          updateFindingFlowStatus(f.id, 'complete');
        } else {
          updateFindingFlowStatus(f.id, 'skipped', 'no flow data from joern');
        }
      }

      updateScanRepoStatus(scanId, repoId, 'complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scan ${scanId}] repo ${repo.name} failed:`, msg);
      updateScanRepoStatus(scanId, repoId, 'failed', msg);
      // Continue with next repo.
    }
  }

  updateScanStatus(scanId, 'complete');
  console.log(`[scan ${scanId}] complete`);
}
