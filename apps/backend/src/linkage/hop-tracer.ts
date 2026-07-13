// Cross-CPG hop tracer.
//
// After the linkage graph is built, this walks every finding's flow and,
// for each classified terminal that has cross-repo consumers, invokes
// Joern's flow analysis in the CONSUMER's CPG starting at the consumer's
// call site. The returned hop flow is embedded on the consumer inside
// the finding's flow blob. Repeat recursively up to MAX_HOP_DEPTH, with
// cycle detection.
//
// Runs during scan-runner AFTER linkage, BEFORE the scan is marked
// complete. So by the time the frontend reads `/api/findings/:id/flow`,
// the full trace tree is already in the DB.

import { v4 as uuid } from 'uuid';
import { ensureCpg, runFlowScript } from '../analyzers/joern.js';
import {
  getFlow, getRepo, listFindings, saveFlow,
} from '../storage.js';
import { classifySink } from '../analyzers/sinks.js';
import {
  findImportedCallees, findLinkedConsumers, findSymbolImportConsumers,
} from './cross-repo.js';
import type {
  Finding, FlowNode, FlowPath, FlowResult, HopFlow, HopStopReason, LinkedConsumer,
} from '../types.js';

const MAX_HOP_DEPTH = 10;

/**
 * Enrich every finding's flow in this scan with cross-repo attribution
 * (`linked_consumers`) and per-consumer hop flows (`hop_flow`). Persists
 * the enriched flow back to the DB.
 */
