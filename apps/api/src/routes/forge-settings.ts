import { ForgeSettingsUpdate } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError } from '../lib/errors';
import { runCommand } from '../platform/command';
import { forgeFrom, forgeSettings, offlineSignInAllowed, withForge } from '../forge/settings';

/** MVP1 Admin settings: the new flow switch and the candidate app sign-in mode (one per client). */
export const forgeSettingsRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const offlineAllowed = offlineSignInAllowed(config);

  app.get('/admin/forge-settings', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['admin'] } }, async (req) => ({
    ...(await forgeSettings(db, req.actor!.clientId)),
    offlineAllowed,
  }));

  app.put('/admin/forge-settings', { config: { access: ['ADMIN'] }, schema: { tags: ['admin'], body: ForgeSettingsUpdate } }, async (req, reply) => {
    if (req.body.candidateSignIn === 'OFFLINE' && !offlineAllowed) {
      throw new AppError(400, 'OFFLINE_NOT_ALLOWED', 'Offline sign-in (email and name, no password) is not allowed in production. Choose Online.');
    }
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await tx.$executeRaw`SELECT 1 FROM "Client" WHERE id = ${actor.clientId}::uuid FOR UPDATE`;
      const client = await tx.client.findUniqueOrThrow({ where: { id: actor.clientId } });
      const before = forgeFrom(client.settings);
      const after = { ...before, ...req.body };
      await tx.client.update({ where: { id: client.id }, data: { settings: withForge(client.settings, after) } });
      await audit({ entityType: 'Client', entityId: client.id, action: 'forge.settings_updated', before, after });
      return { status: 200, body: { ...after, offlineAllowed } };
    });
    return reply;
  });
};
