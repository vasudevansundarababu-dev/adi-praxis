import { Prisma } from '@prisma/client';
import { praxisContractChecks, EXECUTABLE_WORKFLOW, coverageStatus, CoverageDimensions, CoverageQuotas, effectiveCoverage, mayApprove, type CoverageTags } from '@praxis/shared';
import { z } from 'zod';
import type { InternalActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { writeApprovedRecord } from '../dataset/approved-records';
import { AppError, forbidden, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import type { OutboxInput } from '../outbox/outbox';
import type { StoredChecks } from './submission';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;

/** TASK-KYC reviewer checklist; every item must be answered before a decision, and all true to accept. */
export const CHECKLIST = [
  { key: 'realistic', label: 'Realistic: a practitioner would recognise this case' },
  { key: 'correct', label: 'Correct: the reference trajectory and disposition are right under the stated policy' },
  { key: 'coversSlot', label: 'Covers the slot’s edge case, and coverage tags are accurate' },
  { key: 'difficultyFair', label: 'Difficulty rating is fair' },
  { key: 'distinct', label: 'Distinct from the closest existing tasks' },
  { key: 'rubricCatches', label: 'Rubric would catch the listed failure modes' },
] as const;

export const TaskDecisionRequest = z
  .object({
    decision: z.enum(['ACCEPT', 'REWORK', 'REJECT']),
    expectedRevision: z.number().int().min(0),
    checklist: z.object(Object.fromEntries(CHECKLIST.map((c) => [c.key, z.boolean()])) as Record<(typeof CHECKLIST)[number]['key'], z.ZodBoolean>),
    rejectReason: z.enum(['DUPLICATE', 'NOT_REALISTIC', 'INCORRECT', 'REAL_DATA']).optional(),
    duplicateDecision: z.enum(['ACCEPT_AS_DISTINCT', 'REWORK', 'REJECT_DUPLICATE']).optional(),
    /** Rework comments pinned to workbench sections (W01 to W06). */
    comments: z.array(z.object({ section: z.string().regex(/^W0[1-6]$/), text: z.string().trim().min(1).max(2000) })).max(50).default([]),
    notes: z.string().trim().max(4000).optional(),
    /** Coverage tags confirmed (or corrected) by the Reviewer for open slots. */
    confirmedCoverage: z.object({ tags: z.record(z.string(), z.string()), edgeCase: z.string().trim().min(1).max(200) }).optional(),
  })
  .refine((d) => d.decision !== 'ACCEPT' || Object.values(d.checklist).every(Boolean), { message: 'Every checklist item must hold to accept', path: ['checklist'] })
  .refine((d) => d.decision !== 'REJECT' || !!d.rejectReason, { message: 'Choose a reason for rejecting', path: ['rejectReason'] })
  .refine((d) => d.decision !== 'REWORK' || d.comments.length > 0, { message: 'Rework needs at least one comment', path: ['comments'] });
export type TaskDecisionRequest = z.infer<typeof TaskDecisionRequest>;

/**
 * Who may review a task: an Admin or a Reviewer assigned to the project, never the author themself (matched by
 * email) and never a Reviewer who declared a conflict with the author (SPEC; FLOW2 CF-27).
 */
export async function reviewableTask(tx: Db | Tx, actor: InternalActor, taskId: string) {
  const t = await tx.taskInstance.findFirst({
    where: { id: taskId, clientId: actor.clientId, taskType: { in: ['AUTHORING', 'ANNOTATION'] } },
    include: { project: { include: { template: true } }, assignedTo: { include: { smeUser: true } }, slot: true, submissions: { orderBy: { version: 'asc' } }, reviews: { orderBy: { createdAt: 'asc' } } },
  });
  if (!t) throw notFound('Task not found');
  if (!actor.roles.includes('ADMIN')) {
    const assigned = await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId: t.projectId, userId: actor.userId } } });
    if (!assigned) throw notFound('Task not found');
  }
  const me = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const author = t.assignedTo?.smeUser;
  if (author) {
    const conflict = await tx.conflictDeclaration.findFirst({ where: { reviewerId: actor.userId, smeUserId: author.id, resolvedAt: null } });
    const authorKey = (author.contactEmail ?? author.id).toLowerCase();
    const reviewerKey = me.email.toLowerCase();
    if (conflict || (!actor.roles.includes('ADMIN') && !mayApprove({ authorId: authorKey, approverId: reviewerKey, conflicts: [] }))) {
      throw forbidden('You cannot review this task: you wrote it, or you declared a conflict with its author.');
    }
  }
  return t;
}

