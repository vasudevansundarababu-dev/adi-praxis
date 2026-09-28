import { Prisma, type EarningEntry } from '@prisma/client';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { EventHandler } from '../outbox/handlers';
import type { writeAudit } from '../platform/audit';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Earnings ledger and partner fees (docs/SME-SUPPLY.md section 8.3). Both ledgers are append-only in the database: an
 * entry is never changed or deleted, and a correction is a reversing entry that points at the original.
 */

export const CURRENCIES = ['USD', 'INR'] as const;
/** Pay-run minimum per SME and currency; smaller balances carry forward (owner decision, 28 Sep 2026). */
export const MINIMUM_PAYOUT: Record<string, string> = { USD: '10.00', INR: '500.00' };

/** The requisition (and so the rate card) an SME's work on a project is paid under: their live, invited submission. */
async function requisitionFor(tx: Tx, smeUserId: string, projectId: string) {
  const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId } });
  if (!cand) return null;
  const s = await tx.partnerSubmission.findFirst({ where: { candidateId: cand.id, state: 'INVITED', sandbox: false, requisition: { projectId } }, include: { requisition: true }, orderBy: { createdAt: 'asc' } });
  return s?.requisition ?? null;
}

/**
 * Records what a task earns when a person accepts it (FLOW 3 review, event `task.accepted`): exactly one entry per
 * task at the requisition's rate card price. A replayed or repeated event finds the entry and creates none.
 */
export async function recordTaskEarning(tx: Tx, taskId: string, acceptedAt = new Date()) {
  const t = await tx.taskInstance.findUnique({ where: { id: taskId } });
  if (!t?.assignedToId) return null;
  const cand = await tx.candidate.findUnique({ where: { id: t.assignedToId } });
  if (!cand) return null;
  const r = await requisitionFor(tx, cand.smeUserId, t.projectId);
  // Work outside M10 requisitions, or a partner who pays its own people, earns nothing in this ledger.
  if (!r?.rateCardId || r.payRoute !== 'DIRECT') return null;
  const kind = t.taskType === 'RL_REVIEW' ? 'RL_REVIEW' : 'TASK';
  const existing = await tx.earningEntry.findUnique({ where: { sourceType_sourceId_kind: { sourceType: 'TaskInstance', sourceId: t.id, kind } } });
  if (existing) return existing;
  const card = await tx.rateCard.findUniqueOrThrow({ where: { id: r.rateCardId } });
  const price = (card.perTask as Record<string, string>)[t.taskType];
  if (!price) {
    await tx.auditEvent.create({ data: { clientId: t.clientId, actorType: 'SYSTEM', actorId: 'earnings', entityType: 'TaskInstance', entityId: t.id, action: 'earning.no_rate', after: { rateCardId: card.id, taskType: t.taskType } } });
    return null;
  }
  const e = await tx.earningEntry.create({
    data: { clientId: t.clientId, smeUserId: cand.smeUserId, amount: D(price), currency: card.currency, kind, sourceType: 'TaskInstance', sourceId: t.id, requisitionId: r.id, rateCardId: card.id, rateCardVersion: card.version, earnedAt: acceptedAt },
  });
  await tx.auditEvent.create({ data: { clientId: t.clientId, actorType: 'SYSTEM', actorId: 'earnings', entityType: 'EarningEntry', entityId: e.id, action: 'earning.recorded', after: { smeUserId: e.smeUserId, amount: e.amount.toFixed(2), currency: e.currency, taskId: t.id, rateCard: `${card.name} v${card.version}` } } });
  return e;
}

/** A correction: a new entry with the opposite amount. An entry is reversed at most once; a reversal is never reversed. */
export async function reverseEarning(tx: Tx, clientId: string, entryId: string, reason: string, userId: string, audit: Audit) {
  const e = await tx.earningEntry.findFirst({ where: { id: entryId, clientId } });
  if (!e) throw notFound('Earning entry not found');
  if (e.kind === 'REVERSAL') throw new AppError(409, 'IS_REVERSAL', 'A reversal cannot be reversed; record a new entry instead.');
  if (await tx.earningEntry.findUnique({ where: { reversesId: e.id } })) throw new AppError(409, 'ALREADY_REVERSED', 'This entry was already reversed.');
  const r = await tx.earningEntry.create({ data: { clientId, smeUserId: e.smeUserId, amount: e.amount.negated(), currency: e.currency, kind: 'REVERSAL', sourceType: 'EarningEntry', sourceId: e.id, requisitionId: e.requisitionId, rateCardId: e.rateCardId, rateCardVersion: e.rateCardVersion, reversesId: e.id, reason, createdById: userId } });
  await audit({ entityType: 'EarningEntry', entityId: r.id, action: 'earning.reversed', after: { reverses: e.id, amount: r.amount.toFixed(2), currency: r.currency, reason } });
  return r;
}

export const earningDto = (e: EarningEntry) => ({ id: e.id, smeUserId: e.smeUserId, amount: e.amount.toFixed(2), currency: e.currency, kind: e.kind, sourceType: e.sourceType, sourceId: e.sourceId, requisitionId: e.requisitionId, rateCardVersion: e.rateCardVersion, reversesId: e.reversesId, reason: e.reason, earnedAt: e.earnedAt.toISOString() });

