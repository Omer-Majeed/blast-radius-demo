import type { FastifyPluginAsync } from 'fastify';
import { getFinding, getFlow } from '../storage.js';

export const findingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const finding = getFinding(id);
    if (!finding) { reply.code(404); return { error: 'not found' }; }
    return { finding };
  });

  fastify.get('/:id/flow', async (req, reply) => {
    const { id } = req.params as { id: string };
    const finding = getFinding(id);
    if (!finding) { reply.code(404); return { error: 'not found' }; }
    const flow = getFlow(id);
    return { finding, flow };
  });
};
