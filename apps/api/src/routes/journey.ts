import { AcknowledgeRequest, DeclineRequest, identityEligible, OpportunityBrief } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { acknowledge, onboardingView } from '../candidate/onboarding-service';
import { ensureAmendmentDraft, withdrawEnrollment } from '../candidate/selection-service';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { newToken, sha256 } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import type { SelectionGate } from '../staffing/selection-gate';
import { expireProposals, markStaffedIfReady } from '../staffing/staffing-service';

const IdParams = z.object({ id: z.string().uuid() });
const HANDOFF_MINUTES = 10;
const OPEN_ACCEPTED = ['ACCEPTED', 'HANDED_OFF'] as const;

/** Candidate-facing status text (C06): respectful and task-specific, never "you are unfit". */
const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Your profile is in progress.',
  SUBMITTED: 'Submitted. We are preparing your application for review.',
  REVIEW_PENDING: 'Review in progress. A person reviews every application.',
  NEEDS_INFORMATION: 'More information requested.',
  SELECTED: 'Selected for this pool.',
  NOT_SELECTED: 'Not selected for this pool.',
  REVIEW_REQUESTED: 'Your request for review is with our team.',
  WITHDRAWN: 'Withdrawn.',
};

async function assignmentCard(tx: Db | Tx, id: string, smeUserId: string) {
  const a = await tx.smeAssignment.findFirst({ where: { id, smeUserId }, include: { enrollment: { include: { opportunity: { include: { versions: { orderBy: { version: 'desc' }, take: 1 }, project: true } } } } } });
  if (!a) throw notFound('Assignment not found');
  const v = a.enrollment.opportunity.versions[0]!;
  const brief = OpportunityBrief.parse(v.brief);
  const project = a.enrollment.opportunity.project;
  return {
    id: a.id,
    status: a.status,
    revision: a.revision,
    title: brief.title,
    domain: brief.domain,
    specialty: brief.specialty,
    jurisdictions: brief.jurisdictions,
    languages: brief.languages,
    contributionRoles: (a.scope as { contributionRoles?: string[] }).contributionRoles ?? [],
    expectedOutput: brief.exampleOutputs,
    effort: project.tptMinutes ? `About ${project.tptMinutes} minutes per task` : null,
    deadline: a.deadline?.toISOString() ?? null,
    compensation: brief.compensation,
    confidentiality: brief.confidentiality,
    requirementsVersion: a.requirementsVersion,
    currentRequirementsVersion: v.version,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    declineReason: a.declineReason,
  };
}

