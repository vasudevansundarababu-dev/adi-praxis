import { Prisma, type PayoutItem, type PayRun } from '@prisma/client';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import { MINIMUM_PAYOUT } from './ledger';
import { applyPayeeStatus } from './payees';
import { WebhookSignatureError, type PayoutProvider } from './provider';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 86_400_000;

/**
 * Weekly pay runs (docs/SME-SUPPLY.md section 8.3): build → PM confirm → Finance approve → submit → provider webhooks →
 * reconcile. Held items (payee not ready, SME suspended, a hold) are excluded and reported; balances under the minimum
 * carry forward. An entry is in at most one live payout item; held, failed and returned items release their entries.
 */

/** Monday 00:00 UTC of the week before `now` (the owner's Monday run for the previous Monday–Sunday). */
export function previousWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const thisMonday = new Date(d.getTime() - sinceMonday * DAY);
  return { periodStart: new Date(thisMonday.getTime() - 7 * DAY), periodEnd: thisMonday };
}

async function consumedEntryIds(tx: Tx, clientId: string) {
  const live = await tx.payoutItem.findMany({ where: { clientId, status: { in: ['PENDING', 'SUBMITTED', 'PAID'] }, payRun: { status: { not: 'CANCELLED' } } }, select: { entryIds: true } });
  return new Set(live.flatMap((i) => i.entryIds));
}

/** Why an SME's payout is held, or null. */
async function holdReason(tx: Tx, smeUserId: string) {
  const u = await tx.smeUser.findUnique({ where: { id: smeUserId } });
  if (!u || u.accountStatus !== 'ACTIVE') return 'SME account suspended or closed';
  const hold = await tx.payHold.findFirst({ where: { smeUserId, releasedAt: null }, orderBy: { createdAt: 'asc' } });
  if (hold) return `${hold.kind === 'FRAUD' ? 'Fraud flag' : 'Dispute'}: ${hold.reason}`;
  const standing = await tx.smeStanding.findFirst({ where: { smeUserId }, orderBy: { createdAt: 'desc' } });
  if (standing?.standing === 'SUSPENDED') return 'SME standing suspended';
  const p = await tx.payee.findUnique({ where: { smeUserId } });
  if (p?.status !== 'READY') return `Payee not ready (${p?.status ?? 'NOT_STARTED'})`;
  return null;
}

/** Builds the run for a week: one item per SME and currency. Idempotent per week (unique period). */
export async function buildPayRun(tx: Tx, clientId: string, period: { periodStart: Date; periodEnd: Date }, actor: { type: 'USER' | 'SYSTEM'; id: string }, audit?: Audit) {
  const existing = await tx.payRun.findUnique({ where: { clientId_periodStart: { clientId, periodStart: period.periodStart } } });
  if (existing && existing.status !== 'CANCELLED') throw new AppError(409, 'PAY_RUN_EXISTS', 'A pay run for this week already exists.', { payRunId: existing.id });
  if (existing) await tx.payRun.update({ where: { id: existing.id }, data: { periodStart: new Date(existing.periodStart.getTime() - 1) } }); // keep the cancelled run, free the week
  const run = await tx.payRun.create({ data: { clientId, periodStart: period.periodStart, periodEnd: period.periodEnd, createdById: actor.id } });
  const consumed = await consumedEntryIds(tx, clientId);
  const entries = (await tx.earningEntry.findMany({ where: { clientId, earnedAt: { lt: period.periodEnd } }, orderBy: { earnedAt: 'asc' } })).filter((e) => !consumed.has(e.id));
  const groups = new Map<string, typeof entries>();
  for (const e of entries) groups.set(`${e.smeUserId}|${e.currency}`, [...(groups.get(`${e.smeUserId}|${e.currency}`) ?? []), e]);
  const totals: Record<string, string> = {};
  const held: { smeUserId: string; currency: string; amount: string; reason: string }[] = [];
  const carried: { smeUserId: string; currency: string; amount: string; reason: string }[] = [];
  for (const [key, list] of groups) {
    const [smeUserId, currency] = key.split('|') as [string, string];
    const amount = list.reduce((n, e) => n.plus(e.amount), D(0));
    if (amount.lte(0)) {
      carried.push({ smeUserId, currency, amount: amount.toFixed(2), reason: 'Nothing to pay (reversals)' });
      continue;
    }
    if (amount.lt(MINIMUM_PAYOUT[currency] ?? '0')) {
      carried.push({ smeUserId, currency, amount: amount.toFixed(2), reason: `Below the ${currency} ${MINIMUM_PAYOUT[currency]} minimum; carried forward` });
      continue;
    }
    const reason = await holdReason(tx, smeUserId);
    await tx.payoutItem.create({ data: { clientId, payRunId: run.id, smeUserId, amount, currency, entryIds: list.map((e) => e.id), status: reason ? 'HELD' : 'PENDING', holdReason: reason, idempotencyKey: `${run.id}:${smeUserId}:${currency}` } });
    if (reason) held.push({ smeUserId, currency, amount: amount.toFixed(2), reason });
    else totals[currency] = D(totals[currency] ?? 0).plus(amount).toFixed(2);
  }
  const u = await tx.payRun.update({ where: { id: run.id }, data: { totals, report: { held, carried } as Prisma.InputJsonValue } });
  const entry = { entityType: 'PayRun', entityId: run.id, action: 'pay_run.built', after: { periodStart: period.periodStart.toISOString(), periodEnd: period.periodEnd.toISOString(), totals, held: held.length, carried: carried.length } };
  if (audit) await audit(entry);
  else await tx.auditEvent.create({ data: { clientId, actorType: actor.type, actorId: actor.id, ...entry } });
  return u;
}

