import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { packageContent } from '../anvil/task-package-store';

/** Only an ANVIL key (the RL Gym's key for ADI Forge) may read packages. */
const ANVIL = { roles: [] as const, apiClient: 'ANVIL' as const };

/**
 * New RL Gym part 1 (docs/design/FORGE-RLGYM-V2-DESIGN.md; snapshot §3.1 a): the RL Gym fetches each exported task's
 * authored package by its hash. The reply is the stored canonical JSON, byte for byte, so its SHA-256 is the hash in
 * the path. Read-only: nothing is written or audited as a state change.
 */
export const taskPackageRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get('/packages/:sha', { config: { access: ANVIL }, schema: { tags: ['anvil'], params: z.object({ sha: z.string() }) } }, async (req, reply) => {
    const client = req.apiClient;
    if (!client) throw new AppError(401, 'UNAUTHENTICATED', 'An RL Gym key is required.');
    if (!/^[a-f0-9]{64}$/.test(req.params.sha)) throw notFound('Package not found');
    const content = await packageContent(db, client.clientId, req.params.sha);
    if (content === null) throw notFound('Package not found');
    return reply.header('Content-Type', 'application/json').header('Cache-Control', 'no-store').send(content);
  });
};
