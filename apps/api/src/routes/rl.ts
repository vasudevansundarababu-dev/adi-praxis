import type { Prisma } from '@prisma/client';
import { clusterFields, RLReviewRequestInput, RLVerdictRequest, rlVerdictProblems, scoreQueryClustering, type EvalResult, type TrajectoryStep } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { InternalActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { toRecordDto } from './dataset';
import { AppError, badRequest, notFound } from '../lib/errors';
import { runCommand, runStaffOrServiceCommand } from '../platform/command';
import { appendRlRecord, RL_RECORD_SCHEMA_VERSION, rlResultPayload } from '../rl/rl-records';

const IdParams = z.object({ id: z.string().uuid() });
const REVIEW = ['REVIEWER', 'ADMIN'] as const;
const RL_GYM = { roles: ['ADMIN'] as const, apiClient: 'RL_GYM' as const };

/** Reviewers qualified for the task's domain and workflow: those assigned to the source project (or Admins). */
async function rlTask(tx: Db | Tx, actor: InternalActor, taskId: string) {
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, clientId: actor.clientId, taskType: 'RL_REVIEW' }, include: { rlReviewRequest: true, project: { include: { template: true } } } });
  if (!t || !t.rlReviewRequest) throw notFound('Review task not found');
  if (!actor.roles.includes('ADMIN')) {
    const ok = await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId: t.projectId, userId: actor.userId } } });
    if (!ok) throw notFound('Review task not found');
  }
  return t;
}

const steps = (trajectories: unknown) => ((trajectories as { steps?: TrajectoryStep[] }).steps ?? null);

/** SPEC FLOW 4: RL Gym result review. */
/**
 * Q4 query clustering (owner, 12 Nov 2026): pairwise F1 of the run's clusters against the approved task's reference
 * output. Advice for the Reviewer only; the verdict stays theirs. Null when no source is a per-query clustering task.
 */
function clusteringFor(sourceOutputs: unknown[], finalOutput: unknown) {
  const reference = sourceOutputs
    .map((o) => (o as { praxisContract?: { rubric?: { reference_output?: Record<string, unknown> } } } | null)?.praxisContract?.rubric?.reference_output)
    .find((ref) => ref && clusterFields(ref).length);
  if (!reference) return null;
  if (!finalOutput || typeof finalOutput !== 'object' || Array.isArray(finalOutput)) return { available: false as const, reason: 'RL Gym did not send the run\'s output.json (final_output), so clustering F1 cannot be computed.' };
  return { available: true as const, ...scoreQueryClustering(reference, finalOutput as Record<string, unknown>)! };
}

