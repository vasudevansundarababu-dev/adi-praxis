import type { Prisma } from '@prisma/client';
import { SmeAuthoredTaskDto } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { auditRead } from '../meta-compiler/audit';
import { authoredTaskDto, authoredTaskInclude, type AuthoredTaskRow } from '../meta-compiler/task-store';

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;

const ListQuery = z.object({
  templateId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
const ListResponse = z.object({ items: z.array(SmeAuthoredTaskDto), nextCursor: z.string().uuid().nullable() });
/** "Inspect JSON" (S4-11): the row, the stored task.json and the per-task verification evidence. */
const DetailResponse = z.object({ task: SmeAuthoredTaskDto, taskJson: z.unknown(), verificationEvidence: z.unknown().nullable() });

const EXPORT_BATCH = 200;

function detail(t: AuthoredTaskRow) {
  return { task: authoredTaskDto(t, true), taskJson: t.taskJson, verificationEvidence: t.verificationEvidence ?? null };
}

/** The task store (S4-11, S4-12): every SME-authored task of the Admin's client. Bundle download and export are audited. */
export const metaCompilerStoreRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage }> = async (app, { db, storage }) => {
  app.get('/studio-tasks', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], querystring: ListQuery, response: { 200: ListResponse } } }, async (req) => {
    const { templateId, projectId, limit, cursor } = req.query;
    const where: Prisma.SmeAuthoredTaskWhereInput = { clientId: req.actor!.clientId, ...(templateId ? { templateId } : {}), ...(projectId ? { projectId } : {}) };
    if (cursor && !(await db.smeAuthoredTask.findFirst({ where: { id: cursor, clientId: req.actor!.clientId } }))) throw new AppError(400, 'BAD_CURSOR', 'Unknown cursor');
    const rows = await db.smeAuthoredTask.findMany({
      where,
      include: authoredTaskInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return { items: page.map((t) => authoredTaskDto(t, true)), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
  });

  // Registered before `/studio-tasks/:id`; the id is a UUID, so "export" can never match it anyway.
  app.get('/studio-tasks/export', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'] } }, async (req, reply) => {
    const clientId = req.actor!.clientId;
    const total = await db.smeAuthoredTask.count({ where: { clientId } });
    const exportedAt = new Date().toISOString();
    await auditRead(db, req, { entityType: 'Client', entityId: clientId, action: 'studio_task.store_exported', after: { count: total, exportedAt } });
    // Streams in pages (keyset on createdAt, id), so a large store never sits in memory.
    async function* body() {
      yield `{"schema":"praxis.studio-tasks.export.v1","exportedAt":${JSON.stringify(exportedAt)},"items":[`;
      let after: { createdAt: Date; id: string } | null = null;
      let first = true;
      for (;;) {
        const rows: AuthoredTaskRow[] = await db.smeAuthoredTask.findMany({
          where: { clientId, ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}) },
          include: authoredTaskInclude,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: EXPORT_BATCH,
        });
        for (const t of rows) {
          yield `${first ? '' : ','}${JSON.stringify(detail(t))}`;
          first = false;
        }
        if (rows.length < EXPORT_BATCH) break;
        const last = rows[rows.length - 1]!;
        after = { createdAt: last.createdAt, id: last.id };
      }
      yield ']}\n';
    }
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="studio-tasks-${exportedAt.slice(0, 10)}.json"`)
      .send(Readable.from(body()));
  });

  app.get('/studio-tasks/:id', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, response: { 200: DetailResponse } } }, async (req) => {
    const t = await db.smeAuthoredTask.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: authoredTaskInclude });
    if (!t) throw notFound('Task not found');
    return detail(t);
  });

  app.get('/studio-tasks/:id/bundle', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams } }, async (req, reply) => {
    const t = await db.smeAuthoredTask.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!t) throw notFound('Task not found');
    const bytes = await storage.get(t.bundleRef).catch(() => {
      throw new AppError(404, 'BUNDLE_MISSING', 'The bundle for this task is not in storage.');
    });
    if (createHash('sha256').update(bytes).digest('hex') !== t.bundleSha256) throw new AppError(409, 'BUNDLE_MISMATCH', 'The stored bundle does not match its recorded SHA-256.');
    await auditRead(db, req, { entityType: 'SmeAuthoredTask', entityId: t.id, action: 'studio_task.bundle_downloaded', after: { externalTaskId: t.externalTaskId, bundleSha256: t.bundleSha256 } });
    return reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="${t.externalTaskId.replace(/[^A-Za-z0-9_-]/g, '_')}.tar.gz"`)
      .header('x-bundle-sha256', t.bundleSha256)
      .send(bytes);
  });
};
