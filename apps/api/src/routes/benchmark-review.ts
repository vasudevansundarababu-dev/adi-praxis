import type { Prisma, RlGymDecisionDelivery, RlGymReviewBatch, RlGymReviewDecision } from '@prisma/client';
import { BatchDetailDto, BatchSummaryDto, DecisionDto, DecisionRequest, SME_DECISIONS_SCHEMA, SmeReviewPackage, type BenchmarkDecision } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { jcsSha256 } from '../anvil/jcs';
import { AppError, notFound } from '../lib/errors';
import { runCommand, runCommandPrepared, runStaffOrServiceCommand } from '../platform/command';
import type { AuditInput } from '../platform/audit';
import type { RlGymClient, RlGymResult } from '../anvil/rlgym-client';

const ANVIL = { roles: [] as const, apiClient: 'ANVIL' as const };
const STAFF = ['ADMIN', 'PM', 'REVIEWER'] as const;
const isAdmin = (a: Actor) => a.roles.includes('ADMIN');
type Audit = (i: AuditInput) => Promise<void>;

/**
 * Benchmark review (new RL Gym part 3; docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.1 b, §3.2 b).
 * The RL Gym sends SME review batches into a project; the project's Reviewers, its PM and Admins decide each item (a
 * decision is final); ADI Forge sends each decision back. "Task needs correction" sends the task back to its author as
 * a normal Rework; the corrected revision returns in the next re-export with `corrects_revision` and `sme_batch_id`.
 */

/** Who may open and decide a project's benchmark reviews: Admins, the owning PM, and Reviewers assigned to it. */
async function reviewableProject(db: Db | Tx, projectId: string, actor: Actor) {
  const p = await db.project.findFirst({ where: { id: projectId, clientId: actor.clientId }, select: { id: true, ownerId: true } });
  if (!p) throw notFound('Project not found');
  if (isAdmin(actor) || (actor.roles.includes('PM') && p.ownerId === actor.userId)) return p;
  if (actor.roles.includes('REVIEWER') && (await db.projectReviewer.findUnique({ where: { projectId_userId: { projectId, userId: actor.userId } } }))) return p;
  throw notFound('Project not found');
}

type Episode = { item_id: string; episode_id: string };
const episodesOf = (b: RlGymReviewBatch) => ((b.body as { tasks?: { task_id: string; revision: number; episodes: Episode[] }[] }).tasks ?? []).flatMap((t) => t.episodes.map((e) => ({ ...e, task_id: t.task_id, revision: t.revision })));

const deliveryDto = (d: RlGymDecisionDelivery | undefined) => (d ? { outcome: d.outcome as 'delivered' | 'rejected' | 'unavailable', httpStatus: d.httpStatus, requestId: d.requestId, error: (d.error as { code: string; message: string } | null) ?? null, at: d.createdAt.toISOString() } : null);
/** The opaque reference sent as `decided_by`: the decision's author, never a person's name or email. */
const decidedByRef = (userId: string) => `adi-forge-user:${userId}`;

function decisionDto(d: RlGymReviewDecision, deliveries: RlGymDecisionDelivery[], names: Map<string, string>): DecisionDto {
  const last = deliveries.filter((x) => x.decisionId === d.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return { id: d.id, itemId: d.itemId, decision: d.decision as BenchmarkDecision, rationale: d.rationale, criterionId: d.criterionId, decidedBy: names.get(d.decidedById) ?? 'A reviewer', decidedAt: d.createdAt.toISOString(), delivery: deliveryDto(last) };
}

/**
 * "Task needs correction": the task goes back to its author as a normal Rework (same state change as the D18 path), with
 * the reviewer's rationale as the rework note. Its approved record stays (append-only). Returns false when the task is
 * not an approved task of this project (nothing changes).
 */
async function reworkForBenchmark(tx: Tx, projectId: string, taskId: string, args: { actorId: string; rationale: string; batchId: string; itemId: string }, audit: Audit) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return false;
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, projectId }, include: { submissions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } } });
  if (!t || t.status !== 'ACCEPTED') return false;
  const notes = `Benchmark review: ${args.rationale}`;
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, status: 'ACCEPTED', revision: t.revision },
    data: { status: 'REWORK', reviewStage: null, reworkCount: { increment: 1 }, revision: { increment: 1 }, reviewNotes: notes, reviewerId: args.actorId },
  });
  if (!count) return false;
  await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: t.submissions[0]?.version ?? 1, reviewerId: args.actorId, decision: 'REWORK', stage: null, checklist: {}, comments: [] as Prisma.InputJsonValue, notes } });
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.rework_benchmark_review', before: { status: 'ACCEPTED' }, after: { status: 'REWORK', batchId: args.batchId, itemId: args.itemId, recordKept: true } });
  return true;
}