export const rlRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Inbound request: exactly one RL_REVIEW task per (rl_run_id, rl_task_id); a duplicate creates nothing.
  app.post('/integrations/rl-gym/review-requests', { config: { access: RL_GYM, rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { tags: ['rl'], body: RLReviewRequestInput } }, async (req, reply) => {
    await runStaffOrServiceCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const b = req.body;
      const existing = await tx.rLReviewRequest.findUnique({ where: { rlRunId_rlTaskId: { rlRunId: b.rl_run_id, rlTaskId: b.rl_task_id } }, include: { task: true } });
      if (existing) {
        if (existing.clientId !== actor.clientId) throw new AppError(409, 'CONFLICT', 'This review request id is already in use.');
        await audit({ entityType: 'RLReviewRequest', entityId: existing.id, action: 'rl_review.duplicate_ignored', after: { rlRunId: b.rl_run_id, rlTaskId: b.rl_task_id } });
        return { status: 200, body: { id: existing.id, taskId: existing.task?.id ?? null, duplicate: true } };
      }
      const sources = await tx.approvedTaskRecord.findMany({ where: { id: { in: b.source_record_ids }, clientId: actor.clientId }, select: { id: true, projectId: true } });
      const missing = b.source_record_ids.filter((id) => !sources.some((s) => s.id === id));
      if (missing.length) throw new AppError(422, 'UNKNOWN_SOURCE_RECORDS', 'Some source records are not in the Approved Task Dataset.', { problems: missing });
      const request = await tx.rLReviewRequest.create({
        data: {
          clientId: actor.clientId,
          rlRunId: b.rl_run_id,
          rlTaskId: b.rl_task_id,
          sourceRecordIds: b.source_record_ids,
          evalResults: b.eval_results as Prisma.InputJsonValue,
          trajectories: b.trajectories as Prisma.InputJsonValue,
          rubricId: b.rubric_id ?? null,
          finalOutput: (b.final_output ?? undefined) as Prisma.InputJsonValue | undefined,
          priority: b.priority,
          dueBy: b.due_by ? new Date(b.due_by) : null,
        },
      });
      const task = await tx.taskInstance.create({ data: { clientId: actor.clientId, projectId: sources.find((s) => s.id === b.source_record_ids[0])!.projectId, taskType: 'RL_REVIEW', rlReviewRequestId: request.id, input: { rlRunId: b.rl_run_id, rlTaskId: b.rl_task_id } } });
      await audit({ entityType: 'RLReviewRequest', entityId: request.id, action: 'rl_review.requested', after: { rlRunId: b.rl_run_id, rlTaskId: b.rl_task_id, taskId: task.id, sources: b.source_record_ids.length } });
      await emit({ name: 'rl_review.requested', aggregateType: 'RLReviewRequest', aggregateId: request.id, payload: { requestId: request.id, taskId: task.id } });
      return { status: 201, body: { id: request.id, taskId: task.id, duplicate: false } };
    });
    return reply;
  });

  // Pull fallback: results in chain order after a sequence number.
  app.get('/integrations/rl-gym/results', { config: { access: RL_GYM }, schema: { tags: ['rl'], querystring: z.object({ after: z.coerce.bigint().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) } }, async (req) => {
    const clientId = (req.actor ?? req.apiClient)!.clientId;
    const rows = await db.rLReviewRecord.findMany({ where: { clientId, ...(req.query.after !== undefined ? { seq: { gt: req.query.after } } : {}) }, orderBy: { seq: 'asc' }, take: req.query.limit });
    return { items: rows.map(rlResultPayload), next: rows.length === req.query.limit ? String(rows.at(-1)!.seq) : null };
  });

  // Queue: priority first, then due date.
  app.get('/review/rl', { config: { access: REVIEW }, schema: { tags: ['rl'], querystring: z.object({ status: z.enum(['OPEN', 'DONE']).default('OPEN') }) } }, async (req) => {
    const actor = req.actor!;
    const projectIds = actor.roles.includes('ADMIN') ? undefined : (await db.projectReviewer.findMany({ where: { userId: actor.userId } })).map((r) => r.projectId);
    const rows = await db.taskInstance.findMany({
      where: { clientId: actor.clientId, taskType: 'RL_REVIEW', status: req.query.status === 'OPEN' ? { in: ['CREATED', 'IN_PROGRESS'] } : 'SUBMITTED', ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      include: { rlReviewRequest: true, project: { include: { template: true } } },
      take: 500,
    });
    const reviewers = await db.user.findMany({ where: { id: { in: rows.map((r) => r.reviewerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return {
      items: rows
        .map((t) => ({
          id: t.id,
          rlRunId: t.rlReviewRequest!.rlRunId,
          rlTaskId: t.rlReviewRequest!.rlTaskId,
          workflow: t.project.template.workflowName,
          projectName: t.project.name,
          priority: t.rlReviewRequest!.priority,
          dueBy: t.rlReviewRequest!.dueBy?.toISOString() ?? null,
          failedEvals: ((t.rlReviewRequest!.evalResults ?? []) as EvalResult[]).filter((e) => !e.passed).length,
          status: t.status,
          claimedBy: reviewers.find((u) => u.id === t.reviewerId)?.name ?? null,
          receivedAt: t.createdAt.toISOString(),
        }))
        .sort((a, b) => b.priority - a.priority || (a.dueBy ?? '9999').localeCompare(b.dueBy ?? '9999') || a.receivedAt.localeCompare(b.receivedAt)),
    };
  });

  // Review screen: the original approved input and output, the trajectory step by step, and the eval results.
  app.get('/review/rl/:id', { config: { access: REVIEW }, schema: { tags: ['rl'], params: IdParams } }, async (req) => {
    const t = await rlTask(db, req.actor!, req.params.id);
    const r = t.rlReviewRequest!;
    const sources = await db.approvedTaskRecord.findMany({ where: { id: { in: r.sourceRecordIds } } });
    const codes = await db.failureReasonCode.findMany({ where: { clientId: t.clientId, active: true }, orderBy: { code: 'asc' } });
    const record = await db.rLReviewRecord.findFirst({ where: { rlReviewRequestId: r.id }, orderBy: { seq: 'desc' } });
    const delivery = record ? await db.rLResultDelivery.findUnique({ where: { recordId: record.id } }) : null;
    return {
      id: t.id,
      status: t.status,
      revision: t.revision,
      claimedByMe: t.reviewerId === req.actor!.userId,
      claimedBy: t.reviewerId,
      request: { id: r.id, rlRunId: r.rlRunId, rlTaskId: r.rlTaskId, priority: r.priority, dueBy: r.dueBy?.toISOString() ?? null, rubricId: r.rubricId },
      rubric: r.rubricId ? { id: r.rubricId, text: null } : { id: null, text: t.project.template.verificationCriteria },
      sources: sources.map(toRecordDto),
      evalResults: r.evalResults,
      clustering: clusteringFor(sources.map((x) => x.output), r.finalOutput),
      trajectory: steps(r.trajectories),
      trajectoryUrl: (r.trajectories as { signedUrl?: string }).signedUrl ?? null,
      reasonCodes: codes.map((c) => ({ code: c.code, label: c.label })),
      result: record ? { ...rlResultPayload(record), delivery: delivery ? { status: delivery.status, attempts: delivery.attempts, deliveredAt: delivery.deliveredAt?.toISOString() ?? null, lastError: delivery.lastError } : null } : null,
    };
  });

  app.post('/review/rl/:id/claim', { config: { access: REVIEW }, schema: { tags: ['rl'], params: IdParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await rlTask(tx, actor, req.params.id);
      if (t.status !== 'CREATED') throw new AppError(409, 'ALREADY_CLAIMED', t.reviewerId === actor.userId ? 'You already have this review.' : 'Another Validator has this review.');
      const { count } = await tx.taskInstance.updateMany({ where: { id: t.id, status: 'CREATED' }, data: { status: 'IN_PROGRESS', reviewerId: actor.userId, startedAt: new Date(), assignedAt: new Date(), revision: { increment: 1 } } });
      if (!count) throw new AppError(409, 'ALREADY_CLAIMED', 'Another Validator has this review.');
      await tx.rLReviewRequest.update({ where: { id: t.rlReviewRequestId! }, data: { status: 'IN_REVIEW' } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'rl_review.claimed', after: { reviewerId: actor.userId } });
      return { status: 200, body: { status: 'IN_PROGRESS', revision: t.revision + 1 } };
    });
    return reply;
  });

  // Verdict: written to the append-only RLReviewRecord in the same transaction, then delivered to RL Gym.
  app.post('/review/rl/:id/verdict', { config: { access: REVIEW }, schema: { tags: ['rl'], params: IdParams, body: RLVerdictRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const t = await rlTask(tx, actor, req.params.id);
      if (t.status !== 'IN_PROGRESS' || t.reviewerId !== actor.userId) throw new AppError(409, 'NOT_CLAIMED', 'Claim this review before submitting a verdict.');
      if (t.revision !== req.body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'This review changed; reload it.');
      const r = t.rlReviewRequest!;
      const codes = (await tx.failureReasonCode.findMany({ where: { clientId: t.clientId, active: true } })).map((c) => c.code);
      const problems = rlVerdictProblems(req.body, { metrics: (r.evalResults as EvalResult[]).map((e) => e.metric), reasonCodes: codes, stepCount: steps(r.trajectories)?.length ?? null });
      if (problems.length) throw new AppError(400, 'INVALID_VERDICT', problems[0]!, { problems });
      const now = new Date();
      const record = await appendRlRecord(tx, {
        clientId: t.clientId,
        schemaVersion: RL_RECORD_SCHEMA_VERSION,
        supersedesId: null,
        rlReviewRequestId: r.id,
        rlRunId: r.rlRunId,
        rlTaskId: r.rlTaskId,
        sourceRecordIds: r.sourceRecordIds,
        reviewerId: actor.userId,
        verdict: req.body.verdict,
        metricVerdicts: req.body.metricVerdicts as Prisma.JsonValue,
        comments: req.body.comments as Prisma.JsonValue,
        reasonCodes: [...new Set(req.body.comments.map((c) => c.reasonCode).filter((c): c is string => !!c))].sort(),
        rubricId: r.rubricId,
        reviewStartedAt: t.startedAt,
        reviewSubmittedAt: now,
      });
      await tx.rLResultDelivery.create({ data: { clientId: t.clientId, recordId: record.id } });
      await tx.taskInstance.update({ where: { id: t.id }, data: { status: 'SUBMITTED', submittedAt: now, output: { verdict: req.body.verdict, recordId: record.id }, revision: { increment: 1 } } });
      await tx.rLReviewRequest.update({ where: { id: r.id }, data: { status: 'COMPLETED' } });
      await audit({ entityType: 'RLReviewRecord', entityId: record.id, action: 'rl_review.completed', after: { verdict: record.verdict, taskId: t.id, rlRunId: r.rlRunId, rlTaskId: r.rlTaskId } });
      await emit({ name: 'rl_review.completed', aggregateType: 'RLReviewRecord', aggregateId: record.id, payload: { recordId: record.id, requestId: r.id } });
      return { status: 200, body: { recordId: record.id, verdict: record.verdict } };
    });
    return reply;
  });

  // Failure reason codes: seeded, Admin-editable.
  app.get('/failure-reason-codes', { config: { access: REVIEW }, schema: { tags: ['rl'] } }, async (req) => ({
    items: (await db.failureReasonCode.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { code: 'asc' } })).map((c) => ({ id: c.id, code: c.code, label: c.label, active: c.active })),
  }));
  app.post('/failure-reason-codes', { config: { access: ['ADMIN'] }, schema: { tags: ['rl'], body: z.object({ code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,40}$/), label: z.string().trim().min(1).max(100) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await tx.failureReasonCode.create({ data: { clientId: actor.clientId, code: req.body.code, label: req.body.label } });
      await audit({ entityType: 'FailureReasonCode', entityId: c.id, action: 'failure_code.created', after: { code: c.code, label: c.label } });
      return { status: 201, body: { id: c.id, code: c.code, label: c.label, active: c.active } };
    });
    return reply;
  });
  app.patch('/failure-reason-codes/:id', { config: { access: ['ADMIN'] }, schema: { tags: ['rl'], params: IdParams, body: z.object({ label: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await tx.failureReasonCode.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!c) throw notFound('Code not found');
      if (req.body.label === undefined && req.body.active === undefined) throw badRequest('Nothing to change');
      const next = await tx.failureReasonCode.update({ where: { id: c.id }, data: req.body });
      await audit({ entityType: 'FailureReasonCode', entityId: c.id, action: 'failure_code.updated', before: { label: c.label, active: c.active }, after: { label: next.label, active: next.active } });
      return { status: 200, body: { id: next.id, code: next.code, label: next.label, active: next.active } };
    });
    return reply;
  });
};
