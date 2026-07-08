import type { FastifyPluginAsync } from 'fastify';
import { listRulepacks } from '../rulepacks.js';
import { listSinks } from '../analyzers/sinks.js';

/** Meta routes: rulepacks + sinks catalogs (both read-only for now). */
export const metaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rulepacks', async () => ({ rulepacks: listRulepacks() }));
  fastify.get('/sinks', async () => ({ sinks: listSinks() }));
};
