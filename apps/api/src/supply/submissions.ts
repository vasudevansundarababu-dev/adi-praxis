import type { PartnerSubmission, Prisma, Requisition } from '@prisma/client';
import {
  CandidateSubmissionInput,
  COOL_OFF_DAYS,
  INVITE_REMINDER_DAYS,
  INVITE_VALID_DAYS,
  MinimumRequirements,
  normaliseEmail,
  normalisePhone,
  OWNERSHIP_DAYS,
  SANDBOX_SIMULATIONS,
  screenRequirements,
  type PartnerWebhookEvent,
} from '@praxis/shared';
import type { Db, Tx } from '../db';
import { newToken, sha256 } from '../lib/crypto';
import type { EmailSender } from '../lib/email';
import { AppError, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import { notifyPartner } from './webhooks';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
const DAY = 86_400_000;

/**
 * Candidate submission (docs/SME-SUPPLY.md sections 5 and 6). A partner (or the candidate, on the direct careers page)
 * puts a person forward for a requisition. The platform checks for duplicates, runs the requirement screen (a
 * recommendation only), and invites the person into the unchanged FLOW 2 journey. No one is ever rejected without a
 * human decision: "not met" must be confirmed by a Validator, and FLOW 2 selection is always human.
 *
 * Ownership (owner decision): the first valid submission owns the candidate for 12 months while it is active. When it
 * ends (withdrawn, expired, confirmed not met) a 90-day cool-off applies to every channel. Duplicate reasons never name
 * the owning partner.
 */
export const DUPLICATE_OWNED = 'This candidate is already registered with ADI Praxis through another submission.';
export const duplicateCoolOff = (until: Date) => `This candidate was put forward recently. They can be submitted again from ${until.toISOString().slice(0, 10)}.`;

export interface Channel {
  partnerId: string | null;
  sandbox: boolean;
  channel: 'PARTNER_API' | 'PARTNER_PORTAL' | 'DIRECT';
}

/** Records one state change in the partner-visible history, audits it and tells the partner. */
export async function recordState(
  tx: Tx,
  sub: Pick<PartnerSubmission, 'id' | 'clientId' | 'partnerId' | 'sandbox' | 'partnerRef' | 'requisitionId'>,
  change: { dimension: string; from: string | null; to: string; reason?: string | null; event?: PartnerWebhookEvent | null; data?: Record<string, unknown> },
  audit: Audit | null,
) {
  await tx.candidateStateEvent.create({ data: { clientId: sub.clientId, submissionId: sub.id, dimension: change.dimension, fromState: change.from, toState: change.to, reason: change.reason ?? null } });
  const entry = { entityType: 'PartnerSubmission', entityId: sub.id, action: `supply.${change.dimension}.${change.to.toLowerCase()}`, before: { [change.dimension]: change.from }, after: { [change.dimension]: change.to, reason: change.reason ?? null } };
  if (audit) await audit(entry);
  else await tx.auditEvent.create({ data: { clientId: sub.clientId, actorType: 'SYSTEM', actorId: 'sme-supply', ...entry } });
  if (change.event) await notifyPartner(tx, { partnerId: sub.partnerId, sandbox: sub.sandbox, type: change.event, data: { candidateId: sub.id, partnerRef: sub.partnerRef, requisitionId: sub.requisitionId, dimension: change.dimension, state: change.to, reason: change.reason ?? null, ...(change.data ?? {}) } });
}

const ACTIVE: PartnerSubmission['state'][] = ['RECEIVED', 'INVITED'];

async function activeOwner(tx: Tx, candidateId: string, now: Date) {
  return tx.partnerSubmission.findFirst({ where: { candidateId, state: { in: ACTIVE }, endedAt: null, ownerUntil: { gt: now } }, orderBy: { createdAt: 'asc' } });
}

async function coolOffUntil(tx: Tx, candidateId: string) {
  const last = await tx.partnerSubmission.findFirst({ where: { candidateId, endedAt: { not: null } }, orderBy: { endedAt: 'desc' } });
  return last?.endedAt ? new Date(last.endedAt.getTime() + COOL_OFF_DAYS * DAY) : null;
}

function checkRequisition(r: Requisition, ch: Channel, now: Date) {
  if (r.state !== 'OPEN') throw new AppError(409, 'REQUISITION_NOT_OPEN', 'This requisition is not accepting candidates.');
  if (r.submissionDeadline && r.submissionDeadline < now) throw new AppError(409, 'DEADLINE_PASSED', 'The submission deadline for this requisition has passed.');
  if (ch.channel === 'DIRECT' ? !r.directChannel : !ch.partnerId || !r.allowedPartnerIds.includes(ch.partnerId)) throw notFound('Requisition not found');
}

export async function sendInvite(tx: Tx, email: EmailSender | null, sub: PartnerSubmission & { candidate: { name: string; emailNorm: string } }, r: Requisition, appUrl: string, audit: Audit | null) {
  const token = newToken();
  const now = new Date();
  const updated = await tx.partnerSubmission.update({ where: { id: sub.id }, data: { state: 'INVITED', inviteTokenHash: sha256(token), invitedAt: now, inviteExpiresAt: new Date(now.getTime() + INVITE_VALID_DAYS * DAY) } });
  await recordState(tx, updated, { dimension: 'submission', from: sub.state, to: 'INVITED', event: 'candidate.invited', data: { inviteExpiresAt: updated.inviteExpiresAt!.toISOString() } }, audit);
  // Sandbox candidates are simulated: nothing is sent to a real person.
  if (!sub.sandbox && email) {
    await email.send({
      to: sub.candidate.emailNorm,
      subject: `You have been put forward for "${r.title}" on ADI Praxis`,
      text: `Hello ${sub.candidate.name},\n\nYou have been put forward for "${r.title}" on ADI Praxis, a platform where subject-matter experts create training tasks for AI agents.\n\nTo continue, sign in and complete your profile within ${INVITE_VALID_DAYS} days:\n${appUrl}/partner-invite/${token}\n\nIf you did not expect this email, you can ignore it.\n\nADI Praxis`,
    });
  }
  return token;
}

/**
 * Submits a candidate. Returns 201 with the submission, or 409 DUPLICATE_CANDIDATE (the duplicate is still recorded,
 * so the partner's history and the audit log show it).
 */
export async function submitCandidate(
  tx: Tx,
  deps: { email: EmailSender | null; appUrl: string },
  args: { clientId: string; ch: Channel; requisitionId: string; input: CandidateSubmissionInput; smeUserId?: string | null },
  audit: Audit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = new Date();
  const r = await tx.requisition.findFirst({ where: { id: args.requisitionId, clientId: args.clientId } });
  if (!r) throw notFound('Requisition not found');
  checkRequisition(r, args.ch, now);
  const i = args.input;
  if (args.ch.partnerId) {
    const partner = await tx.partner.findUniqueOrThrow({ where: { id: args.ch.partnerId } });
    if ((partner.allowedDomains.length && !partner.allowedDomains.map((d) => d.toLowerCase()).includes(r.domain)) || (partner.allowedTiers.length && !partner.allowedTiers.includes(r.tier))) throw notFound('Requisition not found');
    if (i.partnerRef && (await tx.partnerSubmission.findUnique({ where: { partnerId_partnerRef: { partnerId: partner.id, partnerRef: i.partnerRef } } }))) {
      throw new AppError(409, 'PARTNER_REF_IN_USE', 'You already used this partnerRef for another submission.');
    }
    if (r.maxPerPartner) {
      const used = await tx.partnerSubmission.count({ where: { requisitionId: r.id, partnerId: partner.id, sandbox: args.ch.sandbox, state: { not: 'DUPLICATE' } } });
      if (used >= r.maxPerPartner) throw new AppError(409, 'PARTNER_LIMIT_REACHED', `This requisition accepts up to ${r.maxPerPartner} candidates per partner.`);
    }
  }

  // One person across channels: lock (or create) the candidate record keyed on the normalised email, then the phone.
  const emailNorm = normaliseEmail(i.email);
  const phoneNorm = normalisePhone(i.phone, i.country);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supply:${args.clientId}:${args.ch.sandbox}:${emailNorm}`}))`;
  let cand = await tx.supplyCandidate.findUnique({ where: { clientId_sandbox_emailNorm: { clientId: args.clientId, sandbox: args.ch.sandbox, emailNorm } } });
  if (!cand && phoneNorm) cand = await tx.supplyCandidate.findFirst({ where: { clientId: args.clientId, sandbox: args.ch.sandbox, phoneNorm } });
  if (!cand && args.smeUserId) cand = await tx.supplyCandidate.findUnique({ where: { smeUserId: args.smeUserId } });
  cand ??= await tx.supplyCandidate.create({ data: { clientId: args.clientId, sandbox: args.ch.sandbox, emailNorm, phoneNorm, name: i.name, country: i.country, smeUserId: args.smeUserId ?? null } });
  await tx.$executeRaw`SELECT 1 FROM "SupplyCandidate" WHERE id = ${cand.id}::uuid FOR UPDATE`;

  const owner = await activeOwner(tx, cand.id, now);
  let partnerId = args.ch.partnerId;
  let duplicateReason: string | null = null;
  let ownerUntil = new Date(now.getTime() + OWNERSHIP_DAYS * DAY);
  if (owner) {
    if (owner.requisitionId === r.id && (owner.partnerId === partnerId || args.ch.channel === 'DIRECT')) {
      throw new AppError(409, 'ALREADY_SUBMITTED', 'This candidate is already submitted for this requisition.');
    }
    if (args.ch.channel === 'DIRECT' && owner.partnerId) {
      // A direct application from someone a partner owns stays credited to that partner.
      partnerId = owner.partnerId;
      ownerUntil = owner.ownerUntil!;
    } else if (owner.partnerId === partnerId) ownerUntil = owner.ownerUntil!;
    else duplicateReason = DUPLICATE_OWNED;
  } else {
    const until = await coolOffUntil(tx, cand.id);
    if (until && until > now) duplicateReason = duplicateCoolOff(until);
  }

  const details = { phone: i.phone ?? null, experienceSummary: i.experienceSummary, experienceYears: i.experienceYears, employmentHistory: i.employmentHistory, qualifications: i.qualifications, languages: i.languages, partnerTrainingAttestation: i.partnerTrainingAttestation, candidateConsent: i.candidateConsent };
  const sub = await tx.partnerSubmission.create({
    data: {
      clientId: args.clientId,
      partnerId,
      requisitionId: r.id,
      candidateId: cand.id,
      channel: args.ch.channel,
      partnerRef: args.ch.channel === 'DIRECT' ? null : (i.partnerRef ?? null),
      state: duplicateReason ? 'DUPLICATE' : 'RECEIVED',
      duplicateReason,
      ownerUntil: duplicateReason ? null : ownerUntil,
      details: details as Prisma.InputJsonValue,
      sandbox: args.ch.sandbox,
    },
    include: { candidate: true },
  });
  await recordState(tx, sub, { dimension: 'submission', from: null, to: 'RECEIVED', event: 'candidate.received' }, audit);
  if (duplicateReason) {
    await recordState(tx, sub, { dimension: 'submission', from: 'RECEIVED', to: 'DUPLICATE', reason: duplicateReason, event: 'candidate.duplicate' }, audit);
    return { status: 409, body: { error: 'DUPLICATE_CANDIDATE', message: duplicateReason, candidateId: sub.id, state: 'DUPLICATE' } };
  }

  // Requirement screen: a recommendation for a Validator, never a rejection.
  const screen = screenRequirements({ ...MinimumRequirements.parse(r.minimumRequirements ?? {}), languages: r.languages }, i);
  await tx.partnerSubmission.update({ where: { id: sub.id }, data: { screen: screen.state, screenReasons: screen.reasons } });
  await recordState(tx, sub, { dimension: 'screen', from: 'NOT_RUN', to: screen.state, reason: screen.reasons.join(' ') || null, event: null }, audit);

  if (args.ch.channel === 'DIRECT') {
    // The candidate applied themselves while signed in: they are "invited" and have accepted at once.
    const s2 = await tx.partnerSubmission.update({ where: { id: sub.id }, data: { state: 'INVITED', invitedAt: now, inviteAcceptedAt: now } });
    await recordState(tx, s2, { dimension: 'submission', from: 'RECEIVED', to: 'INVITED', reason: 'Applied directly', event: 'candidate.invited' }, audit);
  } else {
    await sendInvite(tx, deps.email, { ...sub, screen: screen.state }, r, deps.appUrl, audit);
  }
  const fresh = await tx.partnerSubmission.findUniqueOrThrow({ where: { id: sub.id } });
  return { status: 201, body: { candidateId: fresh.id, state: fresh.state, screen: fresh.screen, screenReasons: screen.reasons, ownerUntil: fresh.ownerUntil?.toISOString() ?? null, inviteExpiresAt: fresh.inviteExpiresAt?.toISOString() ?? null } };
}

/** Current state per dimension (the latest history entry of each) and the full history, oldest first. */
export async function candidateView(tx: Db | Tx, sub: PartnerSubmission) {
  const history = await tx.candidateStateEvent.findMany({ where: { submissionId: sub.id }, orderBy: { at: 'asc' } });
  const current: Record<string, string> = { submission: sub.state, screen: sub.screen };
  for (const h of history) if (!(h.dimension in { submission: 1, screen: 1 })) current[h.dimension] = h.toState;
  return {
    candidateId: sub.id,
    partnerRef: sub.partnerRef,
    requisitionId: sub.requisitionId,
    channel: sub.channel,
    sandbox: sub.sandbox,
    duplicateReason: sub.duplicateReason,
    ownerUntil: sub.ownerUntil?.toISOString() ?? null,
    inviteExpiresAt: sub.inviteExpiresAt?.toISOString() ?? null,
    inviteAccepted: !!sub.inviteAcceptedAt,
    states: current,
    history: history.map((h) => ({ dimension: h.dimension, from: h.fromState, to: h.toState, reason: h.reason, at: h.at.toISOString() })),
    submittedAt: sub.createdAt.toISOString(),
  };
}

export async function withdraw(tx: Tx, partnerId: string, id: string, audit: Audit) {
  const s = await tx.partnerSubmission.findFirst({ where: { id, partnerId } });
  if (!s) throw notFound('Candidate not found');
  if (!ACTIVE.includes(s.state)) throw new AppError(409, 'NOT_ACTIVE', `This submission is ${s.state.toLowerCase()}.`);
  const u = await tx.partnerSubmission.update({ where: { id }, data: { state: 'WITHDRAWN', endedAt: new Date(), inviteTokenHash: null } });
  await recordState(tx, u, { dimension: 'submission', from: s.state, to: 'WITHDRAWN', event: 'candidate.withdrawn' }, audit);
  return u;
}

/**
 * A Validator (or Admin) decides on the requirement screen, one or many at a time. Only a person can set
 * CONFIRMED_NOT_MET, which ends the submission; MEETS clears a recommendation.
 */
export async function decideScreen(tx: Tx, clientId: string, ids: string[], decision: 'CONFIRM_NOT_MET' | 'MEETS', note: string, deciderId: string, audit: Audit) {
  const subs = await tx.partnerSubmission.findMany({ where: { id: { in: ids }, clientId } });
  if (subs.length !== new Set(ids).size) throw notFound('Submission not found');
  const out = [];
  for (const s of subs) {
    if (s.screen === 'CONFIRMED_NOT_MET') {
      out.push(s);
      continue;
    }
    const to = decision === 'CONFIRM_NOT_MET' ? 'CONFIRMED_NOT_MET' : 'MEETS';
    const u = await tx.partnerSubmission.update({ where: { id: s.id }, data: { screen: to, screenDecidedBy: deciderId, ...(to === 'CONFIRMED_NOT_MET' && ACTIVE.includes(s.state) ? { endedAt: new Date(), inviteTokenHash: null } : {}) } });
    await recordState(tx, u, { dimension: 'screen', from: s.screen, to, reason: note, event: to === 'CONFIRMED_NOT_MET' ? 'candidate.not_selected' : null, data: to === 'CONFIRMED_NOT_MET' ? { stage: 'requirements' } : {} }, audit);
    out.push(u);
  }
  return out;
}

/**
 * The candidate follows the invite link and signs in (FLOW 2 Google sign-in): the invite is linked to their account
 * and an application to the requisition's opportunity is started or resumed. Identity is matched here too: an account
 * already owned through another partner makes this submission a duplicate.
 */
export async function redeemInvite(tx: Tx, smeUserId: string, token: string, audit: Audit, startEnrollment: (opportunityId: string) => Promise<{ id: string }>) {
  const s = await tx.partnerSubmission.findUnique({ where: { inviteTokenHash: sha256(token) }, include: { requisition: { include: { project: { include: { opportunity: true } } } }, candidate: true } });
  if (!s || s.sandbox) throw notFound('This invitation link is not valid.');
  if (s.state !== 'INVITED' || s.endedAt) throw new AppError(410, 'INVITE_ENDED', 'This invitation is no longer active.');
  if (s.inviteExpiresAt && s.inviteExpiresAt < new Date() && !s.inviteAcceptedAt) throw new AppError(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask the person who put you forward to submit you again.');
  const linked = await tx.supplyCandidate.findUnique({ where: { smeUserId } });
  if (linked && linked.id !== s.candidateId) {
    const owner = await activeOwner(tx, linked.id, new Date());
    if (owner && owner.partnerId !== s.partnerId) {
      const u = await tx.partnerSubmission.update({ where: { id: s.id }, data: { state: 'DUPLICATE', duplicateReason: DUPLICATE_OWNED, endedAt: null, ownerUntil: null, inviteTokenHash: null } });
      await recordState(tx, u, { dimension: 'submission', from: 'INVITED', to: 'DUPLICATE', reason: DUPLICATE_OWNED, event: 'candidate.duplicate' }, audit);
      return { duplicate: true as const };
    }
  } else if (!linked) {
    await tx.supplyCandidate.update({ where: { id: s.candidateId }, data: { smeUserId } });
  }
  const opp = s.requisition.project.opportunity;
  if (!opp || opp.status !== 'PUBLISHED') throw new AppError(409, 'OPPORTUNITY_NOT_OPEN', 'This opportunity is not open for applications yet. Try again later.');
  const e = await startEnrollment(opp.id);
  if (!s.inviteAcceptedAt) {
    const u = await tx.partnerSubmission.update({ where: { id: s.id }, data: { inviteAcceptedAt: new Date(), enrollmentId: e.id } });
    await recordState(tx, u, { dimension: 'invite', from: 'SENT', to: 'ACCEPTED', event: null }, audit);
  }
  return { duplicate: false as const, enrollmentId: e.id, opportunityId: opp.id };
}

/** Hourly: reminder on day 3, expiry on day 7 for invites nobody accepted. */
export async function remindAndExpireInvites(db: Db, email: EmailSender | null, appUrl: string, now = new Date()) {
  let reminded = 0;
  let expired = 0;
  const open = await db.partnerSubmission.findMany({ where: { state: 'INVITED', inviteAcceptedAt: null, endedAt: null, sandbox: false }, include: { candidate: true, requisition: true } });
  for (const s of open) {
    if (s.inviteExpiresAt && s.inviteExpiresAt <= now) {
      await db.$transaction(async (tx) => {
        const u = await tx.partnerSubmission.update({ where: { id: s.id }, data: { state: 'EXPIRED', endedAt: now, inviteTokenHash: null } });
        await recordState(tx, u, { dimension: 'submission', from: 'INVITED', to: 'EXPIRED', reason: `Not accepted within ${INVITE_VALID_DAYS} days`, event: 'candidate.expired' }, null);
      });
      expired++;
    } else if (!s.reminderSentAt && s.invitedAt && s.invitedAt.getTime() + INVITE_REMINDER_DAYS * DAY <= now.getTime()) {
      await db.partnerSubmission.update({ where: { id: s.id }, data: { reminderSentAt: now } });
      await email?.send({ to: s.candidate.emailNorm, subject: `Reminder: continue your application for "${s.requisition.title}"`, text: `Hello ${s.candidate.name},\n\nYour invitation to ADI Praxis for "${s.requisition.title}" expires on ${s.inviteExpiresAt?.toISOString().slice(0, 10)}. Use the link in the first email to sign in and continue.\n\nADI Praxis` });
      reminded++;
    }
  }
  return { reminded, expired };
}

/** Sandbox only: simulate a candidate's progress so a partner can test its webhook handling end to end. */
export async function simulate(tx: Tx, partnerId: string, id: string, event: (typeof SANDBOX_SIMULATIONS)[number], audit: Audit) {
  const s = await tx.partnerSubmission.findFirst({ where: { id, partnerId, sandbox: true } });
  if (!s) throw notFound('Sandbox candidate not found');
  const map: Record<typeof event, [string, string, PartnerWebhookEvent]> = {
    identity_verified: ['identity', 'VERIFIED', 'candidate.identity_verified'],
    selected: ['selection', 'SELECTED', 'candidate.selected'],
    not_selected: ['selection', 'NOT_SELECTED', 'candidate.not_selected'],
    training_completed: ['certification', 'TEST_READY', 'candidate.training_completed'],
    test_passed: ['certification', 'PASSED', 'candidate.test_passed'],
    test_failed: ['certification', 'RETAKE_AVAILABLE', 'candidate.test_failed'],
    certified: ['certification', 'CERTIFIED', 'candidate.certified'],
    activated: ['standing', 'PROBATION', 'candidate.activated'],
  };
  const [dimension, to, type] = map[event];
  const prev = await tx.candidateStateEvent.findFirst({ where: { submissionId: s.id, dimension }, orderBy: { at: 'desc' } });
  await recordState(tx, s, { dimension, from: prev?.toState ?? null, to, reason: 'Simulated (sandbox)', event: type }, audit);
  return candidateView(tx, s);
}

/** FLOW 2 → partner: identity verified and the human selection decision, for every live submission of that person. */
export async function onFlow2Change(tx: Tx, smeUserId: string, change: { dimension: 'identity' | 'selection'; to: string; event: PartnerWebhookEvent; enrollmentId?: string }) {
  const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId } });
  if (!cand) return 0;
  const subs = await tx.partnerSubmission.findMany({ where: { candidateId: cand.id, state: 'INVITED', endedAt: null, sandbox: false, ...(change.enrollmentId ? { enrollmentId: change.enrollmentId } : {}) } });
  for (const s of subs) {
    const prev = await tx.candidateStateEvent.findFirst({ where: { submissionId: s.id, dimension: change.dimension }, orderBy: { at: 'desc' } });
    if (prev?.toState === change.to) continue;
    await recordState(tx, s, { dimension: change.dimension, from: prev?.toState ?? null, to: change.to, event: change.event }, null);
  }
  return subs.length;
}
