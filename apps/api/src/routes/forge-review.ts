import { ForgeDecisionRequest, ForgeSendBackRequest, ReviewerDecisionRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { forgeDecide, forgeSendBack, forgeTaskRows, forgeTaskView, requireNewFlow, reviewerDecide, reviewerTaskList, reviewerTaskView } from '../forge/review';
import { requireForgeTerms } from '../forge/candidate';
import { forgeSettings } from '../forge/settings';
import { raisePlacesToTaskCount, sourcingProject } from '../forge/sourcing';
import { writeAudit, type AuditInput } from '../platform/audit';
import { runCandidateCommand, runCommand } from '../platform/command';
import { decisionReply } from '../tasks/revalidation';
import { ensureSlotTasks } from '../tasks/task-service';

const ACCESS = ['ADMIN', 'PM'] as const;
const IdParams = z.object({ id: z.string().uuid() });
const TaskParams = IdParams.extend({ taskId: z.string().uuid() });

/** MVP1 step 2: the project's Tasks tab (review page and decision box) and the external Reviewer in the candidate app. */
export const forgeReviewRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get('/projects/:id/forge-tasks', { config: { access: ACCESS }, schema: { tags: ['tasks'], params: IdParams } }, async (req) => {
    const actor = req.actor!;
    const p = await sourcingProject(db, actor, req.params.id);
    await requireNewFlow(db, p.clientId);
    // One row per task the project defines: rows are made on first need (audited when any are made).
    await db.$transaction(async (tx) => {
      if (!(await forgeSettings(tx, p.clientId)).newFlow) return;
      const made = await ensureSlotTasks(tx, p.id);
      const audit = (i: AuditInput) => writeAudit(tx, { clientId: actor.clientId, actorType: 'USER', actorId: actor.userId, requestId: String(req.id) }, i);
      if (made) await audit({ entityType: 'Project', entityId: p.id, action: 'project.task_rows_created', after: { tasks: made } });
      await raisePlacesToTaskCount(tx, p.id, audit);
    });
    return { reviewRoute: p.reviewRoute, items: await forgeTaskRows(db, actor, p.id) };
  });

  app.get('/projects/:id/forge-tasks/:taskId', { config: { access: ACCESS }, schema: { tags: ['tasks'], params: TaskParams } }, async (req) => {
    await requireNewFlow(db, req.actor!.clientId);
    return forgeTaskView(db, req.actor!, req.params.id, req.params.taskId);
  });

  app.post('/projects/:id/tasks/:taskId/decision', { config: { access: ACCESS }, schema: { tags: ['tasks'], params: TaskParams, body: ForgeDecisionRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => decisionReply(await forgeDecide(tx, actor, req.params.id, req.params.taskId, req.body, audit, emit)));
    return reply;
  });

  // PM/Admin: send an approved task back to its author for a new revision; the approved record is kept.
  app.post('/projects/:id/tasks/:taskId/send-back', { config: { access: ACCESS }, schema: { tags: ['tasks'], params: TaskParams, body: ForgeSendBackRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 200, body: await forgeSendBack(tx, actor, req.params.id, req.params.taskId, req.body, audit) }));
    return reply;
  });

  app.get('/me/reviews', { config: { access: 'candidate' }, schema: { tags: ['work'] } }, async (req) => {
    await requireNewFlow(db, req.candidate!.clientId);
    return { items: await reviewerTaskList(db, req.candidate!) };
  });

  app.get('/me/reviews/:taskId', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ taskId: z.string().uuid() }) } }, async (req) => {
    await requireNewFlow(db, req.candidate!.clientId);
    await requireForgeTerms(db, req.candidate!);
    return reviewerTaskView(db, req.candidate!, req.params.taskId);
  });

  app.post('/me/reviews/:taskId/decision', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ taskId: z.string().uuid() }), body: ReviewerDecisionRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      await requireForgeTerms(tx, actor);
      return decisionReply(await reviewerDecide(tx, actor, req.params.taskId, req.body, audit, emit));
    });
    return reply;
  });
};
