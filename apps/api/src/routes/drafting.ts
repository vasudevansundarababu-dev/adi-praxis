import '@fastify/multipart';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import { MAX_DOCUMENT_BYTES } from '../candidate/document-text';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import type { SelectionGate } from '../staffing/selection-gate';
import { DRAFT_SECTIONS } from '../tasks/drafting/drafter';
import { answerInterview, assertDraftable, confirmSection, draftingView, removeSource, requestDraft, runView, uploadSource } from '../tasks/drafting/service';
import { reviewableTask } from '../tasks/review-service';
import { outstanding, ownTask, workContext } from './work';

const IdParams = z.object({ id: z.string().uuid() });
const SourceParams = IdParams.extend({ sourceId: z.string().uuid() });
const REVIEW = ['REVIEWER', 'ADMIN'] as const;

export const InterviewMessage = z.object({
  clientMessageId: z.string().min(8).max(100),
  questionId: z.string().min(1).max(50),
  content: z.string().max(4000).default(''),
  skip: z.boolean().default(false),
});
export const DraftRequest = z.object({
  section: z.enum(DRAFT_SECTIONS).optional(),
  instruction: z.string().trim().max(1000).optional(),
});

/**
 * M9 (docs/TASK-DRAFTING.md): start a KYC task from a document, a transcript or an AI interview, draft W01–W05, and
 * confirm each drafted section. Source files are private to the task: the author, the project's Reviewers and Admins.
 */
export const draftingRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage; scanner: MalwareScanner; selectionGate: SelectionGate }> = async (app, { db, storage, scanner, selectionGate }) => {
  /** The author's task, and that they may still work on the project (identity, onboarding, assignment). */
  async function authorTask(tx: Parameters<typeof ownTask>[0], taskId: string, smeUserId: string) {
    const t = await ownTask(tx, taskId, smeUserId);
    const ctx = await workContext(tx, selectionGate, smeUserId, t.projectId);
    if (!ctx.ok) outstanding(ctx);
    return t;
  }

  app.get('/me/tasks/:id/drafting', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    await assertDraftable(db, t);
    return draftingView(db, t);
  });

  app.post('/me/tasks/:id/sources', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 3 } });
    if (!file) throw badRequest('Attach a file');
    const field = (k: string) => (file.fields[k] as { value?: string } | undefined)?.value;
    const kind = field('kind') === 'TRANSCRIPT' ? 'TRANSCRIPT' : field('kind') === 'DOCUMENT' ? 'DOCUMENT' : null;
    if (!kind) throw badRequest('Say whether this is a DOCUMENT or an interview TRANSCRIPT');
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_DOCUMENT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await authorTask(tx, req.params.id, actor.smeUserId);
      const s = await uploadSource(tx, { storage, scanner }, { task: t, smeUserId: actor.smeUserId, kind, fileName: file.filename, buf, declaration: field('declaration') === 'true' }, audit);
      return { status: 201, body: { id: s.id, kind: s.kind, fileName: s.fileName, sizeBytes: s.sizeBytes, sha256: s.sha256, textChars: s.textChars, flags: s.scanFlags } };
    });
    return reply;
  });

  app.delete('/me/tasks/:id/sources/:sourceId', { config: { access: 'candidate' }, schema: { tags: ['work'], params: SourceParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await authorTask(tx, req.params.id, actor.smeUserId);
      await removeSource(tx, storage, { task: t, sourceId: req.params.sourceId }, audit);
      return { status: 204, body: undefined };
    });
    return reply;
  });

  app.get('/me/tasks/:id/sources/:sourceId/file', { config: { access: 'candidate' }, schema: { tags: ['work'], params: SourceParams } }, async (req, reply) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const s = await db.taskSource.findFirst({ where: { id: req.params.sourceId, taskInstanceId: t.id, deletedAt: null } });
    if (!s) throw notFound('Source not found');
    return reply.header('content-type', s.contentType).header('content-disposition', `attachment; filename="${s.fileName.replace(/"/g, '')}"`).header('cache-control', 'private, no-store').send(await storage.get(s.storageKey));
  });

  app.post('/me/tasks/:id/interview/messages', { config: { access: 'candidate', rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams, body: InterviewMessage } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await authorTask(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await answerInterview(tx, { task: t, ...req.body }, audit) };
    });
    return reply;
  });

  app.post('/me/tasks/:id/drafts', { config: { access: 'candidate', rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams, body: DraftRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const t = await authorTask(tx, req.params.id, actor.smeUserId);
      const run = await requestDraft(tx, { task: t, smeUserId: actor.smeUserId, section: req.body.section ?? null, instruction: req.body.instruction || null }, audit, emit);
      return { status: 202, body: runView(run) };
    });
    return reply;
  });

  app.get('/me/tasks/:id/drafts/:runId', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams.extend({ runId: z.string().uuid() }) } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const run = await db.taskDraftRun.findFirst({ where: { id: req.params.runId, taskInstanceId: t.id } });
    if (!run) throw notFound('Draft not found');
    return runView(run);
  });

  app.post('/me/tasks/:id/sections/:section/confirm', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams.extend({ section: z.enum(DRAFT_SECTIONS) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await authorTask(tx, req.params.id, actor.smeUserId);
      const st = await confirmSection(tx, { task: t, section: req.params.section }, audit);
      return { status: 200, body: st };
    });
    return reply;
  });

  // Reviewer (R02 "How this task was made"): open a source file. Every opening is audited; PMs have no access.
  app.get('/review/tasks/:id/sources/:sourceId/file', { config: { access: REVIEW }, schema: { tags: ['review'], params: SourceParams } }, async (req, reply) => {
    const actor = req.actor!;
    const t = await reviewableTask(db, actor, req.params.id);
    const s = await db.taskSource.findFirst({ where: { id: req.params.sourceId, taskInstanceId: t.id, deletedAt: null } });
    if (!s) throw notFound('Source not found');
    await db.auditEvent.create({ data: { clientId: actor.clientId, actorType: 'USER', actorId: actor.userId, requestId: req.id, entityType: 'TaskInstance', entityId: t.id, action: 'task.source.opened', after: { sourceId: s.id, sha256: s.sha256 } } });
    return reply.header('content-type', s.contentType).header('content-disposition', `attachment; filename="${s.fileName.replace(/"/g, '')}"`).header('cache-control', 'private, no-store').send(await storage.get(s.storageKey));
  });
};
