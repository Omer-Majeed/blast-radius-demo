import type { FastifyPluginAsync } from 'fastify';
import { db } from '../storage.js';

/**
 * Test / development-only routes. Handy for e2e tests that need to
 * reset the DB between runs without restarting the server.
 *
 * NOTE: these are unguarded in the demo (there's no prod/dev split).
 * If we ever ship, guard by `process.env.NODE_ENV !== 'production'`.
 */
export const devRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.delete('/reset', async () => {
    const d = db();
    const tx = d.transaction(() => {
      d.exec(`
        DELETE FROM linkage_edge_signals;
        DELETE FROM linkage_edges;
        DELETE FROM linkage_signals;
        DELETE FROM flows;
        DELETE FROM findings;
        DELETE FROM scan_repos;
        DELETE FROM scans;
        DELETE FROM repos;
      `);
    });
    tx();
    return { ok: true };
  });
};
