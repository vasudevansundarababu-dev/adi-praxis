import { AdditionDecision, RestoreRequest, RunRequest, SaveCriterionRequest, SaveTaskSourcesRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { reviewerTaskView } from '../forge/review';
import { requireForgeTerms } from '../forge/candidate';
import { sourcingProject } from '../forge/sourcing';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import type { SelectionGate } from '../staffing/selection-gate';
import type { RubricAssistant } from '../tasks/rubric/assistant';
import { aiScoringSuggestions, createRun, decideAddition, keepCriterion, noRuleAnnotations, policyLibrary, restoreCriterion, rubricContext, rubricView, saveCriterion, saveSources, type RuleAnnotationSource } from '../tasks/rubric/service';
import { outstanding, ownTask, workContext } from './work';

const IdParams = z.object({ id: z.string().uuid() });
const CriterionParams = IdParams.extend({ criterionId: z.string().min(1).max(80) });

/**
 * Rubric editor and recommendations, and the S4 policy library (docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md). Registered
 * only with RUBRIC_RECOMMENDATIONS_ENABLED: with it off every route here is a 404 and nothing else changes.
 * Writes are the task author's, while the task is editable, through commands (authorised, idempotent, audited).
 */
export const rubricRoutes: FastifyPluginAsyncZod<{ db: Db; selectionGate: SelectionGate; assistant: RubricAssistant | null; notes?: RuleAnnotationSource }> = async (app, { db, selectionGate, assistant, notes = noRuleAnnotations }) => {
  const contextOf = (t: Awaited<ReturnType<typeof ownTask>>) => {
    const ctx = rubricContext(t);
    if (!ctx) throw new AppError(404, 'NO_RUBRIC', 'This task’s form has no rubric.');
    return ctx;
  };

  /** The author's own task, editable now (the same rule as autosave). */
  async function editable(tx: Tx, taskId: string, smeUserId: string) {
    await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${taskId}::uuid FOR UPDATE`;
    const t = await ownTask(tx, taskId, smeUserId);
    const w = await workContext(tx, selectionGate, smeUserId, t.projectId);
    if (!w.ok) outstanding(w);
    if (t.taskType !== 'AUTHORING' || !['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status) || t.quarantinedAt) throw new AppError(409, 'READ_ONLY', 'This task is read-only now.');
    return contextOf(t);
  }

  app.get('/me/tasks/:id/rubric', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    return rubricView(db, contextOf(t), { aiEnabled: !!assistant, notes });
  });

  app.get('/me/tasks/:id/rubric/ai-scoring', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    return { items: await aiScoringSuggestions(db, t.id) };
  });

  // S4 (D6): the project's published documents and their applied rules. The author picks; nothing is typed.
  app.get('/me/tasks/:id/policy-library', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    return policyLibrary(db, t.clientId, t.projectId, notes);
  });

  app.post('/me/tasks/:id/rubric/runs', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams, body: RunRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await editable(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await createRun(tx, ctx, { mode: req.body.mode, actorId: `candidate:${actor.smeUserId}`, assistant, notes }, audit) };
    });
    return reply;
  });

  app.put('/me/tasks/:id/rubric/criteria/:criterionId', { config: { access: 'candidate', rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: CriterionParams, body: SaveCriterionRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await editable(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await saveCriterion(tx, ctx, req.params.criterionId, req.body, `candidate:${actor.smeUserId}`, audit, notes) };
    });
    return reply;
  });

  app.post('/me/tasks/:id/rubric/criteria/:criterionId/keep', { config: { access: 'candidate' }, schema: { tags: ['work'], params: CriterionParams, body: z.object({ expectedVersion: z.number().int().positive() }).strict() } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await editable(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await keepCriterion(tx, ctx, req.params.criterionId, req.body.expectedVersion, `candidate:${actor.smeUserId}`, audit, notes) };
    });
    return reply;
  });

  app.post('/me/tasks/:id/rubric/criteria/:criterionId/restore', { config: { access: 'candidate' }, schema: { tags: ['work'], params: CriterionParams, body: RestoreRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await editable(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await restoreCriterion(tx, ctx, req.params.criterionId, req.body.submissionVersion, `candidate:${actor.smeUserId}`, audit) };
    });
    return reply;
  });

  app.post('/me/tasks/:id/rubric/additions/:criterionId/decision', { config: { access: 'candidate' }, schema: { tags: ['work'], params: CriterionParams, body: AdditionDecision } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await editable(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await decideAddition(tx, ctx, req.params.criterionId, req.body.decision, req.body.expectedVersion, `candidate:${actor.smeUserId}`, audit, notes) };
    });
    return reply;
  });

  app.put('/me/tasks/:id/rubric/sources', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams, body: SaveTaskSourcesRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await editable(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await saveSources(tx, ctx, req.body, `candidate:${actor.smeUserId}`, audit, notes) };
    });
    return reply;
  });

  // Read-only views: the PM or Admin on the console task page, and the task's external Reviewer.
  app.get('/projects/:id/forge-tasks/:taskId/rubric', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['tasks'], params: IdParams.extend({ taskId: z.string().uuid() }) } }, async (req) => {
    const p = await sourcingProject(db, req.actor!, req.params.id);
    const t = await db.taskInstance.findFirst({ where: { id: req.params.taskId, projectId: p.id, clientId: req.actor!.clientId }, include: { project: { include: { template: true } } } });
    if (!t) throw notFound('Task not found');
    const ctx = rubricContext(t);
    if (!ctx) throw new AppError(404, 'NO_RUBRIC', 'This task’s form has no rubric.');
    return rubricView(db, ctx, { aiEnabled: !!assistant, notes });
  });

  app.get('/me/reviews/:taskId/rubric', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ taskId: z.string().uuid() }) } }, async (req) => {
    await requireForgeTerms(db, req.candidate!);
    await reviewerTaskView(db, req.candidate!, req.params.taskId); // the task's Reviewer only (throws otherwise)
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: req.params.taskId }, include: { project: { include: { template: true } } } });
    const ctx = rubricContext(t);
    if (!ctx) throw new AppError(404, 'NO_RUBRIC', 'This task’s form has no rubric.');
    return rubricView(db, ctx, { aiEnabled: !!assistant, notes });
  });
};
