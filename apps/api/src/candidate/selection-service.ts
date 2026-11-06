import type { Prisma } from '@prisma/client';
import {
  assessmentProblems,
  type AssessmentOutput,
  OpportunityBrief,
  OpportunityCriteria,
  ONBOARDING_ITEMS,
  ONBOARDING_VERSION,
  ProfileData,
  recommendationFrom,
  type SelectionDecisionRequest,
} from '@praxis/shared';
import type { InternalActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, forbidden, notFound } from '../lib/errors';
import type { EventHandler } from '../outbox/handlers';
import { writeAudit } from '../platform/audit';
import { citableItems, type SuitabilityEvaluator } from './suitability';

const system = (clientId: string, actorId: string) => ({ clientId, actorType: 'SYSTEM' as const, actorId });

// ───────────────────────── Assessment (FLOW2 8.1, 8.3, section 10) ─────────────────────────

/**
 * Runs one suitability assessment. Idempotent: only a NOT_RUN or ERROR assessment is claimed. A result for a profile
 * version or enrollment state that has since changed is marked SUPERSEDED and never applied (CF-21). Invalid model
 * output becomes a recoverable ERROR; no selection or rejection is ever synthesised (CF-19, CF-20).
 */
export async function runAssessment(db: Db, evaluator: SuitabilityEvaluator, assessmentId: string): Promise<'done' | 'superseded' | 'skipped' | 'error'> {
  const { count } = await db.suitabilityAssessment.updateMany({ where: { id: assessmentId, status: { in: ['NOT_RUN', 'ERROR'] } }, data: { status: 'EVALUATING', errorCode: null } });
  if (count === 0) return 'skipped';
  const a = await db.suitabilityAssessment.findUniqueOrThrow({ where: { id: assessmentId } });
  const e = await db.enrollment.findUniqueOrThrow({ where: { id: a.enrollmentId }, include: { opportunityVersion: true } });
  const supersede = async () => {
    await db.suitabilityAssessment.update({ where: { id: a.id }, data: { status: 'SUPERSEDED' } });
    return 'superseded' as const;
  };
  if (e.status !== 'SUBMITTED' || e.profileVersionId !== a.profileVersionId) return supersede();

  const version = await db.profileVersion.findUniqueOrThrow({ where: { id: a.profileVersionId }, include: { claims: true } });
  const brief = OpportunityBrief.parse(e.opportunityVersion.brief);
  const criteria = OpportunityCriteria.parse(e.opportunityVersion.criteria);
  const evidence = await db.evidenceArtifact.findMany({ where: { smeUserId: e.smeUserId, deletionRequestedAt: null, scanStatus: 'CLEAN' } });
  const items = citableItems(ProfileData.parse(version.data), criteria, version.claims, evidence);
  const input = { opportunity: { title: brief.title, domain: brief.domain, specialty: brief.specialty }, criteria, items };
  const inputHash = sha256(stableStringify(input));

  let output: AssessmentOutput | undefined;
  let problems: string[] = [];
  try {
    output = await evaluator.evaluate(input);
    problems = assessmentProblems(output, criteria, new Set(items.map((i) => i.id)));
  } catch (err) {
    problems = [`MODEL_UNAVAILABLE: ${err instanceof Error ? err.message : 'error'}`];
  }
  if (!output || problems.length) {
    await db.$transaction(async (tx) => {
      await tx.suitabilityAssessment.update({ where: { id: a.id }, data: { status: 'ERROR', errorCode: output ? 'INVALID_OUTPUT' : 'MODEL_UNAVAILABLE', limitations: problems.join('; ').slice(0, 2000), inputHash, modelVersion: evaluator.modelVersion } });
      await writeAudit(tx, system(a.clientId, 'suitability-evaluator'), { entityType: 'SuitabilityAssessment', entityId: a.id, action: 'assessment.failed', after: { problems: problems.slice(0, 10) } });
    });
    return 'error';
  }

  const recommendation = recommendationFrom(output.findings, criteria);
  return db.$transaction(async (tx) => {
    // Re-check inside the transaction: a withdrawal or new revision wins over a late result.
    const fresh = await tx.enrollment.findUniqueOrThrow({ where: { id: e.id } });
    if (fresh.status !== 'SUBMITTED' || fresh.profileVersionId !== a.profileVersionId) {
      await tx.suitabilityAssessment.update({ where: { id: a.id }, data: { status: 'SUPERSEDED' } });
      return 'superseded' as const;
    }
    await tx.suitabilityAssessment.update({
      where: { id: a.id },
      data: {
        status: recommendation,
        findings: output.findings as unknown as Prisma.InputJsonValue,
        proposedScope: { contributionRoles: output.proposedContributionRoles, unresolvedQuestions: output.unresolvedQuestions } as Prisma.InputJsonValue,
        limitations: output.limitations,
        inputHash,
        modelVersion: evaluator.modelVersion,
        ruleVersion: 'flow2-8.1-v1',
      },
    });
    await tx.enrollment.update({ where: { id: e.id }, data: { status: 'REVIEW_PENDING', revision: { increment: 1 } } });
    await writeAudit(tx, system(a.clientId, 'suitability-evaluator'), {
      entityType: 'Enrollment',
      entityId: e.id,
      action: 'enrollment.assessed',
      before: { status: 'SUBMITTED' },
      after: { status: 'REVIEW_PENDING', recommendation, assessmentId: a.id },
    });
    return 'done' as const;
  });
}

