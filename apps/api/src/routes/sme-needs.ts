import type { Prisma, SmeNeed, SmeNeedClosure, SmeNeedSend } from '@prisma/client';
import { CloseNeedRequest, holdsExport, NeedDto, RaiseNeedRequest, SendNeedsRequest, StaffNeedRequest, type NeedKind, type NeedState } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { jcsSha256 } from '../anvil/jcs';
import { rlgymProjectId, rlgymTemplateRef } from '../anvil/rlgym-export';
import type { StudioClient, StudioResult } from '../anvil/studio-client';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand, runCommand, runCommandPrepared } from '../platform/command';
import { reviewableProject } from './benchmark-review';
import { loadProject } from './projects';
import { ownTask } from './work';

const STAFF = ['ADMIN', 'PM', 'REVIEWER'] as const;
const PM = ['ADMIN', 'PM'] as const;
const Params = z.object({ id: z.string().uuid() });

/**
 * SME needs (new RL Gym part 4; docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.3). Authors send a need to
 * the PM from the task page (the only addition to the author screens); Reviewers and the PM can raise needs in the
 * console. The PM sends open needs of one kind to Studio's inbox as one item, rejects them, or marks them resolved.
 * A task with an open or sent "new kind of case" need is held back from export until the PM resolves or rejects it.
 */

/** Each need's state from its closure and the sends that included it. */
function states(needs: SmeNeed[], closures: SmeNeedClosure[], sends: SmeNeedSend[]) {
  const closed = new Map(closures.map((c) => [c.needId, c]));
  return needs.map((n) => {
    const mine = sends.filter((s) => s.needIds.includes(n.id)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const received = mine.filter((s) => s.outcome === 'received').at(-1);
    const last = mine.at(-1);
    const c = closed.get(n.id);
    const state: NeedState = c ? (c.kind === 'REJECTED' ? 'rejected' : 'resolved') : received ? 'sent' : 'open';
    return { need: n, state, studioItemId: received?.studioItemId ?? null, closedReason: c?.reason ?? null, lastError: last && last.outcome !== 'received' && !received ? ((last.error as { code: string; message: string } | null) ?? null) : null };
  });
}

async function projectNeeds(db: Db | Tx, clientId: string, projectId: string, where: Prisma.SmeNeedWhereInput = {}) {
  const needs = await db.smeNeed.findMany({ where: { clientId, projectId, ...where }, orderBy: { createdAt: 'desc' } });
  const ids = needs.map((n) => n.id);
  const [closures, sends] = await Promise.all([db.smeNeedClosure.findMany({ where: { needId: { in: ids } } }), db.smeNeedSend.findMany({ where: { projectId, needIds: { hasSome: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] } } })]);
  return states(needs, closures, sends);
}

/** For the export (part 2): the tasks held back because a "new kind of case" need about them is open or sent. */
export async function heldTasks(db: Db | Tx, clientId: string, projectId: string): Promise<Set<string>> {
  const rows = await projectNeeds(db, clientId, projectId, { kind: 'new_case_kind', taskId: { not: null } });
  return new Set(rows.filter((r) => holdsExport({ kind: r.need.kind as NeedKind, state: r.state, taskId: r.need.taskId })).map((r) => r.need.taskId!));
}

async function dto(db: Db | Tx, rows: Awaited<ReturnType<typeof projectNeeds>>): Promise<NeedDto[]> {
  const staff = rows.filter((r) => r.need.raisedByKind !== 'AUTHOR').map((r) => r.need.raisedById);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(staff)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.need.id,
    projectId: r.need.projectId,
    taskId: r.need.taskId,
    kind: r.need.kind as NeedKind,
    note: r.need.note,
    raisedBy: r.need.raisedByKind as 'AUTHOR' | 'REVIEWER' | 'PM',
    // An author is shown by role only in the console list; their task identifies them to the PM.
    raisedByName: r.need.raisedByKind === 'AUTHOR' ? null : (users.get(r.need.raisedById) ?? null),
    createdAt: r.need.createdAt.toISOString(),
    state: r.state,
    studioItemId: r.studioItemId,
    closedReason: r.closedReason,
    lastError: r.lastError,
  }));
}

