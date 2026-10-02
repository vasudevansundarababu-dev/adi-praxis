import { ChangePasswordRequest, InternalUserDto, LoginRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import { createInternalSession, revokeSession, SESSION_COOKIE } from '../auth/sessions';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, badRequest, unauthorized } from '../lib/errors';
import { runCommand } from '../platform/command';
import { toUserDto } from './users';

/** Internal-user email + password sign-in with a server-side session cookie. */
export const authRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.COOKIE_SECURE,
  };

  app.post(
    '/auth/login',
    {
      config: {
        access: 'public',
        rateLimit: { max: config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      },
      schema: { tags: ['auth'], body: LoginRequest, response: { 200: z.object({ user: InternalUserDto }) } },
    },
    async (req, reply) => {
      const user = await db.user.findUnique({ where: { email: req.body.email } });
      const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), req.body.password);
      if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      if (user.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled');

      const { token, expiresAt } = await createInternalSession(db, {
        userId: user.id,
        clientId: user.clientId,
        ttlHours: config.SESSION_TTL_HOURS,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      return { user: toUserDto(user) };
    },
  );

  app.post(
    '/auth/logout',
    { config: { access: 'authenticated', allowTemporaryPassword: true }, schema: { tags: ['auth'], response: { 204: z.null() } } },
    async (req, reply) => {
      await revokeSession(db, req.actor!.sessionId);
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/me',
    { config: { access: 'authenticated', allowTemporaryPassword: true }, schema: { tags: ['auth'], response: { 200: z.object({ user: InternalUserDto }) } } },
    async (req) => {
      const user = await db.user.findUnique({ where: { id: req.actor!.userId } });
      if (!user) throw unauthorized();
      return { user: toUserDto(user) };
    },
  );

  // Change your own password (and replace a temporary one an Admin issued). Other sessions are signed out.
  app.post(
    '/auth/change-password',
    {
      config: { access: 'authenticated', allowTemporaryPassword: true, rateLimit: { max: config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], body: ChangePasswordRequest, response: { 200: z.object({ user: InternalUserDto }) } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
        if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is not correct.');
        if (req.body.newPassword === req.body.currentPassword) throw badRequest('Choose a password different from the current one.');
        if (req.body.newPassword.toLowerCase().includes(user.email.split('@')[0]!.toLowerCase())) throw badRequest('Do not use your email address in your password.');
        const updated = await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword), mustChangePassword: false } });
        await audit({ entityType: 'User', entityId: user.id, action: 'user.password_changed', before: { mustChangePassword: user.mustChangePassword }, after: { mustChangePassword: false } });
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: actor.sessionId } }, data: { revokedAt: new Date() } });
        return { status: 200, body: { user: toUserDto(updated) } };
      });
      return reply;
    },
  );
};
