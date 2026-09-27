import type { IdentityStatus, Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import type { AuthoritativeStatus, IdentityProvider } from './identity-provider';

export const ELIGIBLE: IdentityStatus[] = ['VERIFIED', 'ALTERNATIVE_VERIFIED'];

/** Candidate-facing text for an attempt's reason code. Never frames an identity problem as an expertise judgement. */
export function identityProblemText(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case 'UNDER_18':
      return 'Contributors must be 18 or over. This is not a judgement about your expertise.';
    case 'AGE_UNKNOWN':
      return 'We could not confirm your age from the document. Our team will review this and contact you.';
    case 'TEST_MODE_RESULT_IGNORED':
      return 'This check ran in test mode, which does not count as live verification.';
    case 'UNSUPPORTED_DOCUMENT':
    case 'UNSUPPORTED_COUNTRY':
    case 'CONSENT':
    case 'TECHNICAL':
    case 'OTHER':
      return 'You asked for help with verification. Our team will contact you about an approved alternative.';
    default:
      return `The check needs more information (${code.replace(/_/g, ' ')}). You can try again with another document or ask for help.`;
  }
}

/** Maps the provider's authoritative status to our attempt status and reason code. */
function outcome(s: AuthoritativeStatus, requireLive: boolean): { status: IdentityStatus; errorCode: string | null; grants: boolean } {
  switch (s.status) {
    case 'requires_input':
      return { status: 'REQUIRES_INPUT', errorCode: s.lastErrorCode, grants: false };
    case 'processing':
      return { status: 'PROCESSING', errorCode: null, grants: false };
    case 'canceled':
      return { status: 'CANCELED', errorCode: null, grants: false };
    case 'verified':
      if (requireLive && !s.livemode) return { status: 'VERIFIED', errorCode: 'TEST_MODE_RESULT_IGNORED', grants: false };
      if (s.adult === false) return { status: 'CANCELED', errorCode: 'UNDER_18', grants: false };
      if (s.adult === null) return { status: 'MANUAL_REVIEW_REQUIRED', errorCode: 'AGE_UNKNOWN', grants: false };
      return { status: 'VERIFIED', errorCode: null, grants: true };
  }
}

export type WebhookResult = 'processed' | 'duplicate' | 'stale' | 'unknown_session';

/**
 * Processes one identity webhook (FLOW2 C02, CF-04/CF-05): verified signature, deduplicated by event id,
 * out-of-order events ignored, status read back from the provider, test mode never confers live eligibility.
 * Everything commits in one transaction with its audit event.
 */
export async function processIdentityWebhook(
  db: Db,
  provider: IdentityProvider,
  opts: { requireLive: boolean },
  rawBody: Buffer,
  signature: string | undefined,
): Promise<WebhookResult> {
  const event = provider.parseWebhook(rawBody, signature); // throws on a bad signature

  return db.$transaction(async (tx) => {
    const seen = await tx.webhookReceipt.findUnique({ where: { provider_externalEventId: { provider: 'stripe_identity', externalEventId: event.id } } });
    if (seen) return 'duplicate';
    const attempt = await tx.identityAttempt.findUnique({ where: { providerSessionId: event.sessionId }, include: { smeUser: true } });
    const receipt = {
      provider: 'stripe_identity',
      externalEventId: event.id,
      livemode: event.livemode,
      payloadHash: sha256(rawBody.toString()),
      clientId: attempt?.clientId ?? null,
    };
    if (!attempt) {
      await tx.webhookReceipt.create({ data: { ...receipt, processedAt: new Date() } });
      return 'unknown_session';
    }
    const eventAt = new Date(event.created * 1000);
    if (attempt.lastEventAt && eventAt < attempt.lastEventAt) {
      await tx.webhookReceipt.create({ data: { ...receipt, processedAt: new Date() } });
      return 'stale';
    }

    const status = await provider.retrieve(event.sessionId);
    const o = outcome(status, opts.requireLive);
    const before = { attemptStatus: attempt.status, identityStatus: attempt.smeUser.identityStatus };
    await tx.identityAttempt.update({
      where: { id: attempt.id },
      data: {
        status: o.status,
        errorCode: o.errorCode,
        livemode: status.livemode,
        adultConfirmed: status.status === 'verified' ? status.adult : attempt.adultConfirmed,
        checkedAt: new Date(),
        lastEventAt: eventAt,
      },
    });

    // Once eligible, later provider events never downgrade the account; a test-mode result never upgrades it.
    const current = attempt.smeUser.identityStatus;
    let next: IdentityStatus = current;
    if (o.grants) next = 'VERIFIED';
    else if (!ELIGIBLE.includes(current) && o.errorCode !== 'TEST_MODE_RESULT_IGNORED') next = o.status;
    if (next !== current) await tx.smeUser.update({ where: { id: attempt.smeUserId }, data: { identityStatus: next } });

    await tx.auditEvent.create({
      data: {
        clientId: attempt.clientId,
        actorType: 'SYSTEM',
        actorId: 'identity-webhook',
        entityType: 'SmeUser',
        entityId: attempt.smeUserId,
        action: 'identity.provider_update',
        before: before as Prisma.InputJsonValue,
        after: { attemptStatus: o.status, identityStatus: next, errorCode: o.errorCode, livemode: status.livemode, eventId: event.id },
      },
    });
    await tx.webhookReceipt.create({ data: { ...receipt, processedAt: new Date() } });
    return 'processed';
  });
}

/** The candidate's latest identity attempt, if any. */
export const latestAttempt = (tx: Db | Tx, smeUserId: string) =>
  tx.identityAttempt.findFirst({ where: { smeUserId }, orderBy: { createdAt: 'desc' } });
