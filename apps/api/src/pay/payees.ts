import type { Payee } from '@prisma/client';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import { completeOnboardingIfDone } from '../candidate/onboarding-service';
import type { PayoutProvider } from './provider';

/**
 * Payee set-up (docs/SME-SUPPLY.md section 8.3): the SME opens the provider's hosted onboarding from the C07 checklist;
 * Praxis keeps the provider, the payee reference and the status only.
 */

/** Direct pay applies when any live requisition the SME came through pays them directly. */
export async function payeeRequired(tx: Db | Tx, smeUserId: string) {
  const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId } });
  if (!cand) return false;
  return !!(await tx.partnerSubmission.findFirst({ where: { candidateId: cand.id, sandbox: false, state: 'INVITED', requisition: { payRoute: 'DIRECT' } } }));
}

export async function payeeView(tx: Db | Tx, smeUserId: string) {
  const p = await tx.payee.findUnique({ where: { smeUserId } });
  const required = await payeeRequired(tx, smeUserId);
  if (!required) return { required: false, status: 'NOT_REQUIRED' as const, provider: p?.provider ?? null, payoutCurrency: p?.payoutCurrency ?? null, reason: null };
  return { required: true, status: p?.status ?? ('NOT_STARTED' as const), provider: p?.provider ?? null, payoutCurrency: p?.payoutCurrency ?? null, reason: p?.statusReason ?? null };
}

/** Creates the provider account on first use (outside a transaction: it calls the provider) and returns the hosted link. */
export async function onboardingLink(db: Db, provider: PayoutProvider, smeUserId: string) {
  if (!(await payeeRequired(db, smeUserId))) throw new AppError(409, 'PAYEE_NOT_REQUIRED', 'Your partner pays you for this work; no payment set-up is needed here.');
  const u = await db.smeUser.findUniqueOrThrow({ where: { id: smeUserId } });
  if (!u.contactEmail) throw new AppError(409, 'EMAIL_REQUIRED', 'Add an email address to your profile first.');
  let p: Payee | null = await db.payee.findUnique({ where: { smeUserId } });
  if (p?.status === 'BLOCKED') throw new AppError(409, 'PAYEE_BLOCKED', 'Your payment account is blocked. Contact support.');
  if (!p?.payeeRef) {
    const country = (await db.candidate.findUnique({ where: { smeUserId } }))?.country ?? (await db.supplyCandidate.findUnique({ where: { smeUserId } }))?.country ?? null;
    const { payeeRef } = await provider.createPayee({ smeUserId, email: u.contactEmail, name: u.displayName ?? 'SME', country });
    p = await db.$transaction(async (tx) => {
      const row = await tx.payee.upsert({ where: { smeUserId }, create: { clientId: u.clientId, smeUserId, provider: provider.name, payeeRef, status: 'PENDING' }, update: { provider: provider.name, payeeRef, status: 'PENDING' } });
      await tx.auditEvent.create({ data: { clientId: u.clientId, actorType: 'CANDIDATE', actorId: smeUserId, entityType: 'Payee', entityId: row.id, action: 'payee.created', after: { provider: provider.name, payeeRef } } });
      return row;
    });
  }
  const url = await provider.onboardingLink({ payeeRef: p.payeeRef!, email: u.contactEmail });
  await db.auditEvent.create({ data: { clientId: u.clientId, actorType: 'CANDIDATE', actorId: smeUserId, entityType: 'Payee', entityId: p.id, action: 'payee.onboarding_opened', after: { provider: p.provider } } });
  return { url, status: p.status };
}

/** A payee status from the provider (webhook or a refresh). READY may complete the C07 checklist. */
export async function applyPayeeStatus(tx: Tx, p: Payee, status: 'PENDING' | 'READY' | 'BLOCKED', payoutCurrency: string | null | undefined, actor: { type: 'SYSTEM'; id: string }, reason: string | null = null) {
  if (p.status === status && (payoutCurrency ?? p.payoutCurrency) === p.payoutCurrency) return p;
  const u = await tx.payee.update({ where: { id: p.id }, data: { status, payoutCurrency: payoutCurrency ?? p.payoutCurrency, statusReason: reason } });
  await tx.auditEvent.create({ data: { clientId: p.clientId, actorType: actor.type, actorId: actor.id, entityType: 'Payee', entityId: p.id, action: 'payee.status_changed', before: { status: p.status }, after: { status, payoutCurrency: u.payoutCurrency } } });
  if (status === 'READY') await completeOnboardingIfDone(tx, p.smeUserId);
  return u;
}
