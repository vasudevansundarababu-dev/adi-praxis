import type { ApprovedTaskRecord, Prisma, RlGymProjectExport } from '@prisma/client';
import { exportEligibility, ProjectExportRunDto, ProjectExportStateDto, type TaskCheck } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import { runCommandPrepared } from '../platform/command';
import { buildRlGymExport, rlgymTemplateRef, titleOf, type BuiltExport } from '../anvil/rlgym-export';
import { rlGymConnected, type RlGymClient, type RlGymResult } from '../anvil/rlgym-client';
import { loadProject } from './projects';
import { correctionBatches } from './benchmark-review';
import { revalidateTask, reworkForValidation } from '../tasks/revalidation';

const Params = z.object({ id: z.string().uuid() });
const ACCESS = ['ADMIN', 'PM'] as const;

/**
 * The project's approved tasks as they stand: a corrected record is replaced by its correction. D18: a task sent back
 * to Rework after approval keeps its earlier record (append-only) but is not exported until it is approved again, and
 * then only its latest record is.
 */
async function currentRecords(tx: Db | Tx, clientId: string, projectId: string) {
  const rows = await tx.approvedTaskRecord.findMany({ where: { clientId, projectId }, orderBy: { seq: 'asc' } });
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  const accepted = new Set((await tx.taskInstance.findMany({ where: { clientId, projectId, id: { in: [...new Set(rows.map((r) => r.taskInstanceId))] }, status: 'ACCEPTED' }, select: { id: true } })).map((t) => t.id));
  const latest = new Map<string, string>();
  for (const r of rows) if (!superseded.has(r.id)) latest.set(r.taskInstanceId, r.id);
  return rows.filter((r) => !superseded.has(r.id) && accepted.has(r.taskInstanceId) && latest.get(r.taskInstanceId) === r.id);
}

/** D18, read-only: the approved tasks whose approved content now fails the submit or package checks. */
async function failingTasks(db: Db, records: ApprovedTaskRecord[]) {
  const tasks = await db.taskInstance.findMany({ where: { id: { in: records.map((r) => r.taskInstanceId) } }, include: { project: { include: { template: true } }, submissions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } } });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: { recordId: string; taskId: string; title: string; checks: TaskCheck[]; allChecks: TaskCheck[]; version: number }[] = [];
  for (const r of records) {
    const t = byId.get(r.taskInstanceId);
    if (!t || t.status !== 'ACCEPTED') continue;
    const rv = await revalidateTask(db as unknown as Tx, t, r.output, r);
    if (rv.failing.length) out.push({ recordId: r.id, taskId: t.id, title: titleOf(r), checks: rv.failing, allChecks: rv.checks, version: t.submissions[0]?.version ?? 1 });
  }
  return out;
}

/** "In RL Gym": the task's latest record was sent in an export the RL Gym received and did not block. */
function inRlGym(runs: RlGymProjectExport[]): Set<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    if (run.outcome !== 'received') continue;
    const blocked = new Set(((run.receipt as { blocked?: { taskId: string }[] } | null)?.blocked ?? []).map((b) => b.taskId));
    for (const t of run.tasks as { recordId: string; taskId: string }[]) if (!blocked.has(t.taskId)) ids.add(t.recordId);
  }
  return ids;
}

function runDto(r: RlGymProjectExport): ProjectExportRunDto {
  return ProjectExportRunDto.parse({
    id: r.id,
    projectId: r.projectId,
    exportId: r.exportId,
    exportSha256: r.exportSha256,
    reason: r.reason,
    tasks: r.tasks,
    notSent: r.notSent,
    outcome: r.outcome,
    httpStatus: r.httpStatus,
    requestId: r.requestId,
    receipt: r.receipt ?? null,
    error: r.error ?? null,
    requestedById: r.requestedById,
    createdAt: r.createdAt.toISOString(),
  });
}

/** The RL Gym's receipt as stored: its counts, blocked tasks and whether it replayed an earlier receipt. */
function receiptOf(data: Record<string, unknown>) {
  const n = (v: unknown) => (Number.isInteger(v) ? (v as number) : 0);
  const blocked = (Array.isArray(data.blocked) ? data.blocked : []).flatMap((b) => (b && typeof b === 'object' && typeof (b as { task_id?: unknown }).task_id === 'string' ? [{ taskId: (b as { task_id: string }).task_id, reason: String((b as { reason?: unknown }).reason ?? 'blocked') }] : []));
  return { new: n(data.new), superseding: n(data.superseding), unchanged: n(data.unchanged), blocked, replayed: data.replayed === true, receiptSha256: typeof data.receipt_sha256 === 'string' ? data.receipt_sha256 : null };
}

type Prepared =
  | { kind: 'rework'; projectId: string; failing: Awaited<ReturnType<typeof failingTasks>> }
  | { kind: 'sent'; projectId: string; built: BuiltExport; result: RlGymResult };

/**
 * New RL Gym project export (docs/design/FORGE-RLGYM-V2-DESIGN.md part 2; AUTHORING-SNAPSHOT §3.2 a). The owning PM or
 * an Admin presses Export for benchmark, later Re-export. ADI Forge sends the approved tasks so far; the RL Gym fetches
 * their packages by hash and answers with a receipt, which is kept with the run (append-only). The old per-task
 * validate/resolve path to the decommissioned RL Gym is removed (owner, 22 Nov 2026).
 */
