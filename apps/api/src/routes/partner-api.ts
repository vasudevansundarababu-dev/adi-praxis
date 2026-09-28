import { CandidateSubmissionInput, SANDBOX_SIMULATIONS } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PartnerClientActor } from '../auth/actor';
import type { Config } from '../config';
import type { Db } from '../db';
import { sha256 } from '../lib/crypto';
import type { EmailSender } from '../lib/email';
import { AppError, notFound } from '../lib/errors';
import { runPartnerCommand } from '../platform/command';
import { issueToken, OAuthError } from '../supply/partners';
import { partnerRequisitionDto } from '../supply/requisitions';
import { partnerGuidelinesView } from '../cert/partner-view';
import { candidateView, simulate, submitCandidate, withdraw } from '../supply/submissions';

const IdParams = z.object({ id: z.string().uuid() });
const client = (req: { partner: unknown }) => req.partner as PartnerClientActor;

/**
 * Partner API v1 (docs/SME-SUPPLY.md section 5), base path /partner/v1. OAuth2 client credentials; one client per
 * partner and environment; scopes per route; Idempotency-Key on every write; per-token rate limits; sandbox clients
 * see the same requisitions but their candidates are simulated. Partners track progress but never act for candidates.
 */
export const partnerApiRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; email: EmailSender }> = async (app, { db, config, email }) => {
  // OAuth token requests are commonly form-encoded (RFC 6749).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  // Rate limits per bearer token (one token belongs to one partner client); per IP for the token endpoint.
  const perToken = (max: number) => ({ max, timeWindow: '1 minute', keyGenerator: (req: { headers: Record<string, unknown>; ip: string }) => (typeof req.headers.authorization === 'string' ? sha256(req.headers.authorization) : req.ip) });

  app.post('/oauth/token', { config: { access: 'public', rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['partner-api'], hide: false } }, async (req, reply) => {
    try {
      return await issueToken(db, (req.body ?? {}) as Record<string, unknown>, req.headers.authorization, config.PARTNER_API_TOKEN_TTL_SECONDS);
    } catch (err) {
      if (err instanceof OAuthError) return reply.status(err.statusCode).header('cache-control', 'no-store').send({ error: err.code, error_description: err.message });
      throw err;
    }
  });

  app.get('/requisitions', { config: { access: { partnerScope: 'requisitions:read' }, rateLimit: perToken(300) }, schema: { tags: ['partner-api'], querystring: z.object({ status: z.enum(['open', 'all']).default('open') }) } }, async (req) => {
    const c = client(req);
    const rows = await db.requisition.findMany({ where: { clientId: c.clientId, allowedPartnerIds: { has: c.partnerId }, state: req.query.status === 'open' ? 'OPEN' : { in: ['OPEN', 'PAUSED', 'FILLED', 'CLOSED'] } }, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((r) => partnerRequisitionDto(r)) };
  });

  app.get('/requisitions/:id', { config: { access: { partnerScope: 'requisitions:read' }, rateLimit: perToken(300) }, schema: { tags: ['partner-api'], params: IdParams } }, async (req) => {
    const c = client(req);
    const r = await db.requisition.findFirst({ where: { id: req.params.id, clientId: c.clientId, allowedPartnerIds: { has: c.partnerId }, state: { not: 'DRAFT' } } });
    if (!r) throw notFound('Requisition not found');
    // Summary and course outline from the published guidelines (null until the tier is published).
    return { ...partnerRequisitionDto(r), ...(await partnerGuidelinesView(db, r)) };
  });

  app.post('/requisitions/:id/candidates', { config: { access: { partnerScope: 'candidates:write' }, rateLimit: perToken(120) }, schema: { tags: ['partner-api'], params: IdParams, body: CandidateSubmissionInput } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, audit }) => {
      const c = client(req);
      return submitCandidate(tx, { email, appUrl: config.CANDIDATE_APP_URL }, { clientId: c.clientId, ch: { partnerId: c.partnerId, sandbox: c.sandbox, channel: 'PARTNER_API' }, requisitionId: req.params.id, input: req.body }, audit);
    });
    return reply;
  });

  app.get('/candidates/:id', { config: { access: { partnerScope: 'candidates:read' }, rateLimit: perToken(600) }, schema: { tags: ['partner-api'], params: IdParams } }, async (req) => {
    const c = client(req);
    const s = await db.partnerSubmission.findFirst({ where: { id: req.params.id, partnerId: c.partnerId, sandbox: c.sandbox } });
    if (!s) throw notFound('Candidate not found');
    return candidateView(db, s);
  });

  app.post('/candidates/:id/withdraw', { config: { access: { partnerScope: 'candidates:write' }, rateLimit: perToken(120) }, schema: { tags: ['partner-api'], params: IdParams } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, audit }) => {
      const c = client(req);
      const own = await tx.partnerSubmission.findFirst({ where: { id: req.params.id, partnerId: c.partnerId, sandbox: c.sandbox } });
      if (!own) throw notFound('Candidate not found');
      return { status: 200, body: await candidateView(tx, await withdraw(tx, c.partnerId, req.params.id, audit)) };
    });
    return reply;
  });

  // This partner's certified SMEs with tier and quality band (filled in as M10b certifies candidates).
  app.get('/placements', { config: { access: { partnerScope: 'candidates:read' }, rateLimit: perToken(120) }, schema: { tags: ['partner-api'] } }, async (req) => {
    const c = client(req);
    const certified = await db.candidateStateEvent.findMany({ where: { dimension: 'certification', toState: 'CERTIFIED', submission: { partnerId: c.partnerId, sandbox: c.sandbox } }, include: { submission: { include: { requisition: true } } }, orderBy: { at: 'desc' } });
    const seen = new Set<string>();
    const data = [];
    for (const e of certified) {
      if (seen.has(e.submissionId)) continue;
      seen.add(e.submissionId);
      const standing = await db.candidateStateEvent.findFirst({ where: { submissionId: e.submissionId, dimension: 'standing' }, orderBy: { at: 'desc' } });
      data.push({ candidateId: e.submissionId, partnerRef: e.submission.partnerRef, domain: e.submission.requisition.domain, tier: e.submission.requisition.tier, certifiedAt: e.at.toISOString(), standing: standing?.toState ?? 'PROBATION', qualityBand: null });
    }
    return { data };
  });

  // Sandbox only: simulate a candidate's progress to exercise webhook handling.
  app.post('/sandbox/candidates/:id/simulate', { config: { access: { partnerScope: 'candidates:write' }, rateLimit: perToken(120) }, schema: { tags: ['partner-api'], params: IdParams, body: z.object({ event: z.enum(SANDBOX_SIMULATIONS) }) } }, async (req, reply) => {
    if (!client(req).sandbox) throw new AppError(403, 'SANDBOX_ONLY', 'Simulation is only available to sandbox clients.');
    await runPartnerCommand(db, req, reply, async ({ tx, audit }) => ({ status: 200, body: await simulate(tx, client(req).partnerId, req.params.id, req.body.event, audit) }));
    return reply;
  });
};