/** SPEC: a project completes only when the distinct-task target and all required coverage are met. */
export async function completionStatus(tx: Db | Tx, projectId: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { template: true } });
  const accepted = await tx.taskInstance.findMany({ where: { projectId, taskType: { in: ['AUTHORING', 'ANNOTATION'] }, status: 'ACCEPTED' }, select: { coverageTags: true } });
  if (p.taskMode === 'ANNOTATION') return { met: !!p.taskCount && accepted.length >= p.taskCount, accepted: accepted.length, target: p.taskCount ?? 0, coverageMet: true };
  const cov = effectiveCoverage(p.template, CoverageQuotas.nullable().safeParse(p.coverageQuotas).data ?? null);
  const status = coverageStatus({ cells: cov.cells, edgeCases: cov.edgeCases }, accepted.map((a) => (a.coverageTags ?? { tags: {}, edgeCase: null }) as CoverageTags));
  const target = p.distinctTarget ?? 0;
  return { met: accepted.length >= target && status.met, accepted: accepted.length, target, coverageMet: status.met };
}

export async function decideTask(tx: Tx, actor: InternalActor, taskId: string, body: TaskDecisionRequest, audit: Audit, emit: (e: OutboxInput) => Promise<void>) {
  const t = await reviewableTask(tx, actor, taskId);
  // SME -> Expert -> PM: a one-step decision would skip a responsibility; those tasks use the stage decision.
  if (t.project.reviewRoute === 'SME_EXPERT_PM') throw new AppError(409, 'STAGE_DECISION_REQUIRED', 'This project uses Expert review then PM approval; record a stage decision instead.');
  if (t.status !== 'SUBMITTED') throw new AppError(409, 'NOT_AWAITING_REVIEW', `This task is ${t.status.toLowerCase()}, not awaiting review.`);
  if (t.revision !== body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'The task changed; reload before deciding.');
  const checks = t.checks as StoredChecks | null;
  const flaggedDuplicate = (checks?.similar ?? []).some((m) => m.flagged);
  // A flagged near-duplicate needs an explicit duplicate decision that matches the outcome.
  const expectedDup = body.decision === 'ACCEPT' ? 'ACCEPT_AS_DISTINCT' : body.decision === 'REWORK' ? 'REWORK' : body.rejectReason === 'DUPLICATE' ? 'REJECT_DUPLICATE' : null;
  if (flaggedDuplicate && expectedDup && body.duplicateDecision !== expectedDup) {
    throw new AppError(400, 'DUPLICATE_DECISION_REQUIRED', 'This task was flagged as a likely duplicate: confirm your duplicate decision.');
  }
  if (body.decision === 'ACCEPT') {
    const issues = praxisContractChecks((t.output ?? {}) as Record<string, unknown>, t.project.template.workflowName === EXECUTABLE_WORKFLOW).filter((c) => !c.ok);
    if (issues.length) throw new AppError(422, 'CONTRACT_INVALID', 'Executable contract needs attention before acceptance.', { checks: issues });
  }
  const version = t.submissions.at(-1)?.version ?? 1;
  const now = new Date();
  const isOpen = t.slot?.isOpen ?? false;
  if (body.decision === 'ACCEPT' && isOpen && !body.confirmedCoverage) throw new AppError(400, 'CONFIRM_TAGS', 'Open slot: confirm (or correct) the author’s coverage tags and edge case before accepting.');
  const coverage = body.decision === 'ACCEPT' && isOpen && body.confirmedCoverage ? { tags: body.confirmedCoverage.tags, edgeCase: body.confirmedCoverage.edgeCase } : null;

  await tx.taskReview.create({
    data: {
      clientId: t.clientId,
      taskInstanceId: t.id,
      submissionVersion: version,
      reviewerId: actor.userId,
      decision: body.decision,
      rejectReason: body.rejectReason ?? null,
      duplicateDecision: flaggedDuplicate ? (body.duplicateDecision ?? null) : null,
      checklist: body.checklist,
      comments: body.comments as Prisma.InputJsonValue,
      notes: body.notes ?? null,
    },
  });
  const common = { reviewerId: actor.userId, reviewNotes: body.notes ?? null, revision: { increment: 1 } };

  if (body.decision === 'ACCEPT') {
    const record = await acceptTask(tx, t, { reviewerId: actor.userId, notes: body.notes ?? null, coverage, duplicateDecision: flaggedDuplicate ? 'ACCEPT_AS_DISTINCT' : null, now, extraUpdate: common, auditAfter: { version } }, audit, emit);
    return { status: 'ACCEPTED', recordId: record.id };
  }

  if (body.decision === 'REWORK') {
    await tx.taskInstance.update({ where: { id: t.id }, data: { ...common, status: 'REWORK', reworkCount: { increment: 1 } } });
    await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.rework_requested', before: { status: 'SUBMITTED' }, after: { status: 'REWORK', comments: body.comments.length, version } });
    return { status: 'REWORK' };
  }

  await rejectTask(tx, t, { reason: body.rejectReason!, now, extraUpdate: common, auditAfter: { version } }, audit);
  return { status: 'REJECTED' };
}

