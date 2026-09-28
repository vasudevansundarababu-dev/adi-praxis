import { CandidateSubmissionInput } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PartnerUserActor } from '../auth/actor';
import { getDummyHash, verifyPassword } from '../auth/password';
import { createPartnerSession, PARTNER_SESSION_COOKIE, revokeSession } from '../auth/sessions';
import type { Config } from '../config';
import type { Db } from '../db';
import type { EmailSender } from '../lib/email';
import { notFound, unauthorized } from '../lib/errors';
import type { SecretBox } from '../lib/secrets';
import { runPartnerCommand } from '../platform/command';
import { ClientInput, clientDto, createClient, createWebhook, revokeClient, rotateClient, WebhookInput, webhookDto } from '../supply/partners';
import { partnerRequisitionDto } from '../supply/requisitions';
import { candidateView, submitCandidate, withdraw } from '../supply/submissions';
import { replayDelivery } from '../supply/webhooks';

const IdParams = z.object({ id: z.string().uuid() });
const me = (req: { partner: unknown }) => req.partner as PartnerUserActor;

/**
 * M10 partner portal (inside apps/web under /partner): partner users sign in with email and password (argon2id) and a
 * separate cookie `praxis_partner`, then manage requisitions, candidates, API keys and webhooks for their partner only.
 */