export async function traceAllHops(scanId: string): Promise<void> {
  const findings = listFindings(scanId);
  const eligible = findings.filter((f) => f.flow_status === 'complete');
  console.log(`[hop-tracer] scan ${scanId}: ${eligible.length} finding(s) to enrich`);

  for (const finding of eligible) {
    const flow = getFlow(finding.id);
    if (!flow) continue;
    try {
      const enriched = await enrichFlow(scanId, finding, flow);
      saveFlow(finding.id, enriched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hop-tracer] finding ${finding.id}: ${msg}`);
    }
  }
}

async function enrichFlow(
  scanId: string,
  finding: Finding,
  flow: FlowResult,
): Promise<FlowResult> {
  const initialVisited = new Set<string>([
    visitedKey(finding.repo_id, finding.file, finding.start_line),
  ]);
  const entryLocation = { file: finding.file, line: finding.start_line };

  const enrichedPaths: FlowPath[] = [];
  for (const path of flow.paths) {
    enrichedPaths.push(
      await enrichPath(scanId, finding.repo_id, entryLocation, path, 0, initialVisited),
    );
  }
  return { ...flow, paths: enrichedPaths };
}

/**
 * Attach linked_consumers + recursive hop_flows to a path. Combines
 * two linkage triggers:
 *
 *   - Terminal-triggered:  http-call (via classified sink at terminal)
 *   - Location-triggered:  symbol-import (via enclosing exported function
 *                          at the flow's ENTRY location — finding.line or
 *                          hop entry line)
 *
 * `entryLocation` is where THIS flow started. For the origin finding
 * it's `finding.file:finding.start_line`. For a hop, it's the
 * consumer's call site. Symbol-import fires when that entry sits
 * inside an exported function this repo hosts.
 */
async function enrichPath(
  scanId: string,
  repoId: string,
  entryLocation: { file: string; line: number },
  path: FlowPath,
  parentDepth: number,
  visited: Set<string>,
): Promise<FlowPath> {
  const terminal = path.nodes[path.nodes.length - 1];

  // Terminal-triggered (http-call today; more sink categories later).
  const httpEntries = findLinkedConsumers(scanId, repoId, {
    file: terminal?.file ?? '',
    line: terminal?.line ?? 0,
    sink_category: path.terminal_sink?.category,
  });

  // Location-triggered (SCIP symbol-import): "someone imports what I define."
  const symbolEntries = findSymbolImportConsumers(scanId, repoId, entryLocation);

  // Terminal-triggered (SCIP symbol-callout): "I call something defined
  // elsewhere; continue the trace in that callee's repo."
  const calloutEntries = findImportedCallees(scanId, repoId, {
    file: terminal?.file ?? '',
    line: terminal?.line ?? 0,
  });

  const allEntries = [...httpEntries, ...symbolEntries, ...calloutEntries];
  if (allEntries.length === 0) return path;

  for (const entry of allEntries) {
    for (const consumer of entry.consumers) {
      consumer.hop_flow = await traceHop(
        scanId,
        entry.endpoint_key,
        consumer,
        parentDepth + 1,
        new Set(visited),
      );
    }
  }
  return { ...path, linked_consumers: allEntries };
}

/**
 * Run Joern flow analysis inside the consumer's CPG starting at the
 * consumer's call site line. Recursively enriches each resulting path
 * with linked_consumers + hop_flows until MAX_HOP_DEPTH or a cycle.
 */
async function traceHop(
  scanId: string,
  entryVia: string,
  consumer: LinkedConsumer,
  depth: number,
  visited: Set<string>,
): Promise<HopFlow> {
  const key = visitedKey(consumer.repo_id, consumer.file, consumer.line);

  if (depth > MAX_HOP_DEPTH) return stopBand(consumer, entryVia, depth, 'depth-reached');
  if (visited.has(key)) return stopBand(consumer, entryVia, depth, 'cycle-detected');
  visited.add(key);

  const repo = getRepo(consumer.repo_id);
  if (!repo) return stopBand(consumer, entryVia, depth, 'no-cpg');

  let cpgPath: string;
  try {
    cpgPath = await ensureCpg(consumer.repo_id, repo.path, scanId);
  } catch (err) {
    console.warn(`[hop-tracer] ensureCpg failed for ${repo.name}: ${(err as Error).message}`);
    return stopBand(consumer, entryVia, depth, 'no-cpg');
  }

  // Synthetic Finding to reuse the existing flow script wrapper.
  const fakeFinding: Finding = {
    id: 'hop-' + uuid(),
    scan_id: scanId,
    repo_id: consumer.repo_id,
    rule_id: 'hop',
    severity: 'info',
    file: consumer.file,
    start_line: consumer.line,
    end_line: consumer.line,
    snippet: consumer.snippet,
    message: '',
    flow_status: 'pending',
    flow_error: null,
  };

  let flowResults: FlowResult[];
  try {
    flowResults = await runFlowScript(cpgPath, [fakeFinding], scanId, consumer.repo_id);
  } catch (err) {
    console.warn(`[hop-tracer] runFlowScript failed for ${repo.name}:${consumer.file}:${consumer.line}: ${(err as Error).message}`);
    return stopBand(consumer, entryVia, depth, 'error');
  }

  const hopResult = flowResults[0];
  if (!hopResult || hopResult.paths.length === 0) {
    return stopBand(consumer, entryVia, depth, 'no-flow');
  }

  // Recurse — enrich each of this hop's paths with THEIR consumers.
  // The hop's entry location is the consumer call site, so symbol-import
  // checks in downstream repos work the same as at the origin.
  const hopEntryLocation = { file: consumer.file, line: consumer.line };
  const hopPaths: FlowPath[] = [];
  for (const p of hopResult.paths) {
    hopPaths.push(
      await enrichPath(scanId, consumer.repo_id, hopEntryLocation, p, depth, visited),
    );
  }

  return {
    repo_id: consumer.repo_id,
    repo_name: repo.name,
    entry: { file: consumer.file, line: consumer.line },
    entry_via: entryVia,
    depth,
    paths: hopPaths,
  };
}

function stopBand(
  consumer: LinkedConsumer,
  entryVia: string,
  depth: number,
  reason: HopStopReason,
): HopFlow {
  return {
    repo_id: consumer.repo_id,
    repo_name: consumer.repo_name,
    entry: { file: consumer.file, line: consumer.line },
    entry_via: entryVia,
    depth,
    paths: [],
    stop_reason: reason,
  };
}

function visitedKey(repoId: string, file: string, line: number): string {
  return `${repoId}::${file}::${line}`;
}

// silence unused-imports lint hints if this module ever gets simpler
export const _touch = { classifySink, FlowNode: null as unknown as FlowNode };