export const projectExportRoutes: FastifyPluginAsyncZod<{ db: Db; rlgym: RlGymClient | null }> = async (app, { db, rlgym }) => {
  const connected = !!rlgym;

  async function state(clientId: string, p: { id: string; status: string; template: Parameters<typeof rlgymTemplateRef>[1] }) {
    const records = await currentRecords(db, clientId, p.id);
    const ref = await rlgymTemplateRef(db, p.template);
    const e = exportEligibility({ status: p.status, approvedTasks: records.length, connected, qualified: !!ref });
    const runs = await db.rlGymProjectExport.findMany({ where: { clientId, projectId: p.id }, orderBy: { createdAt: 'desc' } });
    return { records, ref, e, runs };
  }

  app.get('/projects/:id/export', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Params, response: { 200: ProjectExportStateDto } } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const s = await state(req.actor!.clientId, p);
    const sent = inRlGym(s.runs);
    const packages = new Map((await db.authoredTaskPackage.findMany({ where: { recordId: { in: s.records.map((r) => r.id) } }, select: { recordId: true, revision: true } })).map((x) => [x.recordId, x.revision]));
    return {
      canExport: s.e.canExport,
      reason: s.e.reason,
      connected,
      rlgymTemplate: s.ref,
      exported: s.runs.some((r) => r.outcome === 'received'),
      tasks: s.records.map((r) => ({ recordId: r.id, taskId: r.taskInstanceId, title: titleOf(r), approvedAt: r.reviewDecisionAt.toISOString(), revision: packages.get(r.id) ?? 1, inRlGym: sent.has(r.id) })),
      runs: s.runs.slice(0, 20).map(runDto),
    };
  });

  app.post('/projects/:id/exports', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Params, body: z.object({}).strict(), response: { 201: ProjectExportRunDto } } }, async (req, reply) => {
    await runCommandPrepared<Prepared, ProjectExportRunDto>(
      db,
      req,
      reply,
      // Outside the transaction: check, store the packages (committed, so the RL Gym can fetch them), then call the RL Gym.
      async (actor) => {
        const p = await loadProject(db, req.params.id, actor);
        const s = await state(actor.clientId, p);
        if (!s.e.canExport || !s.ref || !rlgym) throw new AppError(409, 'NOT_EXPORTABLE', s.e.reason ?? 'The project cannot be exported yet.');
        // D18: re-check every approved task first; if any fail, they go back to Rework and nothing is sent.
        const failing = await failingTasks(db, s.records);
        if (failing.length) return { kind: 'rework', projectId: p.id, failing };
        const corrections = await correctionBatches(db, p.id);
        const built = await db.$transaction((tx) => buildRlGymExport(tx, { id: p.id, name: p.name, template: p.template }, s.records, s.ref!, { exported: s.runs.some((r) => r.outcome === 'received'), corrections }));
        if (!built.tasks.length) throw new AppError(422, 'NOTHING_TO_EXPORT', 'None of the approved tasks can be sent.', { notSent: built.notSent });
        const result = await rlgym.exportProject(p.id, built.body, built.exportSha256);
        return { kind: 'sent', projectId: p.id, built, result };
      },
      async ({ tx, actor, audit }, prep) => {
        if (prep.kind === 'rework') {
          const tasks = await tx.taskInstance.findMany({ where: { id: { in: prep.failing.map((f) => f.taskId) } }, include: { project: { include: { template: true } } } });
          for (const f of prep.failing) {
            const t = tasks.find((x) => x.id === f.taskId);
            if (!t || t.status !== 'ACCEPTED') continue;
            await reworkForValidation(tx, t, { trigger: 'export', actorId: actor.userId, byUser: true, version: f.version, checks: f.allChecks, failing: f.checks, recordId: f.recordId }, audit);
          }
          await audit({ entityType: 'Project', entityId: prep.projectId, action: 'project.export_blocked', after: { reworked: prep.failing.map((x) => ({ taskId: x.taskId, recordId: x.recordId, failingChecks: x.checks.map((c) => c.id) })) } });
          const n = prep.failing.length;
          const problems = prep.failing.flatMap((x) => x.checks.map((c) => `${x.title} · ${c.section}: ${c.message}`));
          return { status: 422, body: { error: 'EXPORT_BLOCKED_REWORK', message: `Export blocked: ${n} approved task${n === 1 ? '' : 's'} now fail${n === 1 ? 's' : ''} validation and went back to the author for rework. Export again once ${n === 1 ? 'it is' : 'they are'} approved.`, details: { tasks: prep.failing.map(({ allChecks: _a, version: _v, ...x }) => x), problems } } as unknown as ProjectExportRunDto };
        }
        const { built, result } = prep;
        const run = await tx.rlGymProjectExport.create({
          data: {
            clientId: actor.clientId,
            projectId: prep.projectId,
            exportId: built.exportId,
            exportSha256: built.exportSha256,
            reason: built.reason,
            body: built.body as Prisma.InputJsonValue,
            tasks: built.tasks as unknown as Prisma.InputJsonValue,
            notSent: built.notSent as unknown as Prisma.InputJsonValue,
            outcome: result.ok ? 'received' : result.kind,
            httpStatus: result.httpStatus,
            requestId: result.requestId,
            ...(result.ok ? { receipt: receiptOf(result.data) as Prisma.InputJsonValue } : { error: { code: result.code, message: result.message } as Prisma.InputJsonValue }),
            requestedById: actor.userId,
          },
        });
        await audit({ entityType: 'Project', entityId: prep.projectId, action: 'project.exported_to_rlgym', after: { runId: run.id, exportId: run.exportId, exportSha256: run.exportSha256, outcome: run.outcome, tasks: built.tasks.length, notSent: built.notSent.length, requestId: run.requestId, ...(result.ok ? { receipt: receiptOf(result.data) } : { error: result.code }) } });
        return { status: 201, body: runDto(run) };
      },
    );
    return reply;
  });
};
