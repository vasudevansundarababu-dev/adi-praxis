import type { Prisma } from '@prisma/client';
import { authoringAgentView } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import { effectivePolicy } from '../policy/task-policy';
import type { SelectionGate } from '../staffing/selection-gate';
import { conversationInputProblems } from '../tasks/conversation/guards';
import { appendTurn, chatOf, CONVERSATION_VERSION, conversationView, decideProposal, draftingWith, editable } from '../tasks/conversation/service';
import { ownTask, outstanding, workContext } from './work';
const Params = z.object({ id: z.string().uuid() });
export const conversationRoutes: FastifyPluginAsyncZod<{ db: Db; selectionGate: SelectionGate }> = async (app, { db, selectionGate }) => {
  const load = async (tx: Parameters<typeof ownTask>[0], id: string, sme: string) => {
    const t = await ownTask(tx, id, sme);
    const ctx = await workContext(tx, selectionGate, sme, t.projectId); if (!ctx.ok) outstanding(ctx);
    if (t.taskType !== 'AUTHORING') throw new AppError(409, 'NOT_AUTHORING', 'Conversation is for authoring tasks.');
    return t;
  };
  app.get('/me/tasks/:id/conversation', { config: { access: 'candidate' }, schema: { params: Params } }, async req => conversationView(db, await load(db, req.params.id, req.candidate!.smeUserId)));
  app.get('/me/tasks/:id/agent-preview', { config: { access: 'candidate' }, schema: { params: Params } }, async req => {
    const t = await load(db, req.params.id, req.candidate!.smeUserId), policy = await effectivePolicy(db, t.clientId, t);
    return { task: authoringAgentView((t.output ?? {}) as Record<string, unknown>), policy: policy?.body.rules.filter(r => r.visibility === 'agent_visible') ?? [], note: 'Recorded responses are supplied only on matching tool calls. This is a preview, not execution.' };
  });
  app.post('/me/tasks/:id/conversation/messages', { config: { access: 'candidate', rateLimit: { max: 15, timeWindow: '1 minute' } }, schema: { params: Params, body: z.object({ content: z.string().trim().min(1).max(4000), expectedRevision: z.number().int().nonnegative() }).strict() } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const t = await load(tx, req.params.id, actor.smeUserId); editable(t);
      if (t.revision !== req.body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'Reload before continuing.');
      const inputProblems = conversationInputProblems(req.body.content);
      if (inputProblems.length) throw new AppError(422, 'UNSAFE_INPUT', 'Answer was not saved or sent to the model.', { problems: inputProblems });
      if (await tx.taskDraftRun.findFirst({ where: { taskInstanceId: t.id, status: { in: ['QUEUED', 'RUNNING'] } } })) throw new AppError(409, 'DRAFT_IN_PROGRESS', 'A model request is already active.');
      if (chatOf(t).pending) throw new AppError(409, 'PENDING_PROPOSAL', 'Confirm or discard the existing proposal first.');
      if (await tx.taskInterviewTurn.count({ where: { taskInstanceId: t.id, questionId: 'conversation' } }) >= 298) throw new AppError(409, 'CONVERSATION_LIMIT', 'Conversation limit reached; no history was discarded.');
      const policy = await effectivePolicy(tx, t.clientId, t);
      await appendTurn(tx, t, 'AUTHOR', req.body.content);
      const run = await tx.taskDraftRun.create({ data: { clientId: t.clientId, taskInstanceId: t.id, section: 'CHAT', instruction: JSON.stringify({ revision: t.revision, policyDigest: policy?.digest ?? 'none' }), sourceIds: [], requestedById: actor.smeUserId, promptVersion: CONVERSATION_VERSION } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.conversation.message', after: { runId: run.id, revision: t.revision } });
      await emit({ name: 'task.draft.requested', aggregateType: 'TaskInstance', aggregateId: t.id, payload: { taskId: t.id, runId: run.id } });
      return { status: 202, body: { runId: run.id } };
    }); return reply;
  });
  app.post('/me/tasks/:id/conversation/decision', { config: { access: 'candidate' }, schema: { params: Params, body: z.object({ runId: z.string().uuid(), accept: z.boolean() }).strict() } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const t = await load(tx, req.params.id, actor.smeUserId); editable(t);
      await decideProposal(tx, t, req.body.runId, req.body.accept);
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: req.body.accept ? 'task.conversation.confirmed' : 'task.conversation.discarded', after: { runId: req.body.runId } });
      return { status: 200, body: { accepted: req.body.accept } };
    }); return reply;
  });
  app.post('/me/tasks/:id/conversation/review', { config: { access: 'candidate' }, schema: { params: Params, body: z.object({ expectedRevision: z.number().int().nonnegative() }).strict() } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const t = await load(tx, req.params.id, actor.smeUserId); editable(t); const chat = chatOf(t);
      if (t.revision !== req.body.expectedRevision || chat.pending || chat.unresolved?.length) throw new AppError(409, 'REVIEW_INCOMPLETE', 'Resolve pending changes and follow-up questions before reviewing this revision.');
      chat.needsReview = false; chat.reviewedRevision = t.revision;
      await tx.taskInstance.update({ where: { id: t.id }, data: { drafting: JSON.parse(JSON.stringify(draftingWith(t, chat))) as Prisma.InputJsonValue } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.conversation.author_reviewed', after: { revision: t.revision } });
      return { status: 200, body: { reviewed: true } };
    }); return reply;
  });
};