// ── Partner fees ──

/**
 * One fee entry per certified candidate for the partner who supplied them (event `cert.certified`). Without agreed fee
 * terms the entry is still written, at zero, so Finance sees it on the statement and can agree the fee.
 */
export async function recordPartnerFee(tx: Tx, certificationId: string) {
  const c = await tx.certification.findUnique({ where: { id: certificationId } });
  if (!c) return null;
  const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId: c.smeUserId } });
  if (!cand) return null;
  const s = await tx.partnerSubmission.findFirst({ where: { candidateId: cand.id, sandbox: false, partnerId: { not: null }, state: 'INVITED', ...(c.requisitionId ? { requisitionId: c.requisitionId } : {}) }, include: { partner: true }, orderBy: { createdAt: 'asc' } });
  if (!s?.partner) return null;
  const existing = await tx.partnerFeeEntry.findUnique({ where: { partnerId_certificationId: { partnerId: s.partner.id, certificationId: c.id } } });
  if (existing) return existing;
  const p = s.partner;
  const f = await tx.partnerFeeEntry.create({ data: { clientId: c.clientId, partnerId: p.id, certificationId: c.id, submissionId: s.id, amount: p.certifiedFee ?? D(0), currency: p.feeCurrency, feeTermsVersion: p.feeTermsVersion, reason: p.certifiedFee === null ? 'NO_FEE_TERMS' : null } });
  await tx.auditEvent.create({ data: { clientId: c.clientId, actorType: 'SYSTEM', actorId: 'partner-fees', entityType: 'PartnerFeeEntry', entityId: f.id, action: 'partner_fee.recorded', after: { partnerId: p.id, certificationId: c.id, amount: f.amount.toFixed(2), currency: f.currency, feeTermsVersion: p.feeTermsVersion } } });
  return f;
}

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};

/** Monthly statements: one per partner with fee entries that month. Payment happens outside Praxis. Idempotent. */
export async function buildStatements(db: Db, clientId: string, period: string, actor: { type: 'USER' | 'SYSTEM'; id: string }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError(400, 'BAD_PERIOD', 'Use a period like 2026-10.');
  const { from, to } = monthRange(period);
  const entries = await db.partnerFeeEntry.findMany({ where: { clientId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } });
  const byPartner = new Map<string, typeof entries>();
  for (const e of entries) byPartner.set(e.partnerId, [...(byPartner.get(e.partnerId) ?? []), e]);
  const made = [];
  for (const [partnerId, list] of byPartner) {
    const st = await db.$transaction(async (tx) => {
      if (await tx.partnerStatement.findUnique({ where: { partnerId_period: { partnerId, period } } })) return null;
      const totals: Record<string, string> = {};
      for (const e of list) totals[e.currency] = D(totals[e.currency] ?? 0).plus(e.amount).toFixed(2);
      const s = await tx.partnerStatement.create({ data: { clientId: list[0]!.clientId, partnerId, period, totals, entryIds: list.map((e) => e.id) } });
      await tx.auditEvent.create({ data: { clientId: s.clientId, actorType: actor.type, actorId: actor.id, entityType: 'PartnerStatement', entityId: s.id, action: 'partner_statement.issued', after: { partnerId, period, totals, entries: list.length } } });
      return s;
    });
    if (st) made.push(st);
  }
  return made;
}

export async function statementDto(db: Db | Tx, s: { id: string; partnerId: string; period: string; totals: unknown; entryIds: string[]; status: string; createdAt: Date }) {
  const entries = await db.partnerFeeEntry.findMany({ where: { id: { in: s.entryIds } }, orderBy: { createdAt: 'asc' } });
  const subs = await db.partnerSubmission.findMany({ where: { id: { in: entries.map((e) => e.submissionId).filter((x): x is string => !!x) } }, select: { id: true, partnerRef: true } });
  const ref = new Map(subs.map((x) => [x.id, x.partnerRef]));
  return {
    id: s.id,
    period: s.period,
    status: s.status,
    totals: s.totals,
    issuedAt: s.createdAt.toISOString(),
    // Partner-facing: their own candidate ids and references, never internal ids.
    lines: entries.map((e) => ({ candidateId: e.submissionId, partnerRef: e.submissionId ? (ref.get(e.submissionId) ?? null) : null, amount: e.amount.toFixed(2), currency: e.currency, feeTermsVersion: e.feeTermsVersion, note: e.reason, reverses: e.reversesId, at: e.createdAt.toISOString() })),
  };
}

/** M10c event handlers (registered with SME supply on): task earnings and partner fees. */
export function payHandlers(): EventHandler[] {
  return [
    {
      name: 'm10.task-earning',
      event: 'task.accepted',
      async handle(event, tx) {
        // Earned when the task was accepted (the event time), not when the worker handled it.
        await recordTaskEarning(tx, (event.payload as { taskId: string }).taskId, event.createdAt);
      },
    },
    {
      name: 'm10.partner-fee',
      event: 'cert.certified',
      async handle(event, tx) {
        await recordPartnerFee(tx, (event.payload as { certificationId: string }).certificationId);
      },
    },
  ];
}