/** Worker: assess each submitted profile. Throws on a recoverable error so the queue retries with backoff. */
export function assessOnSubmit(evaluator: SuitabilityEvaluator): EventHandler {
  return {
    name: 'flow2.assess-enrollment',
    event: 'enrollment.submitted',
    async run(event, db) {
      const { assessmentId } = event.payload as { assessmentId: string };
      const r = await runAssessment(db, evaluator, assessmentId);
      if (r === 'error') throw new Error('Assessment failed; will retry');
    },
  };
}

// ───────────────────────── Reviewer access (FLOW2 13: reviewers restricted to assigned pools) ─────────────────────────

export async function reviewableEnrollment(tx: Db | Tx, actor: InternalActor, enrollmentId: string) {
  const e = await tx.enrollment.findFirst({
    where: { id: enrollmentId, clientId: actor.clientId },
    include: { opportunity: true, opportunityVersion: true, smeUser: true },
  });
  if (!e || e.status === 'DRAFT' || !e.profileVersionId || !e.submittedAt) throw notFound('Application not found');
  if (!actor.roles.includes('ADMIN')) {
    const assigned = await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId: e.opportunity.projectId, userId: actor.userId } } });
    if (!assigned) throw notFound('Application not found');
  }
  const conflict = await tx.conflictDeclaration.findFirst({ where: { reviewerId: actor.userId, smeUserId: e.smeUserId, resolvedAt: null } });
  if (conflict) throw forbidden('You declared a conflict with this candidate. Another Validator must decide.');
  return e;
}

// ───────────────────────── Human decision (FLOW2 8.2) ─────────────────────────

export async function recordDecision(tx: Tx, actor: InternalActor, enrollmentId: string, body: SelectionDecisionRequest, audit: (i: Parameters<typeof writeAudit>[2]) => Promise<void>) {
  const e = await reviewableEnrollment(tx, actor, enrollmentId);
  if (e.status !== 'REVIEW_PENDING') throw new AppError(409, 'NOT_AWAITING_DECISION', `This application is ${e.status.toLowerCase().replace(/_/g, ' ')}, not awaiting a decision.`);
  const criteria = OpportunityCriteria.parse(e.opportunityVersion.criteria);
  const unknown = body.reasons.filter((r) => r.criterionId && !criteria.some((c) => c.id === r.criterionId));
  if (unknown.length) throw new AppError(400, 'UNKNOWN_CRITERION', 'Reasons can only refer to published criteria.');
  const assessment = await tx.suitabilityAssessment.findFirst({ where: { enrollmentId: e.id, profileVersionId: e.profileVersionId!, status: { not: 'SUPERSEDED' } }, orderBy: { createdAt: 'desc' } });

  const decision = await tx.selectionDecision.create({
    data: {
      clientId: e.clientId,
      enrollmentId: e.id,
      reviewerId: actor.userId,
      outcome: body.outcome,
      reasons: { items: body.reasons, candidateMessage: body.candidateMessage, informationRequest: body.informationRequest ?? null } as Prisma.InputJsonValue,
      profileVersionId: e.profileVersionId!,
      assessmentId: assessment?.id ?? null,
      criteriaRef: { opportunityVersionId: e.opportunityVersionId, version: e.opportunityVersion.version, criteria } as unknown as Prisma.InputJsonValue,
    },
  });
  if (body.outcome === 'SELECTED') {
    const s = body.scope!;
    await tx.qualificationScope.create({
      data: {
        clientId: e.clientId,
        enrollmentId: e.id,
        selectionDecisionId: decision.id,
        domain: s.domain,
        specialty: s.specialty,
        jurisdictions: s.jurisdictions,
        languages: s.languages,
        contributionRoles: s.contributionRoles,
        expiresAt: s.expiresAt ? new Date(`${s.expiresAt}T00:00:00Z`) : null,
      },
    });
    await tx.onboardingChecklist.upsert({
      where: { enrollmentId: e.id },
      create: { clientId: e.clientId, enrollmentId: e.id, checklistVersion: ONBOARDING_VERSION, items: ONBOARDING_ITEMS.map((i) => i.key) as Prisma.InputJsonValue, status: 'NOT_STARTED' },
      update: {},
    });
  }
  await tx.enrollment.update({
    where: { id: e.id },
    data: {
      status: body.outcome,
      decisionMessage: body.candidateMessage,
      informationRequest: body.outcome === 'NEEDS_INFORMATION' ? body.informationRequest : null,
      revision: { increment: 1 },
    },
  });
  await audit({
    entityType: 'Enrollment',
    entityId: e.id,
    action: 'enrollment.decided',
    before: { status: e.status },
    after: { status: body.outcome, decisionId: decision.id, recommendation: assessment?.status ?? null },
  });
  return decision;
}

