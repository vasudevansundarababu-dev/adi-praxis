import { candidatePasswordProblem, CandidateMeDto, PasswordForgotRequest, PasswordSetRequest, PasswordSignInRequest } from '@praxis/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import { CANDIDATE_SESSION_COOKIE, createCandidateSession } from '../auth/sessions';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { accountEmails, accountForEmail, createPasswordToken, passwordMode, sendPasswordEmail, signInModeError } from '../forge/password';
import { forgeSettings } from '../forge/settings';
import type { EmailSender } from '../lib/email';
import { sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { meDto } from './candidate-auth';

export interface CandidatePasswordDeps {
  db: Db;
  config: Config;
  email: EmailSender;
  resolveClientId: () => Promise<string>;
}

const Ok = z.object({ ok: z.literal(true) });

/**
 * MVP1 step 6: Online candidate sign-in (email and password), setting a password from the emailed one-time link, and
 * Forgot password. Public routes, rate limited like the console login. Passwords never reach logs, audits or responses.
 */
export const candidatePasswordRoutes: FastifyPluginAsyncZod<CandidatePasswordDeps> = async (app, deps) => {
  const { db, config, email } = deps;
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.COOKIE_SECURE };
  const limit = { max: config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' };
  const audit = (tx: Db | Tx, clientId: string, smeUserId: string, action: string, after: Prisma.InputJsonValue, actorType: 'CANDIDATE' | 'SYSTEM' = 'CANDIDATE') =>
    tx.auditEvent.create({ data: { clientId, actorType, actorId: actorType === 'CANDIDATE' ? smeUserId : 'candidate-password', entityType: 'SmeUser', entityId: smeUserId, action, after } });

  /** Only in the new flow with Online sign-in; otherwise 409 SIGN_IN_MODE. */
  async function requireOnline() {
    const clientId = await deps.resolveClientId();
    if (!passwordMode(await forgeSettings(db, clientId))) throw signInModeError(false);
    return clientId;
  }

  app.post(
    '/auth/password',
    { config: { access: 'public', rateLimit: limit }, schema: { tags: ['candidate'], body: PasswordSignInRequest, response: { 200: CandidateMeDto } } },
    async (req, reply) => {
      const clientId = await requireOnline();
      const smeUserId = req.body.email ? await accountForEmail(db, clientId, req.body.email) : null;
      const cred = smeUserId ? await db.candidateCredential.findUnique({ where: { smeUserId } }) : null;
      // Verify against a dummy hash when there is no password, so timing does not reveal which emails have accounts.
      const ok = await verifyPassword(cred?.passwordHash ?? (await getDummyHash()), req.body.password);
      if (!cred || !ok || cred.clientId !== clientId) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      const user = await db.smeUser.findUniqueOrThrow({ where: { id: cred.smeUserId } });
      if (user.accountStatus !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active. Please contact support.');
      const first = !user.adultAttestedAt;
      if (first && req.body.adultAttested !== true) throw new AppError(400, 'ADULT_ATTESTATION_REQUIRED', 'Please confirm you are 18 or over to continue.');
      await db.$transaction(async (tx) => {
        if (first) await tx.smeUser.update({ where: { id: user.id }, data: { adultAttestedAt: new Date() } });
        await audit(tx, clientId, user.id, 'candidate.signed_in_password', { firstSignIn: first, adultAttested: first });
      });
      const { token, expiresAt } = await createCandidateSession(db, { smeUserId: user.id, clientId: user.clientId, ttlHours: config.CANDIDATE_SESSION_TTL_HOURS, ip: req.ip, userAgent: req.headers['user-agent'] });
      reply.setCookie(CANDIDATE_SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      return meDto(db, user.id, config.requireLiveIdentity);
    },
  );

  app.post(
    '/auth/password/set',
    { config: { access: 'public', rateLimit: limit }, schema: { tags: ['candidate'], body: PasswordSetRequest, response: { 200: Ok } } },
    async (req) => {
      const clientId = await requireOnline();
      // One message for an unknown, used or expired link, so a link reveals nothing.
      const invalid = new AppError(400, 'LINK_INVALID', 'This link has expired or was already used. Ask for a new one with Forgot password.');
      const tokenHash = sha256(req.body.token);
      const t = await db.candidatePasswordToken.findUnique({ where: { tokenHash } });
      if (!t || t.clientId !== clientId || t.usedAt || t.expiresAt <= new Date() || !['set', 'reset'].includes(t.purpose)) throw invalid;
      const weak = candidatePasswordProblem(req.body.password, await accountEmails(db, t.smeUserId));
      if (weak) throw new AppError(400, 'WEAK_PASSWORD', weak);
      const passwordHash = await hashPassword(req.body.password);
      await db.$transaction(async (tx) => {
        // Single use, even when two submits race: only the one that marks the link used goes on.
        const { count } = await tx.candidatePasswordToken.updateMany({ where: { id: t.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (!count) throw invalid;
        await tx.candidateCredential.upsert({ where: { smeUserId: t.smeUserId }, create: { clientId, smeUserId: t.smeUserId, passwordHash }, update: { passwordHash } });
        // Other unused links for this person stop working, and every existing candidate session is signed out.
        await tx.candidatePasswordToken.updateMany({ where: { smeUserId: t.smeUserId, usedAt: null }, data: { usedAt: new Date() } });
        await tx.session.updateMany({ where: { audience: 'CANDIDATE', smeUserId: t.smeUserId, revokedAt: null }, data: { revokedAt: new Date() } });
        await audit(tx, clientId, t.smeUserId, 'candidate.password_set', { purpose: t.purpose, tokenId: t.id });
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/password/forgot',
    { config: { access: 'public', rateLimit: limit }, schema: { tags: ['candidate'], body: PasswordForgotRequest, response: { 202: Ok } } },
    async (req, reply) => {
      const clientId = await deps.resolveClientId();
      if (passwordMode(await forgeSettings(db, clientId)) && req.body.email) {
        const smeUserId = await accountForEmail(db, clientId, req.body.email);
        if (smeUserId) {
          try {
            await db.$transaction(async (tx) => {
              const { token, row } = await createPasswordToken(tx, { clientId, smeUserId, purpose: 'reset' });
              await audit(tx, clientId, smeUserId, 'candidate.password_reset_requested', { tokenId: row.id, expiresAt: row.expiresAt.toISOString() }, 'SYSTEM');
              // To the address the person was assigned with (the one they typed matched it).
              await sendPasswordEmail(email, config, { to: req.body.email.trim().toLowerCase(), token, purpose: 'reset' });
            });
          } catch (err) {
            // The answer is the same whatever happens, so it reveals nothing; the failure is logged without the email.
            req.log.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'password reset email failed');
          }
        }
      }
      return reply.status(202).send({ ok: true as const });
    },
  );
};