export const benchmarkReviewRoutes: FastifyPluginAsyncZod<{ db: Db; rlgym: RlGymClient | null }> = async (app, { db, rlgym }) => {
  // ── RL Gym → ADI Forge: a review batch for a project ──
  app.post('/projects/:projectId/run-reviews', { config: { access: ANVIL }, bodyLimit: 8 * 1024 * 1024, schema: { tags: ['anvil'], params: z.object({ projectId: z.string().uuid() }), body: z.record(z.string(), z.unknown()) } }, async (req, reply) => {
    const client = req.apiClient;
    if (!client) throw new AppError(401, 'UNAUTHENTICATED', 'An RL Gym key is required.');
    const parsed = SmeReviewPackage.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'REVIEW_BATCH_INVALID', 'The batch does not follow rlgym.sme-review-package.v1.', { issues: parsed.error.issues.slice(0, 20).map((i) => `/${i.path.join('/')}: ${i.message}`) });
    const pkg = parsed.data;
    if (pkg.project_id !== req.params.projectId) throw new AppError(422, 'REVIEW_BATCH_INVALID', 'project_id in the body and the path differ.');
    const items = pkg.tasks.flatMap((t) => t.episodes.map((e) => e.item_id));
    if (new Set(items).size !== items.length) throw new AppError(422, 'REVIEW_BATCH_INVALID', 'Each item_id must appear once in the batch.');
    const { batch_sha256: _ignored, ...content } = req.body as Record<string, unknown>;
    await runStaffOrServiceCommand(db, req, reply, async ({ tx, audit }) => {
      const p = await tx.project.findFirst({ where: { id: req.params.projectId, clientId: client.clientId }, select: { id: true } });
      if (!p) throw notFound('Project not found');
      // Idempotent by batch_id: the same batch again answers with the same reference; other content is a conflict.
      const same = await tx.rlGymReviewBatch.findUnique({ where: { clientId_batchId: { clientId: client.clientId, batchId: pkg.batch_id } } });
      if (same) {
        if (jcsSha256(same.body) !== jcsSha256(content)) throw new AppError(409, 'BATCH_CONFLICT', `Batch ${pkg.batch_id} was already received with different content.`);
        await audit({ entityType: 'Project', entityId: p.id, action: 'project.rlgym_review_batch_repeated', after: { batchId: pkg.batch_id, forgeBatchRef: same.forgeBatchRef } });
        return { status: 202, body: { forge_batch_ref: same.forgeBatchRef } };
      }
      const ref = `fbr-${randomBytes(8).toString('hex')}`;
      await tx.rlGymReviewBatch.create({ data: { clientId: client.clientId, projectId: p.id, batchId: pkg.batch_id, forgeBatchRef: ref, runId: pkg.run_id, itemCount: items.length, body: content as Prisma.InputJsonValue, apiClientId: client.apiClientId } });
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.rlgym_review_batch_received', after: { batchId: pkg.batch_id, runId: pkg.run_id, items: items.length, forgeBatchRef: ref } });
      return { status: 202, body: { forge_batch_ref: ref } };
    });
    return reply;
  });

  // ── Console: the project's batches ──
  app.get('/projects/:id/benchmark-reviews', { config: { access: STAFF }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid() }), response: { 200: z.object({ items: z.array(BatchSummaryDto), connected: z.boolean() }) } } }, async (req) => {
    const p = await reviewableProject(db, req.params.id, req.actor!);
    const batches = await db.rlGymReviewBatch.findMany({ where: { clientId: req.actor!.clientId, projectId: p.id }, orderBy: { createdAt: 'desc' } });
    const decisions = await db.rlGymReviewDecision.findMany({ where: { projectId: p.id, reviewBatchId: { in: batches.map((b) => b.id) } } });
    const delivered = new Set((await db.rlGymDecisionDelivery.findMany({ where: { decisionId: { in: decisions.map((d) => d.id) }, outcome: 'delivered' }, select: { decisionId: true } })).map((d) => d.decisionId));
    return {
      connected: !!rlgym,
      items: batches.map((b) => {
        const mine = decisions.filter((d) => d.reviewBatchId === b.id);
        return { id: b.id, batchId: b.batchId, runId: b.runId, receivedAt: b.createdAt.toISOString(), items: b.itemCount, decided: mine.length, undelivered: mine.filter((d) => !delivered.has(d.id)).length };
      }),
    };
  });

  async function detail(projectId: string, reviewId: string, actor: Actor): Promise<BatchDetailDto> {
    const p = await reviewableProject(db, projectId, actor);
    const b = await db.rlGymReviewBatch.findFirst({ where: { id: reviewId, projectId: p.id, clientId: actor.clientId } });
    if (!b) throw notFound('Review batch not found');
    const decisions = await db.rlGymReviewDecision.findMany({ where: { reviewBatchId: b.id }, orderBy: { createdAt: 'asc' } });
    const deliveries = await db.rlGymDecisionDelivery.findMany({ where: { decisionId: { in: decisions.map((d) => d.id) } } });
    const users = await db.user.findMany({ where: { id: { in: [...new Set(decisions.map((d) => d.decidedById))] } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    const body = b.body as { tasks: { task_id: string; revision: number; episodes: Record<string, unknown>[] }[]; rubric?: Record<string, unknown>[]; scoring_pass?: Record<string, unknown>; note?: string | null };
    const ids = body.tasks.map((t) => t.task_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const records = await db.approvedTaskRecord.findMany({ where: { projectId: p.id, taskInstanceId: { in: ids } }, orderBy: { seq: 'desc' }, select: { taskInstanceId: true, output: true } });
    const title = (id: string) => {
      const r = records.find((x) => x.taskInstanceId === id);
      const t = (r?.output as { header?: { title?: unknown } } | null)?.header?.title;
      return typeof t === 'string' && t ? t : null;
    };
    const delivered = new Set(deliveries.filter((d) => d.outcome === 'delivered').map((d) => d.decisionId));
    return {
      id: b.id,
      batchId: b.batchId,
      runId: b.runId,
      receivedAt: b.createdAt.toISOString(),
      items: b.itemCount,
      decided: decisions.length,
      undelivered: decisions.filter((d) => !delivered.has(d.id)).length,
      rubric: body.rubric ?? [],
      scoringPass: body.scoring_pass ?? null,
      note: body.note ?? null,
      tasks: body.tasks.map((t) => ({ taskId: t.task_id, revision: t.revision, title: title(t.task_id), episodes: t.episodes })),
      decisions: decisions.map((d) => decisionDto(d, deliveries, names)),
      canDecide: true,
      connected: !!rlgym,
    };
  }

  app.get('/projects/:id/benchmark-reviews/:reviewId', { config: { access: STAFF }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), reviewId: z.string().uuid() }), response: { 200: BatchDetailDto } } }, async (req) => detail(req.params.id, req.params.reviewId, req.actor!));

  // ── Console: decide one item (final). Sending to the RL Gym is the next call (also the retry). ──
  app.post('/projects/:id/benchmark-reviews/:reviewId/decisions', { config: { access: STAFF }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), reviewId: z.string().uuid() }), body: DecisionRequest, response: { 201: DecisionDto } } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await reviewableProject(tx, req.params.id, actor);
      const b = await tx.rlGymReviewBatch.findFirst({ where: { id: req.params.reviewId, projectId: p.id, clientId: actor.clientId } });
      if (!b) throw notFound('Review batch not found');
      const item = episodesOf(b).find((e) => e.item_id === req.body.itemId);
      if (!item) throw notFound('Review item not found in this batch');
      const criteria = ((b.body as { rubric?: { criterion_id: string }[] }).rubric ?? []).map((c) => c.criterion_id);
      if (req.body.criterionId && criteria.length && !criteria.includes(req.body.criterionId)) throw new AppError(422, 'CRITERION_UNKNOWN', `Criterion ${req.body.criterionId} is not in this batch's rubric.`);
      const existing = await tx.rlGymReviewDecision.findUnique({ where: { reviewBatchId_itemId: { reviewBatchId: b.id, itemId: item.item_id } } });
      if (existing) throw new AppError(409, 'DECISION_FINAL', 'This item already has a decision. A decision is final.');
      const d = await tx.rlGymReviewDecision.create({
        data: { clientId: actor.clientId, projectId: p.id, reviewBatchId: b.id, batchId: b.batchId, itemId: item.item_id, episodeId: item.episode_id, taskId: item.task_id, taskRevision: item.revision, decision: req.body.decision, rationale: req.body.rationale, criterionId: req.body.criterionId ?? null, decidedById: actor.userId },
      });
      const reworked = req.body.decision === 'task_correction' ? await reworkForBenchmark(tx, p.id, item.task_id, { actorId: actor.userId, rationale: req.body.rationale, batchId: b.batchId, itemId: item.item_id }, audit) : false;
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.benchmark_review_decided', after: { batchId: b.batchId, itemId: item.item_id, taskId: item.task_id, decision: d.decision, criterionId: d.criterionId, reworked } });
      const name = (await tx.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? 'A reviewer';
      return { status: 201, body: decisionDto(d, [], new Map([[actor.userId, name]])) };
    });
    return reply;
  });

  // ── Console: send a decision to the RL Gym (and send again after a failure) ──
  app.post('/projects/:id/benchmark-reviews/:reviewId/decisions/:decisionId/send', { config: { access: STAFF }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), reviewId: z.string().uuid(), decisionId: z.string().uuid() }), body: z.object({}).strict(), response: { 201: DecisionDto } } }, async (req, reply) => {
    await runCommandPrepared<{ decision: RlGymReviewDecision; result: RlGymResult }, DecisionDto>(
      db,
      req,
      reply,
      async (actor) => {
        const p = await reviewableProject(db, req.params.id, actor);
        const d = await db.rlGymReviewDecision.findFirst({ where: { id: req.params.decisionId, reviewBatchId: req.params.reviewId, projectId: p.id, clientId: actor.clientId } });
        if (!d) throw notFound('Decision not found');
        if (await db.rlGymDecisionDelivery.findFirst({ where: { decisionId: d.id, outcome: 'delivered' } })) throw new AppError(409, 'ALREADY_DELIVERED', 'RL Gym already has this decision.');
        if (!rlgym) throw new AppError(409, 'RLGYM_NOT_CONNECTED', 'RL Gym isn’t connected yet.');
        const body = { schema: SME_DECISIONS_SCHEMA, batch_id: d.batchId, decisions: [{ item_id: d.itemId, decision: d.decision, rationale: d.rationale, decided_by: decidedByRef(d.decidedById), ...(d.criterionId ? { criterion_id: d.criterionId } : {}) }] };
        // One key per decision: a resend is the same request to the RL Gym.
        return { decision: d, result: await rlgym.sendDecisions(d.batchId, body, `forge-decision-${d.id}`) };
      },
      async ({ tx, actor, audit }, { decision, result }) => {
        const row = await tx.rlGymDecisionDelivery.create({
          data: { clientId: actor.clientId, decisionId: decision.id, outcome: result.ok ? 'delivered' : result.kind, httpStatus: result.httpStatus, requestId: result.requestId, ...(result.ok ? {} : { error: { code: result.code, message: result.message } as Prisma.InputJsonValue }), requestedById: actor.userId },
        });
        await audit({ entityType: 'Project', entityId: decision.projectId, action: 'project.benchmark_decision_sent', after: { decisionId: decision.id, batchId: decision.batchId, itemId: decision.itemId, outcome: row.outcome, requestId: row.requestId } });
        const name = (await tx.user.findUnique({ where: { id: decision.decidedById }, select: { name: true } }))?.name ?? 'A reviewer';
        return { status: 201, body: decisionDto(decision, [row], new Map([[decision.decidedById, name]])) };
      },
    );
    return reply;
  });
};

/** For the re-export: the batch a task's latest "task needs correction" came from (`sme_batch_id`). */
export async function correctionBatches(db: Db | Tx, projectId: string): Promise<Map<string, string>> {
  const rows = await db.rlGymReviewDecision.findMany({ where: { projectId, decision: 'task_correction' }, orderBy: { createdAt: 'asc' }, select: { taskId: true, batchId: true } });
  return new Map(rows.map((r) => [r.taskId, r.batchId]));
}
