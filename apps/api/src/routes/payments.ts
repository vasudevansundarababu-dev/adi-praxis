import { Prisma } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { buildStatements, CURRENCIES, earningDto, MINIMUM_PAYOUT, reverseEarning, statementDto } from '../pay/ledger';
import { applyPayeeStatus, onboardingLink, payeeView } from '../pay/payees';
import { approvePayRun, buildPayRun, cancelPayRun, confirmPayRun, payRunDto, previousWeek, processPayoutWebhook, reconcile, submitPayRun } from '../pay/payruns';
import type { PayoutProvider } from '../pay/provider';

const IdParams = z.object({ id: z.string().uuid() });
const Money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Use an amount like 40 or 40.50');
const FINANCE = ['ADMIN', 'FINANCE'] as const;
const SEE = ['ADMIN', 'PM', 'FINANCE'] as const;

/**
 * M10c payments, internal API (docs/SME-SUPPLY.md sections 8 and 10): rate cards, earnings and reversals, holds,
 * weekly pay runs (PM confirms, Finance approves and submits), payout exceptions, partner fees and statements, and the
 * payout provider webhook.
 */
export const paymentRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; payouts: PayoutProvider }> = async (app, { db, config, payouts }) => {
  // ── Rate cards (versioned; never edited) ──
  app.get('/rate-cards', { config: { access: SEE }, schema: { tags: ['payments'] } }, async (req) => {
    const rows = await db.rateCard.findMany({ where: { clientId: req.actor!.clientId }, orderBy: [{ name: 'asc' }, { version: 'desc' }] });
    return { items: rows.map((r) => ({ id: r.id, name: r.name, version: r.version, currency: r.currency, perTask: r.perTask, hourlyRate: r.hourlyRate?.toFixed(2) ?? null, weeklyCap: r.weeklyCap?.toFixed(2) ?? null, createdAt: r.createdAt.toISOString() })) };
  });

  app.post('/rate-cards', { config: { access: FINANCE }, schema: { tags: ['payments'], body: z.object({ name: z.string().trim().min(2).max(120), currency: z.enum(CURRENCIES), perTask: z.object({ AUTHORING: Money.optional(), ANNOTATION: Money.optional(), RL_REVIEW: Money.optional() }).refine((o) => Object.values(o).some(Boolean), 'Give at least one per-task rate'), hourlyRate: Money.nullable().default(null), weeklyCap: Money.nullable().default(null) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const last = await tx.rateCard.findFirst({ where: { clientId: actor.clientId, name: req.body.name }, orderBy: { version: 'desc' } });
      const r = await tx.rateCard.create({ data: { clientId: actor.clientId, name: req.body.name, version: (last?.version ?? 0) + 1, currency: req.body.currency, perTask: req.body.perTask, hourlyRate: req.body.hourlyRate, weeklyCap: req.body.weeklyCap, createdById: actor.userId } });
      await audit({ entityType: 'RateCard', entityId: r.id, action: 'rate_card.created', after: { name: r.name, version: r.version, currency: r.currency, perTask: req.body.perTask } });
      return { status: 201, body: { id: r.id, name: r.name, version: r.version } };
    });
    return reply;
  });

  app.put('/requisitions/:id/rate-card', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['payments'], params: IdParams, body: z.object({ rateCardId: z.string().uuid() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const r = await tx.requisition.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { project: true } });
      if (!r || (!actor.roles.includes('ADMIN') && r.project.ownerId !== actor.userId)) throw notFound('Requisition not found');
      const card = await tx.rateCard.findFirst({ where: { id: req.body.rateCardId, clientId: actor.clientId } });
      if (!card) throw notFound('Rate card not found');
      await tx.requisition.update({ where: { id: r.id }, data: { rateCardId: card.id } });
      await audit({ entityType: 'Requisition', entityId: r.id, action: 'requisition.rate_card_linked', before: { rateCardId: r.rateCardId }, after: { rateCardId: card.id, name: card.name, version: card.version, currency: card.currency } });
      return { status: 200, body: { requisitionId: r.id, rateCardId: card.id } };
    });
    return reply;
  });

  // ── Earnings ──
  app.get('/earnings', { config: { access: FINANCE }, schema: { tags: ['payments'], querystring: z.object({ smeUserId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) } }, async (req) => {
    const rows = await db.earningEntry.findMany({ where: { clientId: req.actor!.clientId, ...(req.query.smeUserId ? { smeUserId: req.query.smeUserId } : {}) }, orderBy: { earnedAt: 'desc' }, take: req.query.limit });
    return { items: rows.map(earningDto) };
  });

  app.post('/earnings/:id/reverse', { config: { access: FINANCE }, schema: { tags: ['payments'], params: IdParams, body: z.object({ reason: z.string().trim().min(5).max(1000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const r = await reverseEarning(tx, actor.clientId, req.params.id, req.body.reason, actor.userId, audit);
      return { status: 201, body: earningDto(r) };
    });
    return reply;
  });

  // ── Holds (disputes, fraud flags) ──
  app.post('/pay-holds', { config: { access: ['ADMIN', 'FINANCE', 'REVIEWER'] }, schema: { tags: ['payments'], body: z.object({ smeUserId: z.string().uuid(), kind: z.enum(['DISPUTE', 'FRAUD']), reason: z.string().trim().min(5).max(1000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const u = await tx.smeUser.findFirst({ where: { id: req.body.smeUserId, clientId: actor.clientId } });
      if (!u) throw notFound('SME not found');
      const h = await tx.payHold.create({ data: { clientId: actor.clientId, smeUserId: u.id, kind: req.body.kind, reason: req.body.reason, createdById: actor.userId } });
      await audit({ entityType: 'PayHold', entityId: h.id, action: 'pay_hold.placed', after: { smeUserId: u.id, kind: h.kind, reason: h.reason } });
      return { status: 201, body: { id: h.id } };
    });
    return reply;
  });

  app.post('/pay-holds/:id/release', { config: { access: FINANCE }, schema: { tags: ['payments'], params: IdParams, body: z.object({ note: z.string().trim().min(3).max(1000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const h = await tx.payHold.findFirst({ where: { id: req.params.id, clientId: actor.clientId, releasedAt: null } });
      if (!h) throw notFound('Active hold not found');
      await tx.payHold.update({ where: { id: h.id }, data: { releasedAt: new Date(), releasedBy: actor.userId } });
      await audit({ entityType: 'PayHold', entityId: h.id, action: 'pay_hold.released', after: { note: req.body.note } });
      return { status: 200, body: { id: h.id } };
    });
    return reply;
  });

  // ── Pay runs ──
  app.get('/pay-runs', { config: { access: SEE }, schema: { tags: ['payments'] } }, async (req) => {
    const rows = await db.payRun.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { periodStart: 'desc' }, take: 60 });
    return { items: rows.map((r) => payRunDto(r)) };
  });

  app.get('/pay-runs/:id', { config: { access: SEE }, schema: { tags: ['payments'], params: IdParams } }, async (req) => {
    const r = await db.payRun.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { items: { orderBy: { createdAt: 'asc' } } } });
    if (!r) throw notFound('Pay run not found');
    return payRunDto(r);
  });

  app.post('/pay-runs', { config: { access: SEE }, schema: { tags: ['payments'], body: z.object({ periodStart: z.string().date().optional() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      let period = previousWeek();
      if (req.body.periodStart) {
        const s = new Date(`${req.body.periodStart}T00:00:00Z`);
        if (s.getUTCDay() !== 1) throw new AppError(400, 'NOT_MONDAY', 'A pay-run week starts on a Monday.');
        period = { periodStart: s, periodEnd: new Date(s.getTime() + 7 * 86_400_000) };
      }
      const r = await buildPayRun(tx, actor.clientId, period, { type: 'USER', id: actor.userId }, audit);
      return { status: 201, body: payRunDto({ ...r, items: await tx.payoutItem.findMany({ where: { payRunId: r.id } }) }) };
    });
    return reply;
  });

  app.post('/pay-runs/:id/confirm', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['payments'], params: IdParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 200, body: payRunDto(await confirmPayRun(tx, actor.clientId, req.params.id, actor.userId, audit)) }));
    return reply;
  });

  app.post('/pay-runs/:id/approve', { config: { access: ['FINANCE'] }, schema: { tags: ['payments'], params: IdParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
      return { status: 200, body: payRunDto(await approvePayRun(tx, config, { clientId: actor.clientId, userId: actor.userId, email: u.email }, req.params.id, audit)) };
    });
    return reply;
  });

  app.post('/pay-runs/:id/cancel', { config: { access: FINANCE }, schema: { tags: ['payments'], params: IdParams, body: z.object({ reason: z.string().trim().min(5).max(1000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 200, body: payRunDto(await cancelPayRun(tx, actor.clientId, req.params.id, req.body.reason, audit)) }));
    return reply;
  });

  // Submission calls the provider, so it runs outside a request transaction; it is idempotent by status and per-item keys.
  app.post('/pay-runs/:id/submit', { config: { access: ['FINANCE'] }, schema: { tags: ['payments'], params: IdParams } }, async (req) => {
    const r = await submitPayRun(db, payouts, { clientId: req.actor!.clientId, userId: req.actor!.userId }, req.params.id);
    return payRunDto({ ...r, items: await db.payoutItem.findMany({ where: { payRunId: r.id }, orderBy: { createdAt: 'asc' } }) });
  });

  // ── Reconciliation and exceptions ──
  app.post('/payout-reconciliation', { config: { access: FINANCE }, schema: { tags: ['payments'], body: z.object({ date: z.string().date() }) } }, async (req) => {
    const res = await reconcile(db, payouts, new Date(`${req.body.date}T00:00:00Z`));
    await db.auditEvent.create({ data: { clientId: req.actor!.clientId, actorType: 'USER', actorId: req.actor!.userId, entityType: 'PayoutReconciliation', entityId: res.day, action: 'payout.reconciled', after: { lines: res.lines, mismatches: res.mismatches.length } } });
    return res;
  });

  app.get('/payout-exceptions', { config: { access: FINANCE }, schema: { tags: ['payments'], querystring: z.object({ status: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN') }) } }, async (req) => {
    const rows = await db.payoutException.findMany({ where: { clientId: req.actor!.clientId, ...(req.query.status === 'ALL' ? {} : { status: req.query.status }) }, orderBy: [{ reportDate: 'desc' }, { createdAt: 'asc' }] });
    return { items: rows.map((x) => ({ id: x.id, reportDate: x.reportDate.toISOString().slice(0, 10), kind: x.kind, paymentRef: x.paymentRef, payoutItemId: x.payoutItemId, detail: x.detail, status: x.status, note: x.note })) };
  });

  app.post('/payout-exceptions/:id/resolve', { config: { access: FINANCE }, schema: { tags: ['payments'], params: IdParams, body: z.object({ note: z.string().trim().min(5).max(1000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const x = await tx.payoutException.findFirst({ where: { id: req.params.id, clientId: actor.clientId, status: 'OPEN' } });
      if (!x) throw notFound('Open exception not found');
      await tx.payoutException.update({ where: { id: x.id }, data: { status: 'RESOLVED', resolvedBy: actor.userId, resolvedAt: new Date(), note: req.body.note } });
      await audit({ entityType: 'PayoutException', entityId: x.id, action: 'payout.exception_resolved', after: { note: req.body.note } });
      return { status: 200, body: { id: x.id, status: 'RESOLVED' } };
    });
    return reply;
  });

  // ── Partner fees and statements ──
  app.put('/partners/:id/fee-terms', { config: { access: ['ADMIN'] }, schema: { tags: ['payments'], params: IdParams, body: z.object({ certifiedFee: Money, feeCurrency: z.enum(CURRENCIES), feeTermsVersion: z.string().trim().min(1).max(60) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await tx.partner.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!p) throw notFound('Partner not found');
      await tx.partner.update({ where: { id: p.id }, data: { certifiedFee: new Prisma.Decimal(req.body.certifiedFee), feeCurrency: req.body.feeCurrency, feeTermsVersion: req.body.feeTermsVersion } });
      await audit({ entityType: 'Partner', entityId: p.id, action: 'partner.fee_terms_changed', before: { certifiedFee: p.certifiedFee?.toFixed(2) ?? null, feeCurrency: p.feeCurrency, feeTermsVersion: p.feeTermsVersion }, after: req.body });
      return { status: 200, body: { id: p.id, ...req.body } };
    });
    return reply;
  });

  app.get('/partner-statements', { config: { access: FINANCE }, schema: { tags: ['payments'], querystring: z.object({ partnerId: z.string().uuid().optional() }) } }, async (req) => {
    const rows = await db.partnerStatement.findMany({ where: { clientId: req.actor!.clientId, ...(req.query.partnerId ? { partnerId: req.query.partnerId } : {}) }, orderBy: [{ period: 'desc' }] });
    return { items: await Promise.all(rows.map(async (s) => ({ partnerId: s.partnerId, ...(await statementDto(db, s)) }))) };
  });

  app.post('/partner-statements/build', { config: { access: FINANCE }, schema: { tags: ['payments'], body: z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) } }, async (req) => {
    const made = await buildStatements(db, req.body.period, { type: 'USER', id: req.actor!.userId });
    return { created: made.length, ids: made.map((s) => s.id) };
  });

  // ── Payout provider webhook (signed raw body; test vs live mode told apart) ──
  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    hook.post('/integrations/trolley/webhook', { config: { access: 'public', rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { hide: true } }, async (req) => processPayoutWebhook(db, payouts, req.body as Buffer, req.headers));
  });
};

/** Candidate side: payee set-up (hosted by the provider) and earnings. */
export const paymentCandidateRoutes: FastifyPluginAsyncZod<{ db: Db; payouts: PayoutProvider }> = async (app, { db, payouts }) => {
  app.get('/me/payee', { config: { access: 'candidate' }, schema: { tags: ['payments'] } }, async (req) => payeeView(db, req.candidate!.smeUserId));

  app.post('/me/payee/onboarding-link', { config: { access: 'candidate', rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (r) => r.cookies?.praxis_candidate ?? r.ip } }, schema: { tags: ['payments'] } }, async (req) => onboardingLink(db, payouts, req.candidate!.smeUserId));

  // Back from the provider's page: ask the provider for the current status (webhooks also deliver it).
  app.post('/me/payee/refresh', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (r) => r.cookies?.praxis_candidate ?? r.ip } }, schema: { tags: ['payments'] } }, async (req) => {
    const p = await db.payee.findUnique({ where: { smeUserId: req.candidate!.smeUserId } });
    if (p?.payeeRef && p.provider === payouts.name) {
      const s = await payouts.getPayeeStatus(p.payeeRef);
      await db.$transaction((tx) => applyPayeeStatus(tx, p, s.status, s.payoutCurrency, { type: 'SYSTEM', id: `payout:${payouts.name}` }));
    }
    return payeeView(db, req.candidate!.smeUserId);
  });

  app.get('/me/earnings', { config: { access: 'candidate' }, schema: { tags: ['payments'] } }, async (req) => {
    const smeUserId = req.candidate!.smeUserId;
    const entries = await db.earningEntry.findMany({ where: { smeUserId }, orderBy: { earnedAt: 'desc' }, take: 500 });
    const items = await db.payoutItem.findMany({ where: { smeUserId, payRun: { status: { not: 'CANCELLED' } } }, include: { payRun: true }, orderBy: { createdAt: 'desc' } });
    const paidIds = new Set(items.filter((i) => i.status === 'PAID').flatMap((i) => i.entryIds));
    const inFlight = new Set(items.filter((i) => i.status === 'PENDING' || i.status === 'SUBMITTED').flatMap((i) => i.entryIds));
    const balance: Record<string, { earned: string; paid: string; inPayment: string; unpaid: string }> = {};
    for (const e of entries) {
      const b = (balance[e.currency] ??= { earned: '0', paid: '0', inPayment: '0', unpaid: '0' });
      const add = (k: keyof typeof b) => (b[k] = new Prisma.Decimal(b[k]).plus(e.amount).toFixed(2));
      add('earned');
      add(paidIds.has(e.id) ? 'paid' : inFlight.has(e.id) ? 'inPayment' : 'unpaid');
    }
    return {
      balance,
      minimumPayout: MINIMUM_PAYOUT,
      entries: entries.map((e) => ({ id: e.id, amount: e.amount.toFixed(2), currency: e.currency, kind: e.kind, taskId: e.sourceType === 'TaskInstance' ? e.sourceId : null, reason: e.reason, earnedAt: e.earnedAt.toISOString(), status: paidIds.has(e.id) ? 'PAID' : inFlight.has(e.id) ? 'IN_PAYMENT' : 'UNPAID' })),
      payouts: items.map((i) => ({ id: i.id, week: i.payRun.periodStart.toISOString().slice(0, 10), amount: i.amount.toFixed(2), currency: i.currency, status: i.status, holdReason: i.holdReason, fx: i.fx })),
    };
  });
};
