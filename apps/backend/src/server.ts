import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PORT } from './config.js';
import { db } from './storage.js';
import { repoRoutes } from './routes/repos.js';
import { scanRoutes } from './routes/scans.js';
import { findingRoutes } from './routes/findings.js';
import { metaRoutes } from './routes/meta.js';

const fastify = Fastify({ logger: true });

async function main() {
  await fastify.register(cors, { origin: true });

  // Force DB init on boot so failures surface immediately.
  db();

  await fastify.register(repoRoutes, { prefix: '/api/repos' });
  await fastify.register(scanRoutes, { prefix: '/api/scans' });
  await fastify.register(findingRoutes, { prefix: '/api/findings' });
  await fastify.register(metaRoutes, { prefix: '/api' });

  fastify.get('/api/health', async () => ({ ok: true }));

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  fastify.log.info(`blast-radius-demo backend on :${PORT}`);
}

main().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
