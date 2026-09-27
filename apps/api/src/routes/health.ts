import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db';

export const healthRoutes: FastifyPluginAsyncZod<{ db: Db; pingRedis: () => Promise<boolean> }> = async (app, opts) => {
  app.get('/healthz', { config: { access: 'public' }, schema: { hide: true } }, async () => ({ status: 'ok' }));

  app.get('/readyz', { config: { access: 'public' }, schema: { hide: true } }, async (_req, reply) => {
    const [db, redis] = await Promise.all([
      opts.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      opts.pingRedis().catch(() => false),
    ]);
    return reply.status(db && redis ? 200 : 503).send({ status: db && redis ? 'ok' : 'unavailable', db, redis });
  });
};