export const smeNeedRoutes: FastifyPluginAsyncZod<{ db: Db; studio: StudioClient | null }> = async (app, { db, studio }) => {
  // ── Author (candidate app): send a need to the PM about my task ──
  app.post('/me/tasks/:id/needs', { config: { access: 'candidate' }, schema: { tags: ['work'], params: Params, body: RaiseNeedRequest, response: { 201: NeedDto } } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await ownTask(tx, req.params.id, actor.smeUserId);
      const n = await tx.smeNeed.create({ data: { clientId: t.clientId, projectId: t.projectId, taskId: t.id, kind: req.body.kind, note: req.body.note, raisedByKind: 'AUTHOR', raisedById: actor.smeUserId } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.need_raised', after: { needId: n.id, kind: n.kind, by: 'AUTHOR' } });
      return { status: 201, body: (await dto(tx, states([n], [], [])))[0]! };
    });
    return reply;
  });

  app.get('/me/tasks/:id/needs', { config: { access: 'candidate' }, schema: { tags: ['work'], params: Params, response: { 200: z.object({ items: z.array(NeedDto) }) } } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    return { items: await dto(db, await projectNeeds(db, t.clientId, t.projectId, { taskId: t.id, raisedByKind: 'AUTHOR', raisedById: req.candidate!.smeUserId })) };
  });

  // ── Console: raise and list a project's needs (Reviewers, the PM, Admins) ──
  app.post('/projects/:id/needs', { config: { access: STAFF }, schema: { tags: ['projects'], params: Params, body: StaffNeedRequest, response: { 201: NeedDto } } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await reviewableProject(tx, req.params.id, actor);
      if (req.body.taskId && !(await tx.taskInstance.findFirst({ where: { id: req.body.taskId, projectId: p.id } }))) throw notFound('Task not found in this project');
      const by = actor.roles.includes('ADMIN') || actor.roles.includes('PM') ? 'PM' : 'REVIEWER';
      const n = await tx.smeNeed.create({ data: { clientId: actor.clientId, projectId: p.id, taskId: req.body.taskId ?? null, kind: req.body.kind, note: req.body.note, raisedByKind: by, raisedById: actor.userId, ...(req.body.source ? { source: req.body.source } : {}) } });
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.need_raised', after: { needId: n.id, kind: n.kind, by, taskId: n.taskId, source: req.body.source ?? null } });
      return { status: 201, body: (await dto(tx, states([n], [], [])))[0]! };
    });
    return reply;
  });

  app.get('/projects/:id/needs', { config: { access: STAFF }, schema: { tags: ['projects'], params: Params, response: { 200: z.object({ items: z.array(NeedDto), connected: z.boolean() }) } } }, async (req) => {
    const p = await reviewableProject(db, req.params.id, req.actor!);
    return { connected: !!studio, items: await dto(db, await projectNeeds(db, req.actor!.clientId, p.id)) };
  });

  // ── PM: send open needs of one kind to Studio as one inbox item ──
  app.post('/projects/:id/needs/send', { config: { access: PM }, schema: { tags: ['projects'], params: Params, body: SendNeedsRequest, response: { 201: z.object({ items: z.array(NeedDto) }) } } }, async (req, reply) => {
    type Prep = { projectId: string; ids: string[]; kind: NeedKind; body: Record<string, unknown>; result: StudioResult };
    await runCommandPrepared<Prep, { items: NeedDto[] }>(
      db,
      req,
      reply,
      async (actor) => {
        const p = await loadProject(db, req.params.id, actor);
        if (!studio) throw new AppError(409, 'STUDIO_NOT_CONNECTED', 'Studio isn’t connected yet.');
        const rows = (await projectNeeds(db, actor.clientId, p.id)).filter((r) => req.body.needIds.includes(r.need.id));
        if (rows.length !== req.body.needIds.length) throw notFound('Need not found in this project');
        const notOpen = rows.filter((r) => r.state !== 'open');
        if (notOpen.length) throw new AppError(409, 'NEED_NOT_OPEN', 'Only open needs can be sent; some were already sent, rejected or resolved.', { needIds: notOpen.map((r) => r.need.id) });
        const kinds = new Set(rows.map((r) => r.need.kind));
        if (kinds.size !== 1) throw new AppError(422, 'NEED_KINDS_MIXED', 'Send needs of one kind together: More data and New edge case go to Studio as separate items.');
        const kind = rows[0]!.need.kind as NeedKind;
        const ref = await rlgymTemplateRef(db, p.template);
        // Exactly Studio's fields (it refuses unknown ones). Evidence carries no names or emails.
        const body = {
          kind,
          source: 'adi-forge',
          template_id: ref?.id ?? null,
          version: ref?.version ?? null,
          // The same project ID the RL Gym uses (prj_<hex>), so Studio, the RL Gym and ADI Forge name it alike.
          project_id: rlgymProjectId(p.id),
          summary: req.body.summary,
          evidence: rows.map((r) => ({ type: 'need', need_id: r.need.id, kind: r.need.kind, task_id: r.need.taskId, raised_by: r.need.raisedByKind.toLowerCase(), note: r.need.note })),
          needed_by: req.body.neededBy ?? null,
        };
        const ids = rows.map((r) => r.need.id).sort();
        return { projectId: p.id, ids, kind, body, result: await studio.sendInboxItem(body, `forge-needs-${jcsSha256({ ids, summary: req.body.summary, neededBy: req.body.neededBy ?? null }).slice(0, 32)}`) };
      },
      async ({ tx, actor, audit }, prep) => {
        const r = prep.result;
        const send = await tx.smeNeedSend.create({
          data: { clientId: actor.clientId, projectId: prep.projectId, needIds: prep.ids, kind: prep.kind, body: prep.body as Prisma.InputJsonValue, outcome: r.ok ? 'received' : r.kind, studioItemId: r.ok ? r.itemId : null, httpStatus: r.httpStatus, ...(r.ok ? {} : { error: { code: r.code, message: r.message } as Prisma.InputJsonValue }), requestedById: actor.userId },
        });
        await audit({ entityType: 'Project', entityId: prep.projectId, action: 'project.needs_sent_to_studio', after: { sendId: send.id, needIds: prep.ids, kind: prep.kind, outcome: send.outcome, studioItemId: send.studioItemId } });
        return { status: 201, body: { items: await dto(tx, await projectNeeds(tx, actor.clientId, prep.projectId, { id: { in: prep.ids } })) } };
      },
    );
    return reply;
  });

  // ── PM: reject an open need, or mark a need resolved (lifts an export hold) ──
  for (const [path, kind] of [
    ['reject', 'REJECTED'],
    ['resolve', 'RESOLVED'],
  ] as const) {
    app.post(`/projects/:id/needs/:needId/${path}`, { config: { access: PM }, schema: { tags: ['projects'], params: Params.extend({ needId: z.string().uuid() }), body: CloseNeedRequest, response: { 201: NeedDto } } }, async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        const [row] = await projectNeeds(tx, actor.clientId, p.id, { id: req.params.needId });
        if (!row) throw notFound('Need not found in this project');
        if (row.state === 'rejected' || row.state === 'resolved') throw new AppError(409, 'NEED_CLOSED', 'This need is already closed.');
        if (kind === 'REJECTED' && row.state !== 'open') throw new AppError(409, 'NEED_SENT', 'A need already sent to Studio cannot be rejected; mark it resolved instead.');
        await tx.smeNeedClosure.create({ data: { clientId: actor.clientId, needId: row.need.id, kind, reason: req.body.reason, closedById: actor.userId } });
        await audit({ entityType: 'Project', entityId: p.id, action: kind === 'REJECTED' ? 'project.need_rejected' : 'project.need_resolved', after: { needId: row.need.id } });
        const [updated] = await projectNeeds(tx, actor.clientId, p.id, { id: row.need.id });
        return { status: 201, body: (await dto(tx, [updated!]))[0]! };
      });
      return reply;
    });
  }
};
