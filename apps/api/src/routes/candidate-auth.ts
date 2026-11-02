import { CandidateMeDto, GoogleSignInRequest, IDENTITY_HELP_REASONS, identityEligible } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import type { InternalActor } from '../auth/actor';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CANDIDATE_SESSION_COOKIE, createCandidateSession, revokeSession } from '../auth/sessions';
import type { GoogleVerifier } from '../candidate/google';
import { MockGoogleVerifier } from '../candidate/google';
import type { IdentityProvider } from '../candidate/identity-provider';
import { MockIdentityProvider } from '../candidate/identity-provider';
import { ELIGIBLE, identityProblemText, latestAttempt, processIdentityWebhook } from '../candidate/identity-service';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { AppError, notFound, unauthorized } from '../lib/errors';
import { runCandidateCommand, runCommand } from '../platform/command';

export interface CandidateDeps {
  db: Db;
  config: Config;
  google: GoogleVerifier;
  identity: IdentityProvider;
  /** The single v1 client candidates sign up under (multi-tenant later). */
  resolveClientId: () => Promise<string>;
}

// Identity help before a project enrollment is handled by an Admin. Validators may
// see or decide only for applicants in their assigned project pools.
function identityReviewScope(actor: InternalActor): Prisma.SmeUserWhereInput {
  return { clientId: actor.clientId, ...(actor.roles.includes('ADMIN') ? {} : {
    enrollments: { some: { clientId: actor.clientId, status: { not: 'WITHDRAWN' }, opportunity: {
      project: { clientId: actor.clientId, reviewers: { some: { userId: actor.userId } } },
    } } },
  }) };
}

async function meDto(tx: Db | Tx, smeUserId: string): Promise<z.infer<typeof CandidateMeDto>> {
  const u = await tx.smeUser.findUniqueOrThrow({
    where: { id: smeUserId },
    include: { enrollments: { include: { opportunityVersion: true }, orderBy: { createdAt: 'desc' } } },
  });
  const attempt = await latestAttempt(tx, smeUserId);
  const eligible = identityEligible(u.identityStatus);
  let identityLabel = 'Identity not verified yet';
  if (u.identityStatus === 'VERIFIED') identityLabel = attempt && !attempt.livemode ? 'Identity verified (test mode)' : 'Identity verified';
  else if (u.identityStatus === 'ALTERNATIVE_VERIFIED') identityLabel = 'Identity verified (alternative process)';
  else if (u.identityStatus === 'PROCESSING') identityLabel = 'Identity check processing';
  else if (u.identityStatus === 'MANUAL_REVIEW_REQUIRED') identityLabel = 'Identity check needs our team';
  const draft = u.enrollments.find((e) => e.status === 'DRAFT' || e.status === 'NEEDS_INFORMATION');
  return {
    id: u.id,
    displayName: u.displayName,
    contactEmail: u.contactEmail,
    accountStatus: u.accountStatus,
    identityStatus: u.identityStatus,
    identityLabel,
    identityProblem: eligible ? null : identityProblemText(attempt?.errorCode ?? null),
    nextStep: !eligible ? 'VERIFY_IDENTITY' : draft ? 'CONTINUE_PROFILE' : 'CHOOSE_OPPORTUNITY',
    enrollments: u.enrollments.map((e) => ({
      id: e.id,
      opportunityId: e.opportunityId,
      title: (e.opportunityVersion.brief as { title?: string }).title ?? 'Opportunity',
      status: e.status,
    })),
  };
}

const IdentityDto = z.object({
  identityStatus: z.string(),
  identityLabel: z.string(),
  identityProblem: z.string().nullable(),
  attempt: z.object({ status: z.string(), livemode: z.boolean(), checkedAt: z.string().nullable() }).nullable(),
});