type ReviewedTask = Awaited<ReturnType<typeof reviewableTask>>;

/**
 * Final acceptance (one transaction): ACCEPTED status, slot filled, the append-only ApprovedTaskRecord, the audit event
 * and `task.accepted` (which records the single earning), then project completion. Shared by both review routes.
 */
export async function acceptTask(
  tx: Tx,
  t: Pick<ReviewedTask, 'id' | 'projectId' | 'slotId' | 'project'>,
  args: { reviewerId: string; notes: string | null; coverage: CoverageTags | null; duplicateDecision: 'ACCEPT_AS_DISTINCT' | null; now: Date; extraUpdate: Prisma.TaskInstanceUpdateInput; auditAfter: Record<string, unknown> },
  audit: Audit,
  emit: (e: OutboxInput) => Promise<void>,
) {
  await tx.taskInstance.update({ where: { id: t.id }, data: { ...args.extraUpdate, status: 'ACCEPTED', ...(args.coverage ? { coverageTags: args.coverage as unknown as Prisma.InputJsonValue } : {}) } });
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'FILLED' } });
  const record = await writeApprovedRecord(tx, { taskId: t.id, reviewerId: args.reviewerId, reviewNotes: args.notes, duplicateDecision: args.duplicateDecision, decidedAt: args.now });
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.accepted', before: { status: 'SUBMITTED' }, after: { status: 'ACCEPTED', recordId: record.id, ...args.auditAfter } });
  await emit({ name: 'task.accepted', aggregateType: 'TaskInstance', aggregateId: t.id, payload: { taskId: t.id, projectId: t.projectId, recordId: record.id } });
  if (t.slotId) await emit({ name: 'slot.filled', aggregateType: 'CoverageSlot', aggregateId: t.slotId, payload: { slotId: t.slotId, projectId: t.projectId, taskId: t.id } });
  const done = await completionStatus(tx, t.projectId);
  if (done.met && ['IN_PROGRESS', 'STAFFED', 'STAFFING'].includes(t.project.status)) {
    await tx.project.update({ where: { id: t.projectId }, data: { status: 'COMPLETED' } });
    await audit({ entityType: 'Project', entityId: t.projectId, action: 'project.completed', before: { status: t.project.status }, after: { status: 'COMPLETED', accepted: done.accepted, target: done.target } });
    await emit({ name: 'project.completed', aggregateType: 'Project', aggregateId: t.projectId, payload: { projectId: t.projectId, accepted: done.accepted } });
  }
  return record;
}

/** Reject: the slot goes back for another expert. Confirmed real data is quarantined and never enters the dataset. */
export async function rejectTask(
  tx: Tx,
  t: Pick<ReviewedTask, 'id' | 'slotId'>,
  args: { reason: NonNullable<TaskDecisionRequest['rejectReason']>; now: Date; extraUpdate: Prisma.TaskInstanceUpdateInput; auditAfter: Record<string, unknown> },
  audit: Audit,
) {
  const quarantine = args.reason === 'REAL_DATA';
  await tx.taskInstance.update({
    where: { id: t.id },
    data: { ...args.extraUpdate, status: 'REJECTED', rejectReason: args.reason, ...(quarantine ? { output: Prisma.DbNull, quarantinedAt: args.now } : {}) },
  });
  if (quarantine) {
    await tx.$executeRaw`UPDATE "TaskInstance" SET embedding = NULL WHERE id = ${t.id}::uuid`;
    await tx.taskSubmission.updateMany({ where: { taskInstanceId: t.id }, data: { output: { quarantined: true } } });
  }
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'RELEASED', assignedToId: null } });
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.rejected', before: { status: 'SUBMITTED' }, after: { status: 'REJECTED', reason: args.reason, quarantined: quarantine, ...args.auditAfter } });
}
