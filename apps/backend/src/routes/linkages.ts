import type { FastifyPluginAsync } from 'fastify';
import { getScan, listRepos, getRepo } from '../storage.js';
import { getEdge, listEdgesForScan, listSignalsForScan } from '../linkage/storage.js';
import type { LayerId, SignalKind } from '../linkage/types.js';

export const linkageRoutes: FastifyPluginAsync = async (fastify) => {
  // Full linkage graph for a scan.
  fastify.get('/:id/linkages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const scan = getScan(id);
    if (!scan) { reply.code(404); return { error: 'scan not found' }; }

    const edges = listEdgesForScan(id);

    // Attach the participating repos (id + name) so the frontend can
    // label nodes without an extra fetch. We include every repo that
    // was part of the scan, even if it has no edges — the graph
    // should still render the node.
    const repoIds = new Set<string>([...(scan.repo_ids ?? [])]);
    for (const e of edges) { repoIds.add(e.from_repo); repoIds.add(e.to_repo); }
    const repos = [...repoIds]
      .map((rid) => getRepo(rid))
      .filter((r): r is NonNullable<ReturnType<typeof getRepo>> => r != null)
      .map((r) => ({ id: r.id, name: r.name }));

    // Count edges by type for the UI filter chips.
    const counts_by_type: Record<string, number> = {};
    for (const e of edges) counts_by_type[e.type] = (counts_by_type[e.type] ?? 0) + 1;

    return { edges, repos, counts_by_type };
  });

  // Single-edge drill-down.
  fastify.get('/:id/linkages/edge/:edgeId', async (req, reply) => {
    const { id, edgeId } = req.params as { id: string; edgeId: string };
    const scan = getScan(id);
    if (!scan) { reply.code(404); return { error: 'scan not found' }; }
    const edge = getEdge(edgeId);
    if (!edge || edge.scan_id !== id) { reply.code(404); return { error: 'edge not found' }; }
    return { edge };
  });

  // Raw signals — useful for debugging/inspection.
  fastify.get('/:id/linkages/signals', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { layer?: LayerId; kind?: SignalKind; repo_id?: string };
    const scan = getScan(id);
    if (!scan) { reply.code(404); return { error: 'scan not found' }; }
    return { signals: listSignalsForScan(id, q) };
  });
};

// Silence unused-listRepos lint if this file grows further.
export const _unused_listRepos = listRepos;