async function lockRun(tx: Tx, clientId: string, id: string) {
  const run = await tx.payRun.findFirst({ where: { id, clientId } });
  if (!run) throw notFound('Pay run not found');
  await tx.$executeRaw`SELECT 1 FROM "PayRun" WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.payRun.findUniqueOrThrow({ where: { id } });
}

export async function confirmPayRun(tx: Tx, clientId: string, id: string, userId: string, audit: Audit) {
  const run = await lockRun(tx, clientId, id);
  if (run.status !== 'DRAFT') throw new AppError(409, 'NOT_DRAFT', `This pay run is ${run.status.toLowerCase()}.`);
  const u = await tx.payRun.update({ where: { id }, data: { status: 'CONFIRMED', confirmedBy: userId, confirmedAt: new Date() } });
  await audit({ entityType: 'PayRun', entityId: id, action: 'pay_run.confirmed', before: { status: run.status }, after: { status: 'CONFIRMED', totals: run.totals } });
  return u;
}

/**
 * Finance approval. An approver cannot approve a run that pays them. Above PAYRUN_SECOND_APPROVAL_ABOVE a second,
 * different Finance approver is needed; until then every approval is flagged as single-approver in the audit log.
 */
export async function approvePayRun(tx: Tx, config: Config, actor: { clientId: string; userId: string; email: string }, id: string, audit: Audit) {
  const run = await lockRun(tx, actor.clientId, id);
  if (run.status !== 'CONFIRMED') throw new AppError(409, run.status === 'DRAFT' ? 'NOT_CONFIRMED' : 'NOT_AWAITING_APPROVAL', run.status === 'DRAFT' ? 'A PM confirms the pay run before Finance approves it.' : `This pay run is ${run.status.toLowerCase()}.`);
  const payees = await tx.payoutItem.findMany({ where: { payRunId: id, status: 'PENDING' }, select: { smeUserId: true } });
  const paid = await tx.smeUser.findMany({ where: { id: { in: payees.map((p) => p.smeUserId) } }, select: { contactEmail: true } });
  if (paid.some((u) => u.contactEmail && u.contactEmail.toLowerCase() === actor.email.toLowerCase())) throw new AppError(403, 'APPROVER_IS_PAYEE', 'You are paid in this run; another Finance approver must approve it.');
  const approvals = (run.approvals as { userId: string; at: string; singleApprover: boolean }[]) ?? [];
  if (approvals.some((a) => a.userId === actor.userId)) throw new AppError(409, 'ALREADY_APPROVED', 'You already approved this pay run.');
  const threshold = config.PAYRUN_SECOND_APPROVAL_ABOVE ? Number(config.PAYRUN_SECOND_APPROVAL_ABOVE) : null;
  const largest = Math.max(0, ...Object.values(run.totals as Record<string, string>).map(Number));
  const needed = threshold !== null && Number.isFinite(threshold) && largest > threshold ? 2 : 1;
  const singleApprover = needed === 1;
  const next = [...approvals, { userId: actor.userId, at: new Date().toISOString(), singleApprover }];
  const done = next.length >= needed;
  const u = await tx.payRun.update({ where: { id }, data: { approvals: next as Prisma.InputJsonValue, status: done ? 'APPROVED' : 'CONFIRMED' } });
  await audit({ entityType: 'PayRun', entityId: id, action: done ? 'pay_run.approved' : 'pay_run.approval_recorded', after: { approvals: next.length, needed, singleApprover, sameAsConfirmer: run.confirmedBy === actor.userId, totals: run.totals } });
  return u;
}

export async function cancelPayRun(tx: Tx, clientId: string, id: string, reason: string, audit: Audit) {
  const run = await lockRun(tx, clientId, id);
  if (!['DRAFT', 'CONFIRMED', 'APPROVED'].includes(run.status)) throw new AppError(409, 'CANNOT_CANCEL', 'Submitted pay runs cannot be cancelled.');
  const u = await tx.payRun.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit({ entityType: 'PayRun', entityId: id, action: 'pay_run.cancelled', before: { status: run.status }, after: { reason } });
  return u;
}

/**
 * Submits an approved run to the provider. The provider call happens outside a transaction; every payment carries the
 * item's idempotency key, so a retry after a failure pays nobody twice. Held items are never submitted.
 */
export async function submitPayRun(db: Db, provider: PayoutProvider, actor: { clientId: string; userId: string }, id: string) {
  const run = await db.payRun.findFirst({ where: { id, clientId: actor.clientId }, include: { items: true } });
  if (!run) throw notFound('Pay run not found');
  if (run.status === 'SUBMITTED' || run.status === 'COMPLETED') return run;
  if (run.status !== 'APPROVED') throw new AppError(409, 'APPROVALS_REQUIRED', run.status === 'CANCELLED' ? 'This pay run was cancelled.' : 'This pay run needs PM confirmation and Finance approval before it is submitted.');
  const pending = run.items.filter((i) => i.status === 'PENDING');
  // Payee state may have changed since the build: re-check, and hold anyone no longer payable.
  const payable: (PayoutItem & { payeeRef: string })[] = [];
  for (const i of pending) {
    const p = await db.payee.findUnique({ where: { smeUserId: i.smeUserId } });
    if (p?.status === 'READY' && p.payeeRef) payable.push({ ...i, payeeRef: p.payeeRef });
    else await db.payoutItem.update({ where: { id: i.id }, data: { status: 'HELD', holdReason: `Payee not ready at submission (${p?.status ?? 'NOT_STARTED'})` } });
  }
  const res = payable.length ? await provider.submitBatch({ batchKey: run.id, items: payable.map((i) => ({ idempotencyKey: i.idempotencyKey, payeeRef: i.payeeRef, amount: i.amount.toFixed(2), currency: i.currency })) }) : { batchRef: null, payments: [] };
  const refs = new Map(res.payments.map((p) => [p.idempotencyKey, p.paymentRef]));
  return db.$transaction(async (tx) => {
    const locked = await lockRun(tx, actor.clientId, id);
    if (locked.status !== 'APPROVED') return locked;
    for (const i of payable) {
      const ref = refs.get(i.idempotencyKey);
      await tx.payoutItem.update({ where: { id: i.id }, data: ref ? { status: 'SUBMITTED', providerPaymentRef: ref } : { status: 'FAILED', failureReason: 'The provider did not accept this payment' } });
    }
    const u = await tx.payRun.update({ where: { id }, data: { status: payable.length ? 'SUBMITTED' : 'COMPLETED', providerBatchRef: res.batchRef, submittedAt: new Date() } });
    await tx.auditEvent.create({ data: { clientId: actor.clientId, actorType: 'USER', actorId: actor.userId, entityType: 'PayRun', entityId: id, action: 'pay_run.submitted', after: { provider: provider.name, batchRef: res.batchRef, submitted: refs.size, held: run.items.length - payable.length } } });
    return u;
  });
}

const FINAL = ['PAID', 'FAILED', 'RETURNED', 'HELD'];
const ALLOWED: Record<string, string[]> = { SUBMITTED: ['PAID', 'FAILED', 'RETURNED'], PAID: ['RETURNED'], PENDING: ['SUBMITTED', 'PAID', 'FAILED'] };

/**
 * Provider webhook: signature checked on the raw body, one receipt per provider event id (duplicates are ignored),
 * events from the other mode (test vs live) are recorded and ignored. Payment statuses reach PAID, FAILED or RETURNED.
 */
export async function processPayoutWebhook(db: Db, provider: PayoutProvider, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
  let e;
  try {
    e = provider.verifyWebhook(raw, headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError || err instanceof SyntaxError) throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
    throw err;
  }
  return db.$transaction(async (tx) => {
    if (await tx.payoutProviderEvent.findUnique({ where: { provider_eventId: { provider: provider.name, eventId: e.id } } })) return { duplicate: true, outcome: 'duplicate' };
    let outcome = 'ignored';
    let clientId: string | null = null;
    if (e.livemode !== provider.livemode) outcome = 'ignored_mode';
    else if (e.kind === 'payment' && e.paymentRef && e.paymentStatus) {
      const item = await tx.payoutItem.findUnique({ where: { providerPaymentRef: e.paymentRef } });
      if (item) {
        clientId = item.clientId;
        if ((ALLOWED[item.status] ?? []).includes(e.paymentStatus)) {
          await tx.payoutItem.update({ where: { id: item.id }, data: { status: e.paymentStatus, fx: (e.fx ?? item.fx ?? undefined) as Prisma.InputJsonValue | undefined, failureReason: e.paymentStatus === 'PAID' ? null : (e.reason ?? null) } });
          await tx.auditEvent.create({ data: { clientId: item.clientId, actorType: 'SYSTEM', actorId: `payout:${provider.name}`, entityType: 'PayoutItem', entityId: item.id, action: `payout.${e.paymentStatus.toLowerCase()}`, before: { status: item.status }, after: { status: e.paymentStatus, fx: e.fx ?? null, reason: e.reason ?? null } } });
          const open = await tx.payoutItem.count({ where: { payRunId: item.payRunId, status: { notIn: FINAL as never } } });
          if (!open) await tx.payRun.updateMany({ where: { id: item.payRunId, status: 'SUBMITTED' }, data: { status: 'COMPLETED' } });
          outcome = 'applied';
        } else outcome = 'stale';
      } else outcome = 'unknown_payment';
    } else if (e.kind === 'payee' && e.payeeRef && e.payeeStatus) {
      const p = await tx.payee.findUnique({ where: { provider_payeeRef: { provider: provider.name, payeeRef: e.payeeRef } } });
      if (p) {
        clientId = p.clientId;
        await applyPayeeStatus(tx, p, e.payeeStatus, e.payoutCurrency, { type: 'SYSTEM', id: `payout:${provider.name}` });
        outcome = 'applied';
      } else outcome = 'unknown_payee';
    }
    await tx.payoutProviderEvent.create({ data: { clientId, provider: provider.name, eventId: e.id, type: `${e.kind}${e.paymentStatus ? `.${e.paymentStatus}` : e.payeeStatus ? `.${e.payeeStatus}` : ''}`, livemode: e.livemode, payloadHash: sha256(raw.toString('utf8')), outcome } });
    return { duplicate: false, outcome };
  });
}

/**
 * Daily reconciliation: the provider's settlement report for a day against our payout items. Every mismatch becomes an
 * open exception (once per day, kind and payment): unknown payment, amount or currency differs, status differs, or a
 * payment we marked PAID that day is missing from the report.
 */
export async function reconcile(db: Db, provider: PayoutProvider, day: Date) {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const lines = await provider.getSettlementReport(d);
  const mismatches: { kind: string; paymentRef: string; payoutItemId: string | null; clientId: string | null; detail: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    seen.add(l.paymentRef);
    const item = await db.payoutItem.findUnique({ where: { providerPaymentRef: l.paymentRef } });
    if (!item) {
      mismatches.push({ kind: 'UNKNOWN_PAYMENT', paymentRef: l.paymentRef, payoutItemId: null, clientId: null, detail: { report: l } });
      continue;
    }
    if (!item.amount.equals(D(l.amount)) || item.currency !== l.currency) mismatches.push({ kind: 'AMOUNT_MISMATCH', paymentRef: l.paymentRef, payoutItemId: item.id, clientId: item.clientId, detail: { expected: { amount: item.amount.toFixed(2), currency: item.currency }, report: { amount: l.amount, currency: l.currency } } });
    if (item.status !== l.status) mismatches.push({ kind: 'STATUS_MISMATCH', paymentRef: l.paymentRef, payoutItemId: item.id, clientId: item.clientId, detail: { expected: item.status, report: l.status } });
  }
  const paidThatDay = await db.payoutItem.findMany({ where: { status: 'PAID', updatedAt: { gte: d, lt: new Date(d.getTime() + DAY) }, providerPaymentRef: { not: null } } });
  for (const i of paidThatDay) if (!seen.has(i.providerPaymentRef!)) mismatches.push({ kind: 'MISSING_IN_REPORT', paymentRef: i.providerPaymentRef!, payoutItemId: i.id, clientId: i.clientId, detail: { expected: { amount: i.amount.toFixed(2), currency: i.currency, status: i.status } } });

  // Exceptions belong to a client; a payment unknown to us is filed under every client that has pay runs.
  const clients = mismatches.some((m) => !m.clientId) ? (await db.payRun.findMany({ distinct: ['clientId'], select: { clientId: true } })).map((r) => r.clientId) : [];
  let created = 0;
  for (const m of mismatches) {
    for (const clientId of m.clientId ? [m.clientId] : clients) {
      const exists = await db.payoutException.findUnique({ where: { reportDate_kind_paymentRef: { reportDate: d, kind: m.kind, paymentRef: m.paymentRef } } });
      if (exists) continue;
      const x = await db.payoutException.create({ data: { clientId, reportDate: d, kind: m.kind, paymentRef: m.paymentRef, payoutItemId: m.payoutItemId, detail: m.detail as Prisma.InputJsonValue } });
      await db.auditEvent.create({ data: { clientId, actorType: 'SYSTEM', actorId: 'payout-reconciliation', entityType: 'PayoutException', entityId: x.id, action: 'payout.exception_opened', after: { kind: m.kind, paymentRef: m.paymentRef } } });
      created++;
    }
  }
  return { day: d.toISOString().slice(0, 10), lines: lines.length, mismatches, created };
}

export const payRunDto = (r: PayRun & { items?: PayoutItem[] }) => ({
  id: r.id,
  periodStart: r.periodStart.toISOString(),
  periodEnd: r.periodEnd.toISOString(),
  status: r.status,
  confirmedBy: r.confirmedBy,
  approvals: r.approvals,
  totals: r.totals,
  report: r.report,
  providerBatchRef: r.providerBatchRef,
  submittedAt: r.submittedAt?.toISOString() ?? null,
  items: r.items?.map((i) => ({ id: i.id, smeUserId: i.smeUserId, amount: i.amount.toFixed(2), currency: i.currency, entries: i.entryIds.length, status: i.status, holdReason: i.holdReason, providerPaymentRef: i.providerPaymentRef, fx: i.fx, failureReason: i.failureReason })),
});