export const partnerPortalRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; email: EmailSender; box: SecretBox }> = async (app, { db, config, email, box }) => {
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.COOKIE_SECURE };

  app.post(
    '/partner-portal/login',
    { config: { access: 'public', rateLimit: { max: config.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } }, schema: { tags: ['partner-portal'], body: z.object({ email: z.string().email(), password: z.string().min(1).max(200) }) } },
    async (req, reply) => {
      const u = await db.partnerUser.findUnique({ where: { email: req.body.email.toLowerCase() }, include: { partner: true } });
      const ok = await verifyPassword(u?.passwordHash ?? (await getDummyHash()), req.body.password);
      if (!u || !ok || u.status !== 'ACTIVE' || u.partner.status !== 'ACTIVE') throw unauthorized('Email or password is incorrect.');
      const { token, expiresAt } = await createPartnerSession(db, { partnerUserId: u.id, clientId: u.partner.clientId, ttlHours: config.SESSION_TTL_HOURS, ip: req.ip, userAgent: req.headers['user-agent'] });
      await db.partnerUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
      await db.auditEvent.create({ data: { clientId: u.partner.clientId, actorType: 'PARTNER', actorId: `partner-user:${u.id}`, entityType: 'PartnerUser', entityId: u.id, action: 'partner.user_signed_in' } });
      reply.setCookie(PARTNER_SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      return { user: { id: u.id, email: u.email, name: u.name }, partner: { id: u.partner.id, name: u.partner.name } };
    },
  );

  app.post('/partner-portal/logout', { config: { access: 'partner' }, schema: { tags: ['partner-portal'] } }, async (req, reply) => {
    await revokeSession(db, me(req).sessionId);
    reply.clearCookie(PARTNER_SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get('/partner-portal/me', { config: { access: 'partner' }, schema: { tags: ['partner-portal'] } }, async (req) => {
    const u = await db.partnerUser.findUniqueOrThrow({ where: { id: me(req).partnerUserId }, include: { partner: true } });
    return { user: { id: u.id, email: u.email, name: u.name }, partner: { id: u.partner.id, name: u.partner.name, allowedDomains: u.partner.allowedDomains, allowedTiers: u.partner.allowedTiers } };
  });

  app.get('/partner-portal/requisitions', { config: { access: 'partner' }, schema: { tags: ['partner-portal'] } }, async (req) => {
    const p = me(req);
    const rows = await db.requisition.findMany({ where: { clientId: p.clientId, allowedPartnerIds: { has: p.partnerId }, state: { in: ['OPEN', 'PAUSED', 'FILLED'] } }, orderBy: { createdAt: 'desc' } });
    const mine = await db.partnerSubmission.groupBy({ by: ['requisitionId'], where: { partnerId: p.partnerId, sandbox: false, requisitionId: { in: rows.map((r) => r.id) } }, _count: true });
    return { items: rows.map((r) => partnerRequisitionDto(r, { submitted: mine.find((m) => m.requisitionId === r.id)?._count ?? 0 })) };
  });

  app.get('/partner-portal/requisitions/:id', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req) => {
    const p = me(req);
    const r = await db.requisition.findFirst({ where: { id: req.params.id, clientId: p.clientId, allowedPartnerIds: { has: p.partnerId } } });
    if (!r) throw notFound('Requisition not found');
    return partnerRequisitionDto(r);
  });

  app.post('/partner-portal/requisitions/:id/candidates', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams, body: CandidateSubmissionInput } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => submitCandidate(tx, { email, appUrl: config.CANDIDATE_APP_URL }, { clientId: actor.clientId, ch: { partnerId: actor.partnerId, sandbox: false, channel: 'PARTNER_PORTAL' }, requisitionId: req.params.id, input: req.body }, audit));
    return reply;
  });

  app.get('/partner-portal/candidates', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], querystring: z.object({ requisitionId: z.string().uuid().optional() }) } }, async (req) => {
    const p = me(req);
    const rows = await db.partnerSubmission.findMany({ where: { partnerId: p.partnerId, sandbox: false, ...(req.query.requisitionId ? { requisitionId: req.query.requisitionId } : {}) }, include: { candidate: true, requisition: { select: { title: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const out = [];
    for (const s of rows) out.push({ ...(await candidateView(db, s)), name: s.candidate.name, requisitionTitle: s.requisition.title });
    return { items: out };
  });

  app.get('/partner-portal/candidates/:id', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req) => {
    const s = await db.partnerSubmission.findFirst({ where: { id: req.params.id, partnerId: me(req).partnerId }, include: { candidate: true } });
    if (!s) throw notFound('Candidate not found');
    return { ...(await candidateView(db, s)), name: s.candidate.name };
  });

  app.post('/partner-portal/candidates/:id/withdraw', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const s = await withdraw(tx, actor.partnerId, req.params.id, audit);
      return { status: 200, body: await candidateView(tx, s) };
    });
    return reply;
  });

  // ── API keys (OAuth clients): secrets are shown once ──
  app.get('/partner-portal/clients', { config: { access: 'partner' }, schema: { tags: ['partner-portal'] } }, async (req) => ({
    items: (await db.partnerClient.findMany({ where: { partnerId: me(req).partnerId }, orderBy: { createdAt: 'desc' } })).map(clientDto),
  }));

  app.post('/partner-portal/clients', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], body: ClientInput } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { client, clientSecret } = await createClient(tx, actor.partnerId, req.body);
      await audit({ entityType: 'PartnerClient', entityId: client.id, action: 'partner.client_created', after: { environment: client.environment, scopes: client.scopes } });
      return { status: 201, body: { ...clientDto(client), clientSecret }, replayBody: { ...clientDto(client), clientSecret: null } };
    });
    return reply;
  });

  app.post('/partner-portal/clients/:id/rotate', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { client, clientSecret } = await rotateClient(tx, actor.partnerId, req.params.id);
      await audit({ entityType: 'PartnerClient', entityId: client.id, action: 'partner.client_rotated' });
      return { status: 200, body: { ...clientDto(client), clientSecret }, replayBody: { ...clientDto(client), clientSecret: null } };
    });
    return reply;
  });

  app.post('/partner-portal/clients/:id/revoke', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await revokeClient(tx, actor.partnerId, req.params.id);
      await audit({ entityType: 'PartnerClient', entityId: c.id, action: 'partner.client_revoked' });
      return { status: 200, body: clientDto(c) };
    });
    return reply;
  });

  // ── Webhooks ──
  app.get('/partner-portal/webhooks', { config: { access: 'partner' }, schema: { tags: ['partner-portal'] } }, async (req) => ({
    items: (await db.partnerWebhook.findMany({ where: { partnerId: me(req).partnerId }, orderBy: { createdAt: 'desc' } })).map(webhookDto),
  }));

  app.post('/partner-portal/webhooks', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], body: WebhookInput } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { webhook, signingSecret } = await createWebhook(tx, box, actor.partnerId, req.body);
      await audit({ entityType: 'PartnerWebhook', entityId: webhook.id, action: 'partner.webhook_created', after: { url: webhook.url, events: webhook.events, environment: webhook.environment } });
      return { status: 201, body: { ...webhookDto(webhook), signingSecret }, replayBody: { ...webhookDto(webhook), signingSecret: null } };
    });
    return reply;
  });

  app.post('/partner-portal/webhooks/:id/disable', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const w = await tx.partnerWebhook.findFirst({ where: { id: req.params.id, partnerId: actor.partnerId } });
      if (!w) throw notFound('Webhook not found');
      const u = await tx.partnerWebhook.update({ where: { id: w.id }, data: { status: 'DISABLED' } });
      await audit({ entityType: 'PartnerWebhook', entityId: w.id, action: 'partner.webhook_disabled' });
      return { status: 200, body: webhookDto(u) };
    });
    return reply;
  });

  app.get('/partner-portal/webhook-deliveries', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], querystring: z.object({ status: z.string().max(20).optional() }) } }, async (req) => {
    const rows = await db.partnerWebhookDelivery.findMany({ where: { webhook: { partnerId: me(req).partnerId }, ...(req.query.status ? { status: req.query.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200, include: { webhook: { select: { url: true } } } });
    return { items: rows.map((d) => ({ id: d.id, eventId: d.eventId, eventType: d.eventType, url: d.webhook.url, status: d.status, attempts: d.attempts, lastStatusCode: d.lastStatusCode, lastError: d.lastError, deliveredAt: d.deliveredAt?.toISOString() ?? null, replayOf: d.replayOfId, createdAt: d.createdAt.toISOString(), payload: d.payload })) };
  });

  app.post('/partner-portal/webhook-deliveries/:id/replay', { config: { access: 'partner' }, schema: { tags: ['partner-portal'], params: IdParams } }, async (req, reply) => {
    await runPartnerCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const d = await replayDelivery(tx, req.params.id, actor.partnerId);
      if (!d) throw notFound('Delivery not found');
      await audit({ entityType: 'PartnerWebhookDelivery', entityId: d.id, action: 'partner.webhook_replayed', after: { replayOf: req.params.id } });
      return { status: 202, body: { id: d.id, status: d.status } };
    });
    return reply;
  });
};