/** FLOW2-SME C01 (sign-in) and C02 (identity) for candidates. */
export const candidateAuthRoutes: FastifyPluginAsyncZod<CandidateDeps> = async (app, deps) => {
  const { db, config, google, identity } = deps;
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.COOKIE_SECURE };

  // ── C01 sign-in ──
  app.post(
    '/auth/google',
    {
      config: { access: 'public', rateLimit: { max: config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
      schema: { tags: ['candidate'], body: GoogleSignInRequest, response: { 200: CandidateMeDto } },
    },
    async (req, reply) => {
      const g = await google.verify(req.body.credential);
      const clientId = await deps.resolveClientId();
      // The stable Google subject is the identity key. Never merge accounts by email (FLOW2 C01).
      let pid = await db.providerIdentity.findUnique({ where: { provider_subject: { provider: 'GOOGLE', subject: g.subject } } });
      if (!pid) {
        if (req.body.adultAttested !== true) {
          throw new AppError(400, 'ADULT_ATTESTATION_REQUIRED', 'Please confirm you are 18 or over to create an account.');
        }
        pid = await db.$transaction(async (tx) => {
          const u = await tx.smeUser.create({
            data: {
              clientId,
              displayName: g.name,
              contactEmail: g.emailVerified ? g.email : null,
              adultAttestedAt: new Date(),
            },
          });
          const p = await tx.providerIdentity.create({ data: { clientId, smeUserId: u.id, provider: 'GOOGLE', subject: g.subject, emailAtLink: g.email } });
          await tx.auditEvent.create({
            data: { clientId, actorType: 'CANDIDATE', actorId: u.id, entityType: 'SmeUser', entityId: u.id, action: 'candidate.account_created', after: { provider: 'GOOGLE', adultAttested: true } },
          });
          return p;
        });
      }
      const user = await db.smeUser.findUniqueOrThrow({ where: { id: pid.smeUserId } });
      if (user.accountStatus !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active. Please contact support.');
      const { token, expiresAt } = await createCandidateSession(db, {
        smeUserId: user.id,
        clientId: user.clientId,
        ttlHours: config.CANDIDATE_SESSION_TTL_HOURS,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      reply.setCookie(CANDIDATE_SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      return meDto(db, user.id);
    },
  );

  app.get('/me', { config: { access: 'candidate' }, schema: { tags: ['candidate'], response: { 200: CandidateMeDto } } }, async (req) =>
    meDto(db, req.candidate!.smeUserId),
  );

  app.post('/me/logout', { config: { access: 'candidate' }, schema: { tags: ['candidate'], response: { 204: z.null() } } }, async (req, reply) => {
    await revokeSession(db, req.candidate!.sessionId);
    reply.clearCookie(CANDIDATE_SESSION_COOKIE, cookieOptions);
    return reply.status(204).send(null);
  });

  // ── C02 identity ──
  app.get('/me/identity', { config: { access: 'candidate' }, schema: { tags: ['candidate'], response: { 200: IdentityDto } } }, async (req) => {
    const me = await meDto(db, req.candidate!.smeUserId);
    const a = await latestAttempt(db, req.candidate!.smeUserId);
    return {
      identityStatus: me.identityStatus,
      identityLabel: me.identityLabel,
      identityProblem: me.identityProblem,
      attempt: a ? { status: a.status, livemode: a.livemode, checkedAt: a.checkedAt?.toISOString() ?? null } : null,
    };
  });

  app.post(
    '/me/identity/session',
    {
      config: { access: 'candidate' },
      schema: { tags: ['candidate'], body: z.object({ returnTo: z.string().max(500).optional() }).optional(), response: { 200: z.object({ url: z.string() }) } },
    },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const u = await tx.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId } });
        if (ELIGIBLE.includes(u.identityStatus)) throw new AppError(409, 'ALREADY_VERIFIED', 'Your identity is already verified.');
        const last = await latestAttempt(tx, u.id);
        const resumable = last && last.provider === 'stripe' && last.status === 'REQUIRES_INPUT' ? last.providerSessionId : null;
        const returnUrl = `${config.CANDIDATE_APP_URL}/verify${req.body?.returnTo ? `?returnTo=${encodeURIComponent(req.body.returnTo)}` : ''}`;
        const s = await identity.createOrResume({ smeUserId: u.id, existingSessionId: resumable, returnUrl });
        if (s.sessionId !== resumable) {
          await tx.identityAttempt.create({
            data: { clientId: u.clientId, smeUserId: u.id, provider: 'stripe', providerSessionId: s.sessionId, livemode: s.livemode, status: 'REQUIRES_INPUT' },
          });
        }
        if (u.identityStatus === 'NOT_STARTED' || u.identityStatus === 'CANCELED') {
          await tx.smeUser.update({ where: { id: u.id }, data: { identityStatus: 'REQUIRES_INPUT' } });
        }
        await audit({ entityType: 'SmeUser', entityId: u.id, action: 'identity.session_started', after: { resumed: s.sessionId === resumable, livemode: s.livemode } });
        // The session URL is for this candidate only and is not stored.
        return { status: 200, body: { url: s.url } };
      });
      return reply;
    },
  );

  // Unsupported document/country, consent or technical problems lead to help, not an expertise rejection (CF-06).
  app.post(
    '/me/identity/help',
    {
      config: { access: 'candidate' },
      schema: { tags: ['candidate'], body: z.object({ reason: z.enum(IDENTITY_HELP_REASONS), note: z.string().trim().max(1000).optional() }), response: { 200: CandidateMeDto } },
    },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const u = await tx.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId } });
        if (ELIGIBLE.includes(u.identityStatus)) throw new AppError(409, 'ALREADY_VERIFIED', 'Your identity is already verified.');
        await tx.identityAttempt.create({
          data: { clientId: u.clientId, smeUserId: u.id, provider: 'manual', providerSessionId: `help_${randomUUID()}`, livemode: false, status: 'MANUAL_REVIEW_REQUIRED', errorCode: req.body.reason },
        });
        await tx.smeUser.update({ where: { id: u.id }, data: { identityStatus: 'MANUAL_REVIEW_REQUIRED' } });
        await audit({ entityType: 'SmeUser', entityId: u.id, action: 'identity.help_requested', before: { identityStatus: u.identityStatus }, after: { identityStatus: 'MANUAL_REVIEW_REQUIRED', reason: req.body.reason, note: req.body.note ?? null } });
        return { status: 200, body: await meDto(tx, u.id) };
      });
      return reply;
    },
  );

  // ── Provider webhook (signed, raw body; FLOW2 path decided 26 Sep 2026) ──
  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    hook.post('/integrations/stripe/identity-webhook', { config: { access: 'public' }, schema: { hide: true } }, async (req, reply) => {
      try {
        const result = await processIdentityWebhook(db, identity, { requireLive: config.requireLiveIdentity }, req.body as Buffer, req.headers['stripe-signature'] as string | undefined);
        return reply.send({ received: true, result });
      } catch (err) {
        if (err instanceof Error && /signature/i.test(err.message)) throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
        throw err;
      }
    });
  });

  // ── Reviewer: approved alternative identity process (never labelled "Stripe verified") ──
  app.get(
    '/review/identity',
    { config: { access: ['REVIEWER', 'ADMIN'] }, schema: { tags: ['candidate'], response: { 200: z.object({ items: z.array(z.object({ smeUserId: z.string(), displayName: z.string().nullable(), reason: z.string().nullable(), requestedAt: z.string() })) }) } } },
    async (req) => {
      const users = await db.smeUser.findMany({
        where: { ...identityReviewScope(req.actor!), identityStatus: 'MANUAL_REVIEW_REQUIRED' },
        include: { identityAttempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'asc' },
      });
      return {
        items: users.map((u) => ({
          smeUserId: u.id,
          displayName: u.displayName,
          reason: u.identityAttempts[0]?.errorCode ?? null,
          requestedAt: (u.identityAttempts[0]?.createdAt ?? u.updatedAt).toISOString(),
        })),
      };
    },
  );

  app.post(
    '/review/identity/:smeUserId/decision',
    {
      config: { access: ['REVIEWER', 'ADMIN'] },
      schema: {
        tags: ['candidate'],
        params: z.object({ smeUserId: z.string().uuid() }),
        body: z.object({ outcome: z.enum(['ALTERNATIVE_VERIFIED', 'NOT_VERIFIED']), method: z.string().trim().min(1).max(200), notes: z.string().trim().max(2000).optional() }),
        response: { 200: z.object({ identityStatus: z.string() }) },
      },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const u = await tx.smeUser.findFirst({ where: { id: req.params.smeUserId, ...identityReviewScope(actor) } });
        if (!u) throw notFound('Candidate not found');
        if (u.identityStatus !== 'MANUAL_REVIEW_REQUIRED') throw new AppError(409, 'NOT_AWAITING_REVIEW', 'This candidate is not awaiting an identity review.');
        const next = req.body.outcome === 'ALTERNATIVE_VERIFIED' ? 'ALTERNATIVE_VERIFIED' : 'REQUIRES_INPUT';
        await tx.alternativeIdentityCheck.create({
          data: { clientId: u.clientId, smeUserId: u.id, reviewerId: actor.userId, method: req.body.method, outcome: req.body.outcome, notes: req.body.notes, decidedAt: new Date() },
        });
        await tx.smeUser.update({ where: { id: u.id }, data: { identityStatus: next } });
        await audit({ entityType: 'SmeUser', entityId: u.id, action: 'identity.alternative_decision', before: { identityStatus: u.identityStatus }, after: { identityStatus: next, method: req.body.method } });
        return { status: 200, body: { identityStatus: next } };
      });
      return reply;
    },
  );

  // ── LOCAL DEV ONLY: mock sign-in and identity simulation (never registered in production) ──
  if (google instanceof MockGoogleVerifier) {
    app.post(
      '/auth/dev/google-token',
      {
        config: { access: 'public' },
        schema: { tags: ['demo-only'], body: z.object({ email: z.string().email(), name: z.string().trim().min(1).max(200) }), response: { 200: z.object({ credential: z.string() }) } },
      },
      async (req) => ({ credential: google.mint({ subject: `mock-${req.body.email.toLowerCase()}`, email: req.body.email, name: req.body.name }) }),
    );
  }
  if (identity instanceof MockIdentityProvider) {
    app.post(
      '/dev/identity/:sessionId/simulate',
      {
        config: { access: 'candidate' },
        schema: {
          tags: ['demo-only'],
          params: z.object({ sessionId: z.string() }),
          body: z.object({ status: z.enum(['verified', 'requires_input', 'processing', 'canceled']), adult: z.boolean().optional(), errorCode: z.string().optional() }),
          response: { 200: z.object({ result: z.string() }) },
        },
      },
      async (req) => {
        // Only the candidate who owns the session may simulate it.
        const a = await db.identityAttempt.findUnique({ where: { providerSessionId: req.params.sessionId } });
        if (!a || a.smeUserId !== req.candidate!.smeUserId) throw unauthorized();
        const { rawBody, signature } = identity.simulate(req.params.sessionId, req.body);
        return { result: await processIdentityWebhook(db, identity, { requireLive: config.requireLiveIdentity }, rawBody, signature) };
      },
    );
  }
};
