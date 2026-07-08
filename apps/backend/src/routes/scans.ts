import type { FastifyPluginAsync } from 'fastify';
import {
  createScan, getScan, listFindings, listScanRepos, listScans,
} from '../storage.js';
import { startScan } from '../scan-runner.js';

export const scanRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => ({ scans: listScans() }));

  fastify.post('/', async (req, reply) => {
    const body = req.body as { repo_ids?: string[]; rulepack_ids?: string[] };
    const repoIds = body?.repo_ids ?? [];
    const rulepackIds = body?.rulepack_ids ?? [];
    if (repoIds.length === 0 || rulepackIds.length === 0) {
      reply.code(400);
      return { error: 'repo_ids and rulepack_ids required' };
    }
    const scan = createScan(repoIds, rulepackIds);
    startScan(scan.id);
    return { scan };
  });

  fastify.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const scan = getScan(id);
    if (!scan) { reply.code(404); return { error: 'not found' }; }
    return {
      scan,
      repos: listScanRepos(id),
      findings: listFindings(id),
    };
  });
};