/** FLOW2 C06 (status), C07 (onboarding) and C08 (home, assignments) for candidates. */
export const journeyRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; selectionGate: SelectionGate }> = async (app, { db, config, selectionGate }) => {
  // ── C06 ──
  app.get('/me/enrollments/:id/status', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req) => {
    const e = await db.enrollment.findFirst({
      where: { id: req.params.id, smeUserId: req.candidate!.smeUserId },
      include: { opportunityVersion: true, onboarding: true, qualificationScopes: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!e) throw notFound('Application not found');
    const decided = ['SELECTED', 'NOT_SELECTED', 'NEEDS_INFORMATION', 'REVIEW_REQUESTED'].includes(e.status);
    return {
      id: e.id,
      status: e.status,
      statusText: STATUS_TEXT[e.status],
      title: (e.opportunityVersion.brief as { title?: string }).title ?? '',
      // Explanations appear only after a human decision (C06); no model output is shown to candidates.
      message: decided ? e.decisionMessage : null,
      informationRequest: e.status === 'NEEDS_INFORMATION' ? e.informationRequest : null,
      scope: e.status === 'SELECTED' ? e.qualificationScopes[0] ?? null : null,
      onboardingStatus: e.onboarding?.status ?? null,
      canAmend: e.status === 'NEEDS_INFORMATION',
      canRequestReview: e.status === 'NOT_SELECTED',
      canWithdraw: e.status !== 'WITHDRAWN',
    };
  });

  app.post('/me/enrollments/:id/amend', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const e = await tx.enrollment.findFirst({ where: { id: req.params.id, smeUserId: actor.smeUserId } });
      if (!e) throw notFound('Application not found');
      if (e.status !== 'NEEDS_INFORMATION') throw new AppError(409, 'NOT_EDITABLE', 'This application is not waiting for more information.');
      const draft = await ensureAmendmentDraft(tx, e);
      await audit({ entityType: 'Enrollment', entityId: e.id, action: 'enrollment.amendment_started', after: { draftVersion: draft?.version ?? null } });
      return { status: 200, body: { enrollmentId: e.id } };
    });
    return reply;
  });

  app.post(
    '/me/enrollments/:id/review-request',
    { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams, body: z.object({ reason: z.string().trim().min(1).max(2000) }) } },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const e = await tx.enrollment.findFirst({ where: { id: req.params.id, smeUserId: actor.smeUserId } });
        if (!e) throw notFound('Application not found');
        if (e.status !== 'NOT_SELECTED') throw new AppError(409, 'NOT_ALLOWED', 'A review can be requested after a not-selected decision.');
        await tx.enrollment.update({ where: { id: e.id }, data: { status: 'REVIEW_REQUESTED', reviewRequestReason: req.body.reason, revision: { increment: 1 } } });
        await audit({ entityType: 'Enrollment', entityId: e.id, action: 'enrollment.review_requested', before: { status: e.status }, after: { status: 'REVIEW_REQUESTED' } });
        return { status: 200, body: { status: 'REVIEW_REQUESTED' } };
      });
      return reply;
    },
  );

  app.post('/me/enrollments/:id/withdraw', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await withdrawEnrollment(tx, req.params.id, actor.smeUserId, audit);
      return { status: 200, body: { status: 'WITHDRAWN' } };
    });
    return reply;
  });

  // ── C07 ──
  app.get('/me/onboarding', { config: { access: 'candidate' }, schema: { tags: ['candidate'], querystring: z.object({ enrollmentId: z.string().uuid() }) } }, async (req) =>
    onboardingView(db, req.query.enrollmentId, req.candidate!.smeUserId),
  );
  app.post('/me/onboarding/acknowledgements', { config: { access: 'candidate' }, schema: { tags: ['candidate'], body: AcknowledgeRequest } }, async (req, reply) => {
    await runCandidateCommand<object>(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const r = await acknowledge(tx, { ...req.body, smeUserId: actor.smeUserId, production: config.NODE_ENV === 'production' && config.appEnv !== 'demo' }, audit);
      if (r.blocked) return { status: 409, body: { error: r.error, message: r.message } };
      if (r.completed) {
        const e = await tx.enrollment.findUniqueOrThrow({ where: { id: req.body.enrollmentId }, include: { opportunity: true } });
        const candidate = await tx.candidate.findUniqueOrThrow({ where: { smeUserId: actor.smeUserId } });
        // Now assignable: FLOW 2 re-runs the project's match so the PM sees them without a refresh (M3).
        await emit({ name: 'candidate.approved', aggregateType: 'Enrollment', aggregateId: e.id, payload: { projectId: e.opportunity.projectId, candidateId: candidate.id, enrollmentId: e.id } });
      }
      return { status: 200, body: r.view };
    });
    return reply;
  });

  // ── C08 ──
  app.get('/me/assignments', { config: { access: 'candidate' }, schema: { tags: ['candidate'] } }, async (req) => {
    const me = req.candidate!.smeUserId;
    await expireProposals(db, { smeUserId: me });
    const rows = await db.smeAssignment.findMany({ where: { smeUserId: me }, orderBy: { createdAt: 'desc' } });
    return { items: await Promise.all(rows.map((r) => assignmentCard(db, r.id, me))) };
  });
  app.get('/me/assignments/:id', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req) => assignmentCard(db, req.params.id, req.candidate!.smeUserId));

  app.post(
    '/me/assignments/:id/accept',
    { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams, body: z.object({ expectedRevision: z.number().int().min(0) }) } },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        await expireProposals(tx, { smeUserId: actor.smeUserId });
        const a = await tx.smeAssignment.findFirst({ where: { id: req.params.id, smeUserId: actor.smeUserId }, include: { projectAssignment: true } });
        if (!a) throw notFound('Assignment not found');
        if (a.status !== 'PROPOSED') throw new AppError(409, 'NOT_PROPOSED', `This assignment is ${a.status.toLowerCase()}.`);
        // Acceptance rechecks everything atomically (CF-25, CF-26): lock this candidate's row first.
        const candidate = await tx.candidate.findUniqueOrThrow({ where: { smeUserId: actor.smeUserId } });
        await tx.$executeRaw`SELECT 1 FROM "Candidate" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
        const gate = await selectionGate.check(tx, { candidateId: candidate.id, projectId: a.projectId });
        if (!gate.ok) throw new AppError(409, 'NOT_ELIGIBLE', `You can’t accept this yet: ${gate.reason}.`);
        const latest = await tx.opportunityVersion.findFirst({ where: { opportunity: { projectId: a.projectId }, publishedAt: { not: null } }, orderBy: { version: 'desc' } });
        if (latest && latest.version !== a.requirementsVersion) throw new AppError(409, 'REQUIREMENTS_CHANGED', 'The requirements changed since this was proposed. The coordinator will send an updated proposal.');
        const scopeRoles = (gate.snapshot.scope as { contributionRoles?: string[] } | undefined)?.contributionRoles ?? [];
        const neededRoles = latest ? OpportunityBrief.parse(latest.brief).contributionRoles : [];
        if (neededRoles.length && !neededRoles.some((r) => scopeRoles.includes(r))) throw new AppError(409, 'OUT_OF_SCOPE', 'This work is outside your approved contribution roles.');
        const busy = await tx.smeAssignment.count({ where: { smeUserId: actor.smeUserId, status: { in: [...OPEN_ACCEPTED] }, id: { not: a.id }, projectId: { not: a.projectId } } });
        if (busy >= candidate.concurrentProjectLimit) throw new AppError(409, 'AT_CAPACITY', 'You are at your limit of concurrent projects.');
        const { count } = await tx.smeAssignment.updateMany({ where: { id: a.id, status: 'PROPOSED', revision: req.body.expectedRevision }, data: { status: 'ACCEPTED', respondedAt: new Date(), revision: { increment: 1 }, qualificationSnapshot: gate.snapshot as object } });
        if (count === 0) throw new AppError(409, 'STALE_REVISION', 'This assignment changed. Reload to see its current state.');
        await audit({ entityType: 'SmeAssignment', entityId: a.id, action: 'assignment.accepted', before: { status: 'PROPOSED' }, after: { status: 'ACCEPTED' } });
        if (a.projectAssignment) {
          await emit({ name: 'candidate.assigned', aggregateType: 'ProjectAssignment', aggregateId: a.projectAssignment.id, payload: { projectId: a.projectId, candidateId: candidate.id, projectAssignmentId: a.projectAssignment.id, smeAssignmentId: a.id } });
        }
        await markStaffedIfReady(tx, a.projectId, audit, emit);
        return { status: 200, body: await assignmentCard(tx, a.id, actor.smeUserId) };
      });
      return reply;
    },
  );

  // A decline is not evidence of anything; it frees the slot (FLOW2 C08).
  app.post('/me/assignments/:id/decline', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams, body: DeclineRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const a = await tx.smeAssignment.findFirst({ where: { id: req.params.id, smeUserId: actor.smeUserId }, include: { projectAssignment: true } });
      if (!a) throw notFound('Assignment not found');
      if (a.status !== 'PROPOSED') throw new AppError(409, 'NOT_PROPOSED', `This assignment is ${a.status.toLowerCase()}.`);
      await tx.smeAssignment.update({ where: { id: a.id }, data: { status: 'DECLINED', declineReason: req.body.reason ?? null, respondedAt: new Date(), revision: { increment: 1 } } });
      if (a.projectAssignment && !a.projectAssignment.releasedAt) await tx.projectAssignment.update({ where: { id: a.projectAssignment.id }, data: { releasedAt: new Date() } });
      await audit({ entityType: 'SmeAssignment', entityId: a.id, action: 'assignment.declined', before: { status: 'PROPOSED' }, after: { status: 'DECLINED' } });
      return { status: 200, body: await assignmentCard(tx, a.id, actor.smeUserId) };
    });
    return reply;
  });

  /** Short-lived, single-use handoff to the task workbench (built in M5). */
  app.post('/me/assignments/:id/open-workbench', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const a = await tx.smeAssignment.findFirst({ where: { id: req.params.id, smeUserId: actor.smeUserId } });
      if (!a) throw notFound('Assignment not found');
      if (!(OPEN_ACCEPTED as readonly string[]).includes(a.status)) throw new AppError(409, 'NOT_ACCEPTED', 'Accept the assignment before opening the workbench.');
      const u = await tx.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId } });
      if (!identityEligible(u.identityStatus) || u.accountStatus !== 'ACTIVE') throw new AppError(409, 'NOT_ELIGIBLE', 'Your account is not eligible to open tasks right now.');
      const token = newToken();
      await tx.smeAssignment.update({ where: { id: a.id }, data: { status: 'HANDED_OFF', handoffTokenHash: sha256(token), handoffExpiresAt: new Date(Date.now() + HANDOFF_MINUTES * 60_000), workbenchRef: a.workbenchRef ?? `workbench:${a.id}` } });
      await audit({ entityType: 'SmeAssignment', entityId: a.id, action: 'assignment.handed_off', before: { status: a.status }, after: { status: 'HANDED_OFF' } });
      return { status: 200, body: { url: `${config.CANDIDATE_APP_URL}/workbench/handoff?token=${token}` } };
    });
    return reply;
  });

  // The workbench redeems the handoff token once, for the same signed-in candidate.
  app.post('/workbench/handoff', { config: { access: 'candidate' }, schema: { tags: ['candidate'], body: z.object({ token: z.string().min(20).max(200) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const a = await tx.smeAssignment.findUnique({ where: { handoffTokenHash: sha256(req.body.token) } });
      if (!a || a.smeUserId !== actor.smeUserId || !a.handoffExpiresAt || a.handoffExpiresAt < new Date()) throw new AppError(401, 'INVALID_HANDOFF', 'This link has expired. Open the workbench again from your home page.');
      await tx.smeAssignment.update({ where: { id: a.id }, data: { handoffTokenHash: null, handoffExpiresAt: null } });
      await audit({ entityType: 'SmeAssignment', entityId: a.id, action: 'assignment.handoff_redeemed', after: { projectId: a.projectId } });
      return { status: 200, body: { assignmentId: a.id, projectId: a.projectId } };
    });
    return reply;
  });
};
