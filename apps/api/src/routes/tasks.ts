import '@fastify/multipart';
import type { Prisma } from '@prisma/client';
import { ReclaimRequest, TASK_STATUSES } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import type { EmailSender } from '../lib/email';
import { newToken, sha256 } from '../lib/crypto';
import { AppError, badRequest, notFound } from '../lib/errors';
import { runCommand, runStaffOrServiceCommand } from '../platform/command';
import { definitionFor } from '../tasks/definitions';
import { createInvite, sendInvite } from '../tasks/invites';
import { reclaimTask, templateRef } from '../tasks/task-service';
import { loadProject } from './projects';

const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;
const MAX_INPUTS_PER_BATCH = 5000;

/** Minimal RFC 4180 CSV: a header row, quoted fields with "" escapes. Each row becomes an object. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

async function projectFor(tx: Db | Tx, id: string, actor: { type: string; clientId: string } & Record<string, unknown>) {
  if (actor.type === 'USER') return loadProject(tx, id, actor as never);
  const p = await tx.project.findFirst({ where: { id, clientId: actor.clientId }, include: { template: true } });
  if (!p) throw notFound('Project not found');
  return p;
}

/** FLOW 3 for PMs: task list and reclaim, invites (resend, revoke), and annotation inputs (upload or client API). */
export const taskRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; email: EmailSender }> = async (app, { db, config, email }) => {
  app.get(
    '/projects/:id/tasks',
    { config: { access: ACCESS }, schema: { tags: ['tasks'], params: IdParams, querystring: z.object({ status: z.enum(TASK_STATUSES).optional() }) } },
    async (req) => {
      const p = await loadProject(db, req.params.id, req.actor!);
      const tasks = await db.taskInstance.findMany({
        where: { projectId: p.id, ...(req.query.status ? { status: req.query.status } : {}) },
        include: { assignedTo: { include: { smeUser: true } } },
        orderBy: [{ status: 'asc' }, { assignedAt: 'asc' }],
        take: 2000,
      });
      return {
        tptMinutes: p.tptMinutes,
        items: tasks.map((t) => ({
          id: t.id,
          status: t.status,
          taskType: t.taskType,
          brief: (t.input as { slot?: { brief?: string } }).slot?.brief ?? null,
          author: t.assignedTo?.smeUser?.displayName ?? null,
          assignedAt: t.assignedAt?.toISOString() ?? null,
          lastSavedAt: t.lastSavedAt?.toISOString() ?? null,
          submittedAt: t.submittedAt?.toISOString() ?? null,
          activeSeconds: t.activeSeconds,
          reworkCount: t.reworkCount,
          revision: t.revision,
        })),
      };
    },
  );

  app.post(
    '/projects/:id/tasks/:taskId/reclaim',
    { config: { access: ACCESS }, schema: { tags: ['tasks'], params: IdParams.extend({ taskId: z.string().uuid() }), body: ReclaimRequest } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        await reclaimTask(tx, { projectId: p.id, taskId: req.params.taskId, reason: req.body.reason, note: req.body.note }, audit);
        await emit({ name: 'task.reclaimed', aggregateType: 'TaskInstance', aggregateId: req.params.taskId, payload: { taskId: req.params.taskId, projectId: p.id } });
        return { status: 200, body: { status: 'CREATED' } };
      });
      return reply;
    },
  );

  // ── Invites ──
  app.get('/projects/:id/invites', { config: { access: ACCESS }, schema: { tags: ['tasks'], params: IdParams } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const invites = await db.invite.findMany({ where: { projectAssignment: { projectId: p.id } }, include: { projectAssignment: { include: { candidate: { include: { smeUser: true } } } } }, orderBy: { createdAt: 'desc' } });
    const now = new Date();
    return {
      items: invites.map((i) => ({
        id: i.id,
        candidateName: i.projectAssignment.candidate.smeUser?.displayName ?? null,
        channel: i.channel,
        sentAt: i.sentAt?.toISOString() ?? null,
        expiresAt: i.expiresAt.toISOString(),
        usedAt: i.usedAt?.toISOString() ?? null,
        state: i.revoked ? 'REVOKED' : i.usedAt ? 'USED' : i.expiresAt <= now ? 'EXPIRED' : i.sentAt ? 'SENT' : 'PENDING',
      })),
    };
  });

  const inviteParams = IdParams.extend({ inviteId: z.string().uuid() });
  const findInvite = async (tx: Tx, projectId: string, inviteId: string) => {
    const i = await tx.invite.findFirst({ where: { id: inviteId, projectAssignment: { projectId } }, include: { projectAssignment: true } });
    if (!i) throw notFound('Invite not found');
    return i;
  };

  app.post('/projects/:id/invites/:inviteId/revoke', { config: { access: ACCESS }, schema: { tags: ['tasks'], params: inviteParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const i = await findInvite(tx, p.id, req.params.inviteId);
      if (i.revoked) throw new AppError(409, 'ALREADY_REVOKED', 'This invite was already revoked.');
      await tx.invite.update({ where: { id: i.id }, data: { revoked: true } });
      await audit({ entityType: 'Invite', entityId: i.id, action: 'invite.revoked' });
      return { status: 200, body: { revoked: true } };
    });
    return reply;
  });

  // Resend = revoke the old link and send a new one (the old token cannot be re-sent; only its hash is kept).
  app.post('/projects/:id/invites/:inviteId/resend', { config: { access: ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['tasks'], params: inviteParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const old = await findInvite(tx, p.id, req.params.inviteId);
      if (old.projectAssignment.releasedAt) throw new AppError(409, 'NOT_ASSIGNED', 'This expert is no longer assigned to the project.');
      if (!old.revoked) await tx.invite.update({ where: { id: old.id }, data: { revoked: true } });
      const { invite, token } = await createInvite(tx, { clientId: p.clientId, projectAssignmentId: old.projectAssignmentId }, audit);
      await sendInvite(tx, email, config, invite.id, token);
      await audit({ entityType: 'Invite', entityId: invite.id, action: 'invite.resent', after: { replaces: old.id } });
      return { status: 200, body: { id: invite.id } };
    });
    return reply;
  });

  // ── Annotation inputs: PM upload (JSON or CSV) and client API push, validated against the template ──
  app.post(
    '/projects/:id/task-inputs',
    { config: { access: { roles: ACCESS, apiClient: 'CLIENT_API' }, rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['tasks'], params: IdParams } },
    async (req, reply) => {
      let items: unknown[];
      if (req.isMultipart()) {
        if (!req.actor) throw badRequest('File upload is for signed-in PMs; API clients send JSON.');
        const file = await req.file();
        if (!file) throw badRequest('Choose a CSV or JSON file.');
        const text = (await file.toBuffer()).toString('utf8');
        if (/\.csv$/i.test(file.filename) || file.mimetype === 'text/csv') items = parseCsv(text);
        else {
          try {
            const parsed = JSON.parse(text) as unknown;
            items = Array.isArray(parsed) ? parsed : ((parsed as { items?: unknown[] }).items ?? []);
          } catch {
            throw badRequest('The file is not valid JSON.');
          }
        }
      } else {
        const body = z.object({ items: z.array(z.unknown()).min(1).max(MAX_INPUTS_PER_BATCH) }).safeParse(req.body);
        if (!body.success) throw badRequest('Send { "items": [ ... ] } with 1 to 5000 inputs.');
        items = body.data.items;
      }
      if (items.length === 0 || items.length > MAX_INPUTS_PER_BATCH) throw badRequest(`A batch needs 1 to ${MAX_INPUTS_PER_BATCH} inputs.`);

      await runStaffOrServiceCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await projectFor(tx, req.params.id, actor as never);
        if (p.taskMode !== 'ANNOTATION') throw new AppError(409, 'NOT_ANNOTATION', 'Inputs are for annotation projects; authoring projects use coverage slots.');
        if (['DRAFT', 'CANCELLED', 'COMPLETED'].includes(p.status)) throw new AppError(409, 'PROJECT_NOT_OPEN', `A ${p.status.toLowerCase()} project cannot take inputs.`);
        const template = await templateRef(tx, p.templateId);
        const def = definitionFor(template);
        const problems = items.flatMap((it, i) => def.validateTaskInput(template, it).map((m) => `Item ${i + 1}: ${m}`));
        if (problems.length) throw new AppError(422, 'INVALID_INPUTS', `${problems.length} input(s) failed validation; nothing was added.`, { problems: problems.slice(0, 50) });
        const existing = await tx.taskInstance.count({ where: { projectId: p.id, taskType: 'ANNOTATION' } });
        if (p.taskCount && existing + items.length > p.taskCount) {
          throw new AppError(409, 'OVER_TASK_COUNT', `This project needs ${p.taskCount} tasks; it has ${existing}, so at most ${p.taskCount - existing} more can be added.`);
        }
        const isUser = actor.type === 'USER';
        const batch = await tx.taskInputBatch.create({
          data: { clientId: p.clientId, projectId: p.id, source: isUser ? 'UPLOAD' : 'API', uploadedById: isUser ? (actor as { userId: string }).userId : null, apiClientId: isUser ? null : (actor as { apiClientId: string }).apiClientId, itemCount: items.length },
        });
        await tx.taskInstance.createMany({ data: items.map((input) => ({ clientId: p.clientId, projectId: p.id, taskType: 'ANNOTATION' as const, inputBatchId: batch.id, input: input as Prisma.InputJsonValue })) });
        await audit({ entityType: 'TaskInputBatch', entityId: batch.id, action: 'task_inputs.added', after: { projectId: p.id, source: batch.source, items: items.length } });
        return { status: 201, body: { batchId: batch.id, added: items.length, total: existing + items.length } };
      });
      return reply;
    },
  );

  // ── API clients (Admin): keys are shown once and stored as hashes ──
  app.get('/api-clients', { config: { access: ['ADMIN'] }, schema: { tags: ['admin'] } }, async (req) => {
    const rows = await db.apiClient.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, createdAt: c.createdAt.toISOString(), revokedAt: c.revokedAt?.toISOString() ?? null })) };
  });
  app.post(
    '/api-clients',
    { config: { access: ['ADMIN'] }, schema: { tags: ['admin'], body: z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(['CLIENT_API', 'RL_GYM']) }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const key = `pk_${newToken()}`;
        const c = await tx.apiClient.create({ data: { clientId: actor.clientId, name: req.body.name, kind: req.body.kind, keyHash: sha256(key) } });
        await audit({ entityType: 'ApiClient', entityId: c.id, action: 'api_client.created', after: { name: c.name, kind: c.kind } });
        // The key is returned once and never stored; a replay of this request does not return it again.
        return { status: 201, body: { id: c.id, name: c.name, kind: c.kind, key }, replayBody: { id: c.id, name: c.name, kind: c.kind, key: null } };
      });
      return reply;
    },
  );
  app.post('/api-clients/:id/revoke', { config: { access: ['ADMIN'] }, schema: { tags: ['admin'], params: IdParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await tx.apiClient.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!c) throw notFound('API client not found');
      if (c.revokedAt) throw new AppError(409, 'ALREADY_REVOKED', 'This key was already revoked.');
      await tx.apiClient.update({ where: { id: c.id }, data: { revokedAt: new Date() } });
      await audit({ entityType: 'ApiClient', entityId: c.id, action: 'api_client.revoked' });
      return { status: 200, body: { revoked: true } };
    });
    return reply;
  });
};
