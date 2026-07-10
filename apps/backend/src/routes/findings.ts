import type { FastifyPluginAsync } from 'fastify';
import { getFinding, getFlow } from '../storage.js';

export const findingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const finding = getFinding(id);
    if (!finding) { reply.code(404); return { error: 'not found' }; }
    return { finding };
  });

  // The flow blob is pre-enriched during the scan by the hop-tracer
  // (see linkage/hop-tracer.ts): linked_consumers and per-consumer
  // hop_flow are already embedded. This route is a pass-through.
  fastify.get('/:id/flow', async (req, reply) => {
    const { id } = req.params as { id: string };
    const finding = getFinding(id);
    if (!finding) { reply.code(404); return { error: 'not found' }; }
    return { finding, flow: getFlow(id) };
  });
};
