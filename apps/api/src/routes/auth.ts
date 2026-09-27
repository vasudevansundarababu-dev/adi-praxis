import { InternalUserDto, LoginRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getDummyHash, verifyPassword } from '../auth/password';
import { createInternalSession, revokeSession, SESSION_COOKIE } from '../auth/sessions';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, unauthorized } from '../lib/errors';
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
    { config: { access: 'authenticated' }, schema: { tags: ['auth'], response: { 204: z.null() } } },
    async (req, reply) => {
      await revokeSession(db, req.actor!.sessionId);
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/me',
    { config: { access: 'authenticated' }, schema: { tags: ['auth'], response: { 200: z.object({ user: InternalUserDto }) } } },
    async (req) => {
      const user = await db.user.findUnique({ where: { id: req.actor!.userId } });
      if (!user) throw unauthorized();
      return { user: toUserDto(user) };
    },
  );
};
