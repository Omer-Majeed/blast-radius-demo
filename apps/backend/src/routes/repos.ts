import type { FastifyPluginAsync } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRepo, deleteRepo, getRepo, listRepos } from '../storage.js';

export const repoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => ({ repos: listRepos() }));

  fastify.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = getRepo(id);
    if (!repo) { reply.code(404); return { error: 'not found' }; }
    return { repo };
  });

  fastify.post('/', async (req, reply) => {
    const body = req.body as { name?: string; path?: string };
    const name = (body?.name ?? '').trim();
    const rawPath = (body?.path ?? '').trim();
    if (!name || !rawPath) { reply.code(400); return { error: 'name and path required' }; }

    const absPath = resolve(rawPath);
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
      reply.code(400);
      return { error: `path does not exist or is not a directory: ${absPath}` };
    }

    try {
      const repo = createRepo(name, absPath);
      return { repo };
    } catch (e: any) {
      reply.code(409);
      return { error: e?.message ?? 'could not create repo' };
    }
  });

  fastify.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteRepo(id);
    return { ok: true };
  });
};