// ───────────────────────── Candidate transitions (section 10) ─────────────────────────

/** NEEDS_INFORMATION: start an amendment, a new draft copied from the submitted version (never rewriting it). */
export async function ensureAmendmentDraft(tx: Tx, e: { id: string; clientId: string; smeUserId: string; profileVersionId: string | null }) {
  const existing = await tx.profileVersion.findFirst({ where: { enrollmentId: e.id, submittedAt: null } });
  if (existing || !e.profileVersionId) return existing;
  const submitted = await tx.profileVersion.findUniqueOrThrow({ where: { id: e.profileVersionId } });
  const last = await tx.profileVersion.findFirst({ where: { smeUserId: e.smeUserId }, orderBy: { version: 'desc' } });
  const draft = await tx.profileVersion.create({
    data: { clientId: e.clientId, smeUserId: e.smeUserId, enrollmentId: e.id, version: (last?.version ?? 0) + 1, data: submitted.data as Prisma.InputJsonValue, flags: submitted.flags as Prisma.InputJsonValue, sourceLinks: submitted.sourceLinks as Prisma.InputJsonValue, contentHash: '' },
  });
  await tx.conversationSession.updateMany({ where: { enrollmentId: e.id }, data: { status: 'IN_PROGRESS', revision: { increment: 1 } } });
  return draft;
}

/** Withdrawal stops future assignments and cancels pending proposals; history is kept (CF-29). */
export async function withdrawEnrollment(tx: Tx, enrollmentId: string, smeUserId: string, audit: (i: Parameters<typeof writeAudit>[2]) => Promise<void>) {
  const e = await tx.enrollment.findFirst({ where: { id: enrollmentId, smeUserId } });
  if (!e) throw notFound('Application not found');
  if (e.status === 'WITHDRAWN') throw new AppError(409, 'ALREADY_WITHDRAWN', 'This application was already withdrawn.');
  await tx.enrollment.update({ where: { id: e.id }, data: { status: 'WITHDRAWN', revision: { increment: 1 } } });
  await tx.suitabilityAssessment.updateMany({ where: { enrollmentId: e.id, status: { in: ['NOT_RUN', 'EVALUATING', 'ERROR'] } }, data: { status: 'SUPERSEDED' } });
  const assignments = await tx.smeAssignment.findMany({ where: { enrollmentId: e.id, status: { in: ['PROPOSED', 'ACCEPTED', 'HANDED_OFF'] } }, include: { projectAssignment: true } });
  for (const a of assignments) {
    await tx.smeAssignment.update({ where: { id: a.id }, data: { status: 'CANCELED', respondedAt: new Date() } });
    if (a.projectAssignment && !a.projectAssignment.releasedAt) await tx.projectAssignment.update({ where: { id: a.projectAssignment.id }, data: { releasedAt: new Date() } });
    await audit({
      entityType: 'SmeAssignment',
      entityId: a.id,
      action: a.status === 'PROPOSED' ? 'assignment.canceled' : 'assignment.handback_required',
      before: { status: a.status },
      after: { status: 'CANCELED', reason: 'enrollment withdrawn' },
    });
  }
  await audit({ entityType: 'Enrollment', entityId: e.id, action: 'enrollment.withdrawn', before: { status: e.status }, after: { status: 'WITHDRAWN', assignmentsCanceled: assignments.length } });
}
