import { benchmarkInputProblems, RaiseNeedRequest, SaveTaskBenchmarkRequest, type TemplateVerifiers } from '@praxis/shared';
import type { ApprovedTaskRecord, Prisma, RlGymProjectExport, SmeNeed, Template } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand, runCommand, runCommandPrepared, runStaffOrServiceCommand } from '../platform/command';
import { templateBenchmark, taskBenchmarkOf } from '../anvil/benchmark';
import { buildRlGymExport, rlgymTemplateRef, titleOf, type BuiltExport } from '../anvil/rlgym-export';
import type { RlGymClient, RlGymResult } from '../anvil/rlgym-client';
import type { StudioClient, StudioResult, InboxItemBody } from '../anvil/studio-client';
import { jcsSha256 } from '../anvil/jcs';
import { loadProject } from './projects';
import { ownTask } from './work';

/**
 * Authoring's side of Studio's edge cases and verifiers and of the new RL Gym (adi-labs-design
 * praxis/AUTHORING-SPEC-EDGE-CASES-VERIFIERS-BRANDING.md; AUTHORING-SNAPSHOT 3.1-3.3):
 * - SMEs pick an edge case to focus on, fill expected results (sme templates) and raise needs;
 * - the PM merges, sends needs to Studio's inbox, or rejects them;
 * - the PM exports and re-exports the project to the RL Gym;
 * - the RL Gym sends SME review batches; the project's Reviewers and PM decide, and decisions go back.
 * Authoring never runs a check and AI never decides: every decision here is a person's.
 */

const ANVIL = { roles: [] as const, apiClient: 'ANVIL' as const };
const PM = ['ADMIN', 'PM'] as const;
const STAFF_REVIEW = ['ADMIN', 'PM', 'REVIEWER'] as const;
const Id = z.object({ id: z.string().uuid() });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What reviewers see of a template version's verifiers: everything in the view (case-reference paths are never in it). */
const checksView = (v: TemplateVerifiers | null) => v && { expectedValuesFrom: v.expectedValuesFrom, failureTaxonomy: v.failureTaxonomy, blocks: v.blocks, slots: v.slots };

/** What an SME author sees: never the blocks (Private · rubric), only the fields they fill. */
const authorView = (t: Template) => {
  const b = templateBenchmark(t);
  const sme = b.verifiers?.expectedValuesFrom === 'sme';
  return { edgeCases: b.edgeCases, sliceLists: b.sliceLists, expectedValuesFrom: b.verifiers?.expectedValuesFrom ?? null, slots: sme ? b.verifiers!.slots : [], allowedChecks: sme ? b.verifiers!.allowedChecks : [] };
};

/** The project's approved tasks as they stand (a corrected record replaced by its correction; Rework holds a task back). */
export async function currentRecords(tx: Db | Tx, clientId: string, projectId: string) {
  const rows = await tx.approvedTaskRecord.findMany({ where: { clientId, projectId }, orderBy: { seq: 'asc' } });
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  const accepted = new Set((await tx.taskInstance.findMany({ where: { clientId, projectId, id: { in: [...new Set(rows.map((r) => r.taskInstanceId))] }, status: 'ACCEPTED' }, select: { id: true } })).map((t) => t.id));
  const latest = new Map<string, string>();
  for (const r of rows) if (!superseded.has(r.id)) latest.set(r.taskInstanceId, r.id);
  return rows.filter((r) => !superseded.has(r.id) && accepted.has(r.taskInstanceId) && latest.get(r.taskInstanceId) === r.id);
}

/** Tasks held from export: linked to a `new_case_kind` need sent to Studio for this template version and not declined. */
async function heldTasks(tx: Db | Tx, projectId: string, templateId: string) {
  const needs = await tx.smeNeed.findMany({ where: { projectId, templateId, kind: 'new_case_kind', state: { in: ['sent', 'merged'] } } });
  const byId = new Map(needs.map((n) => [n.id, n]));
  const held = new Map<string, string>();
  for (const n of needs) {
    const root = n.state === 'merged' && n.mergedIntoId ? byId.get(n.mergedIntoId) : n;
    if (root?.state === 'sent' && root.studioItemId && root.studioState !== 'declined') held.set(n.taskInstanceId, root.studioItemId);
  }
  return held;
}

/** The review batch whose `task_correction` reopened each task (its latest such decision). */
async function correctionBatches(tx: Db | Tx, clientId: string, taskIds: string[]) {
  const rows = await tx.runReviewDecision.findMany({ where: { clientId, decision: 'task_correction', reworkTaskId: { in: taskIds } }, orderBy: { createdAt: 'asc' }, include: { batch: { select: { batchId: true } } } });
  return new Map(rows.map((r) => [r.reworkTaskId!, r.batch.batchId]));
}

function inRlGym(runs: RlGymProjectExport[]): Set<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    if (run.outcome !== 'received') continue;
    const blocked = new Set(((run.receipt as { blocked?: { taskId: string }[] } | null)?.blocked ?? []).map((b) => b.taskId));
    for (const t of run.tasks as { recordId: string; taskId: string }[]) if (!blocked.has(t.taskId)) ids.add(t.recordId);
  }
  return ids;
}

/** The RL Gym's receipt as stored: its counts, blocked tasks and whether it replayed an earlier receipt. */
function receiptOf(data: Record<string, unknown>) {
  const n = (v: unknown) => (Number.isInteger(v) ? (v as number) : 0);
  const blocked = (Array.isArray(data.blocked) ? data.blocked : []).flatMap((b) => (isObj(b) && typeof b.task_id === 'string' ? [{ taskId: b.task_id, reason: String(b.reason ?? 'blocked') }] : []));
  return { new: n(data.new), superseding: n(data.superseding), unchanged: n(data.unchanged), blocked, replayed: data.replayed === true, receiptSha256: typeof data.receipt_sha256 === 'string' ? data.receipt_sha256 : null };
}

const runDto = (r: RlGymProjectExport) => ({ id: r.id, exportId: r.exportId, exportSha256: r.exportSha256, reason: r.reason, tasks: r.tasks, notSent: r.notSent, outcome: r.outcome, httpStatus: r.httpStatus, requestId: r.requestId, receipt: r.receipt, error: r.error, createdAt: r.createdAt.toISOString() });

const needDto = (n: SmeNeed, title: string | null) => ({ id: n.id, taskId: n.taskInstanceId, taskTitle: title, kind: n.kind, content: n.content, state: n.state, mergedIntoId: n.mergedIntoId, rejectReason: n.rejectReason, summary: n.summary, studioItemId: n.studioItemId, studioState: n.studioState, sentAt: n.sentAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() });

/** Studio's evidence entry for one need (AUTHORING-SPEC 1.5). `raised_by` is an opaque pseudonym, never a name. */
function evidenceOf(n: SmeNeed): Record<string, unknown> {
  const c = (n.content ?? {}) as Record<string, unknown>;
  const raised = { task_id: n.taskInstanceId, raised_by: `sme-${n.raisedBySmeUserId.slice(0, 8)}` };
  if (n.kind === 'new_case_kind') return { context: c.context, twist: c.twist, expected_outcome: c.expectedOutcome, complexity: c.complexity, archetype: c.archetype, ...raised };
  return { tag: c.edgeCase, how_many: c.howMany, why: c.why, ...raised };
}

/** Studio's Template ID and version for a template version: the RL Gym names Studio's release in its qualification. */
async function studioTemplateRef(tx: Db | Tx, t: Template) {
  const ref = await rlgymTemplateRef(tx, t);
  if (ref) return { templateId: ref.id, version: ref.version };
  const req = (isObj(t.anvilSpec) && isObj(t.anvilSpec.requirement) ? t.anvilSpec.requirement : {}) as Record<string, unknown>;
  if (typeof req.studio_template_id === 'string' && Number.isInteger(req.studio_version)) return { templateId: req.studio_template_id, version: req.studio_version as number };
  return null;
}

const DECISIONS = ['agent_failure', 'task_correction', 'rubric_correction', 'grader_wrong', 'environment_wrong'] as const;
const DecisionsBody = z
  .object({
    decisions: z
      .array(z.object({ itemId: z.string().min(1).max(200), decision: z.enum(DECISIONS), rationale: z.string().trim().min(1).max(4000), criterionId: z.string().min(1).max(100).optional() }).strict())
      .min(1)
      .max(200),
  })
  .strict();

/** The episodes of a batch, as reviewers decide them: one item per episode (item_id, or episode_id when no item_id). */
function batchItems(body: unknown) {
  const out: { itemId: string; taskId: string; revision: number; episode: Record<string, unknown> }[] = [];
  for (const t of (isObj(body) && Array.isArray(body.tasks) ? body.tasks : []).filter(isObj))
    for (const e of (Array.isArray(t.episodes) ? t.episodes : []).filter(isObj)) {
      const itemId = typeof e.item_id === 'string' && e.item_id ? e.item_id : typeof e.episode_id === 'string' ? e.episode_id : '';
      if (itemId) out.push({ itemId, taskId: String(t.task_id ?? ''), revision: Number(t.revision ?? 1), episode: e });
    }
  return out;
}

export const benchmarkRoutes: FastifyPluginAsyncZod<{ db: Db; rlgym: RlGymClient | null; studio: StudioClient | null }> = async (app, { db, rlgym, studio }) => {
  // ── Templates → version detail: edge cases and read-only checks (spec 1.4, 2.3) ──
  app.get('/templates/:id/benchmark', { config: { access: STAFF_REVIEW }, schema: { tags: ['templates'], params: Id } }, async (req) => {
    const t = await db.template.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!t) throw notFound('Template not found');
    const b = templateBenchmark(t);
    const studioRef = await studioTemplateRef(db, t);
    return { edgeCases: b.edgeCases, sliceLists: b.sliceLists, checks: checksView(b.verifiers), studioTemplate: studioRef };
  });

  // ── Tasks → Author: the SME's benchmark fields ──
  app.get('/me/tasks/:id/benchmark', { config: { access: 'candidate' }, schema: { tags: ['work'], params: Id } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const needs = await db.smeNeed.findMany({ where: { taskInstanceId: t.id, raisedBySmeUserId: req.candidate!.smeUserId }, orderBy: { createdAt: 'desc' } });
    const editable = ['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status);
    return { ...authorView(t.project.template), value: taskBenchmarkOf(t.benchmark), editable, needs: needs.map((n) => needDto(n, null)) };
  });

  app.put('/me/tasks/:id/benchmark', { config: { access: 'candidate', rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: Id, body: SaveTaskBenchmarkRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const t = await ownTask(tx, req.params.id, actor.smeUserId);
      if (t.taskType !== 'AUTHORING') throw new AppError(409, 'NOT_AUTHORING', 'Only authoring tasks take benchmark fields.');
      // Locked from submission until the next approval, so the approved package carries what the reviewer saw.
      if (!['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) throw new AppError(409, 'READ_ONLY', 'This task is read-only now.');
      const current = taskBenchmarkOf(t.benchmark);
      if (current.version !== req.body.expectedVersion) throw new AppError(409, 'STALE_VERSION', 'These fields changed in another window. Reload to continue.', { version: current.version });
      const { expectedVersion: _v, ...input } = req.body;
      const problems = benchmarkInputProblems(input, templateBenchmark(t.project.template));
      if (problems.length) throw new AppError(422, 'BENCHMARK_INPUT_INVALID', problems.join(' '), { problems });
      const next = { ...input, version: current.version + 1 };
      await tx.taskInstance.update({ where: { id: t.id }, data: { benchmark: next as unknown as Prisma.InputJsonValue } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.benchmark_saved', before: { edgeCase: current.edgeCase, slots: Object.keys(current.slots), extraChecks: current.extraStateChecks.length }, after: { edgeCase: input.edgeCase, slots: Object.keys(input.slots), extraChecks: input.extraStateChecks.length, version: next.version } });
      return { status: 200, body: next };
    });
    return reply;
  });

  // ── Raise a need (spec 1.4): stays inside Authoring until the PM sends it ──
  app.post('/me/tasks/:id/needs', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: Id, body: RaiseNeedRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await ownTask(tx, req.params.id, actor.smeUserId);
      const b = templateBenchmark(t.project.template);
      const body = req.body;
      if (body.kind === 'new_case_kind') {
        for (const k of ['complexity', 'archetype'] as const) if (b.sliceLists[k].length && !b.sliceLists[k].includes(body[k])) throw new AppError(422, 'NEED_INVALID', `${k} must be one of ${b.sliceLists[k].join(', ')}.`);
      } else if (!b.edgeCases.some((e) => e.tag === body.edgeCase)) throw new AppError(422, 'NEED_INVALID', 'More data needs an edge case of this template.');
      const { kind, ...content } = body;
      const need = await tx.smeNeed.create({ data: { clientId: t.clientId, projectId: t.projectId, taskInstanceId: t.id, raisedBySmeUserId: actor.smeUserId, kind, content: content as Prisma.InputJsonValue, templateId: t.project.templateId } });
      await audit({ entityType: 'SmeNeed', entityId: need.id, action: 'sme_need.raised', after: { kind, taskId: t.id, projectId: t.projectId } });
      return { status: 201, body: needDto(need, null) };
    });
    return reply;
  });

  // ── Projects → SME needs (PM or Admin) ──
  const loadNeed = async (tx: Db | Tx, projectId: string, needId: string) => {
    const n = await tx.smeNeed.findFirst({ where: { id: needId, projectId } });
    if (!n) throw notFound('Need not found');
    return n;
  };

  app.get('/projects/:id/needs', { config: { access: PM }, schema: { tags: ['projects'], params: Id } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const needs = await db.smeNeed.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
    const tasks = await db.taskInstance.findMany({ where: { id: { in: needs.map((n) => n.taskInstanceId) } }, select: { id: true, output: true } });
    const title = (id: string) => String(((tasks.find((t) => t.id === id)?.output ?? {}) as { header?: { title?: unknown } }).header?.title ?? '') || null;
    return { items: needs.map((n) => needDto(n, title(n.taskInstanceId))), studioConnected: !!studio };
  });

  const NeedParams = z.object({ id: z.string().uuid(), needId: z.string().uuid() });
  app.post('/projects/:id/needs/:needId/merge', { config: { access: PM }, schema: { tags: ['projects'], params: NeedParams, body: z.object({ intoId: z.string().uuid() }).strict() } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const n = await loadNeed(tx, p.id, req.params.needId);
      const into = await loadNeed(tx, p.id, req.body.intoId);
      if (n.id === into.id || n.kind !== into.kind || n.state !== 'open' || into.state !== 'open') throw new AppError(409, 'NEED_NOT_MERGEABLE', 'Only two open needs of the same kind can be merged.');
      await tx.smeNeed.update({ where: { id: n.id }, data: { state: 'merged', mergedIntoId: into.id } });
      await audit({ entityType: 'SmeNeed', entityId: n.id, action: 'sme_need.merged', before: { state: 'open' }, after: { state: 'merged', intoId: into.id } });
      return { status: 200, body: { id: n.id, state: 'merged', mergedIntoId: into.id } };
    });
    return reply;
  });

  app.post('/projects/:id/needs/:needId/reject', { config: { access: PM }, schema: { tags: ['projects'], params: NeedParams, body: z.object({ reason: z.string().trim().min(3).max(2000) }).strict() } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const n = await loadNeed(tx, p.id, req.params.needId);
      if (n.state !== 'open') throw new AppError(409, 'NEED_NOT_OPEN', 'Only an open need can be rejected.');
      await tx.smeNeed.update({ where: { id: n.id }, data: { state: 'rejected', rejectReason: req.body.reason } });
      await audit({ entityType: 'SmeNeed', entityId: n.id, action: 'sme_need.rejected', before: { state: 'open' }, after: { state: 'rejected' } });
      return { status: 200, body: { id: n.id, state: 'rejected' } };
    });
    return reply;
  });

  type SendPrep = { needIds: string[]; body: InboxItemBody; result: StudioResult };
  app.post('/projects/:id/needs/:needId/send', { config: { access: PM }, schema: { tags: ['projects'], params: NeedParams, body: z.object({ summary: z.string().trim().min(3).max(4000), neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict() } }, async (req, reply) => {
    await runCommandPrepared<SendPrep, unknown>(
      db,
      req,
      reply,
      async (actor) => {
        if (!studio) throw new AppError(409, 'STUDIO_NOT_CONNECTED', 'Studio isn’t connected yet.');
        const p = await loadProject(db, req.params.id, actor);
        const n = await loadNeed(db, p.id, req.params.needId);
        if (n.state !== 'open') throw new AppError(409, 'NEED_NOT_OPEN', 'Only an open need can be sent.');
        const ref = await studioTemplateRef(db, p.template);
        if (!ref) throw new AppError(409, 'STUDIO_TEMPLATE_UNKNOWN', 'Studio’s Template ID for this version is not known yet: the RL Gym has not qualified it.');
        // Merged duplicates go as one item with one evidence entry per SME (spec 1.5).
        const merged = await db.smeNeed.findMany({ where: { projectId: p.id, mergedIntoId: n.id, state: 'merged' }, orderBy: { createdAt: 'asc' } });
        const all = [n, ...merged];
        const body: InboxItemBody = { kind: n.kind as InboxItemBody['kind'], source: 'adi-forge', template_id: ref.templateId, version: ref.version, project_id: p.id, summary: req.body.summary, evidence: all.map(evidenceOf), ...(req.body.neededBy ? { needed_by: req.body.neededBy } : {}) };
        const result = await studio.sendInboxItem(body, `adi-forge-need-${n.id}-${jcsSha256(body).slice(0, 16)}`);
        return { needIds: all.map((x) => x.id), body, result };
      },
      async ({ tx, actor, audit }, prep) => {
        if (!prep.result.ok) {
          await audit({ entityType: 'SmeNeed', entityId: req.params.needId, action: 'sme_need.send_failed', after: { code: prep.result.code, httpStatus: prep.result.httpStatus } });
          return { status: prep.result.kind === 'rejected' ? 422 : 503, body: { error: 'STUDIO_' + prep.result.code, message: `Studio did not take the item: ${prep.result.message}` } };
        }
        const itemId = String(prep.result.data.id ?? '');
        if (!itemId) return { status: 502, body: { error: 'STUDIO_NO_ID', message: 'Studio answered without an item ID.' } };
        const now = new Date();
        await tx.smeNeed.update({ where: { id: req.params.needId }, data: { state: 'sent', summary: req.body.summary, studioItemId: itemId, studioState: 'received', sentAt: now, sentById: actor.userId } });
        await tx.smeNeed.updateMany({ where: { id: { in: prep.needIds.filter((i) => i !== req.params.needId) } }, data: { studioItemId: itemId, studioState: 'received' } });
        await audit({ entityType: 'SmeNeed', entityId: req.params.needId, action: 'sme_need.sent_to_studio', before: { state: 'open' }, after: { state: 'sent', studioItemId: itemId, kind: prep.body.kind, evidence: prep.body.evidence.length } });
        return { status: 200, body: { id: req.params.needId, state: 'sent', studioItemId: itemId } };
      },
    );
    return reply;
  });

  app.post('/projects/:id/needs/:needId/refresh', { config: { access: PM }, schema: { tags: ['projects'], params: NeedParams } }, async (req, reply) => {
    await runCommandPrepared<StudioResult, unknown>(
      db,
      req,
      reply,
      async (actor) => {
        if (!studio) throw new AppError(409, 'STUDIO_NOT_CONNECTED', 'Studio isn’t connected yet.');
        const p = await loadProject(db, req.params.id, actor);
        const n = await loadNeed(db, p.id, req.params.needId);
        if (!n.studioItemId) throw new AppError(409, 'NEED_NOT_SENT', 'This need has not been sent to Studio.');
        return studio.readInboxItem(n.studioItemId);
      },
      async ({ tx, audit }, result) => {
        if (!result.ok) return { status: 503, body: { error: 'STUDIO_' + result.code, message: `Studio’s status could not be read: ${result.message}` } };
        const state = ['received', 'planned', 'released', 'declined'].includes(String(result.data.state)) ? String(result.data.state) : null;
        const detail = { planned_version: result.data.planned_version ?? null, released_version: result.data.released_version ?? null, decline_reason: result.data.decline_reason ?? null };
        const n = await tx.smeNeed.findUniqueOrThrow({ where: { id: req.params.needId } });
        await tx.smeNeed.updateMany({ where: { OR: [{ id: n.id }, { mergedIntoId: n.id }] }, data: { studioState: state, studioDetail: detail as Prisma.InputJsonValue } });
        await audit({ entityType: 'SmeNeed', entityId: n.id, action: 'sme_need.studio_state_read', before: { studioState: n.studioState }, after: { studioState: state, ...detail } });
        return { status: 200, body: { id: n.id, studioState: state, ...detail } };
      },
    );
    return reply;
  });

  // ── Projects → Export for benchmark / Re-export (snapshot 3.2 a) ──
  async function exportState(clientId: string, p: { id: string; status: string; templateId: string; template: Template }) {
    const records = await currentRecords(db, clientId, p.id);
    const ref = await rlgymTemplateRef(db, p.template);
    const runs = await db.rlGymProjectExport.findMany({ where: { clientId, projectId: p.id }, orderBy: { createdAt: 'desc' } });
    const held = await heldTasks(db, p.id, p.templateId);
    const reason = p.status === 'DRAFT' ? 'The project is still a draft.' : p.status === 'CANCELLED' ? 'The project is cancelled.' : !rlgym ? 'RL Gym isn’t connected yet.' : !ref ? 'RL Gym hasn’t qualified this template version yet.' : records.length < 1 ? 'Export needs at least one approved task.' : null;
    return { records, ref, runs, held, reason };
  }

  app.get('/projects/:id/rlgym-export', { config: { access: PM }, schema: { tags: ['projects'], params: Id } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const s = await exportState(req.actor!.clientId, p);
    const sent = inRlGym(s.runs);
    const packages = new Map((await db.authoredTaskPackage.findMany({ where: { recordId: { in: s.records.map((r) => r.id) } }, select: { recordId: true, revision: true } })).map((x) => [x.recordId, x.revision]));
    return {
      connected: !!rlgym,
      canExport: !s.reason,
      reason: s.reason,
      rlgymTemplate: s.ref,
      exported: s.runs.some((r) => r.outcome === 'received'),
      tasks: s.records.map((r: ApprovedTaskRecord) => ({ recordId: r.id, taskId: r.taskInstanceId, title: titleOf(r), revision: packages.get(r.id) ?? null, inRlGym: sent.has(r.id), waitingFor: s.held.get(r.taskInstanceId) ?? null })),
      runs: s.runs.slice(0, 20).map(runDto),
    };
  });

  type ExportPrep = { projectId: string; built: BuiltExport; result: RlGymResult };
  app.post('/projects/:id/rlgym-exports', { config: { access: PM }, schema: { tags: ['projects'], params: Id, body: z.object({}).strict() } }, async (req, reply) => {
    await runCommandPrepared<ExportPrep, unknown>(
      db,
      req,
      reply,
      // Outside the transaction: store the packages (committed, so the RL Gym can fetch them), then call the RL Gym.
      async (actor) => {
        const p = await loadProject(db, req.params.id, actor);
        const s = await exportState(actor.clientId, p);
        if (s.reason || !s.ref || !rlgym) throw new AppError(409, 'NOT_EXPORTABLE', s.reason ?? 'The project cannot be exported yet.');
        const batches = await correctionBatches(db, actor.clientId, s.records.map((r) => r.taskInstanceId));
        const built = await db.$transaction((tx) => buildRlGymExport(tx, { id: p.id, name: p.name, template: p.template }, s.records, s.ref!, { exported: s.runs.some((r) => r.outcome === 'received'), held: s.held, batches }));
        if (!built.tasks.length) throw new AppError(422, 'NOTHING_TO_EXPORT', 'None of the approved tasks can be sent.', { notSent: built.notSent });
        const result = await rlgym.exportProject(p.id, built.body, built.exportSha256);
        return { projectId: p.id, built, result };
      },
      async ({ tx, actor, audit }, { built, result, projectId }) => {
        const run = await tx.rlGymProjectExport.create({
          data: {
            clientId: actor.clientId,
            projectId,
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
        await audit({ entityType: 'Project', entityId: projectId, action: 'project.exported_to_rlgym', after: { runId: run.id, exportId: run.exportId, exportSha256: run.exportSha256, outcome: run.outcome, tasks: built.tasks.length, notSent: built.notSent.length, requestId: run.requestId, ...(result.ok ? { receipt: receiptOf(result.data) } : { error: result.code }) } });
        return { status: 201, body: runDto(run) };
      },
    );
    return reply;
  });

  // ── SME review batches from the RL Gym (snapshot 3.1 b) ──
  app.post('/projects/:id/run-reviews', { config: { access: ANVIL }, bodyLimit: 5_000_000, schema: { tags: ['anvil'], params: z.object({ id: z.string().min(1).max(200) }), body: z.record(z.string(), z.unknown()) } }, async (req, reply) => {
    const client = req.apiClient;
    if (!client) throw new AppError(401, 'UNAUTHENTICATED', 'An RL Gym key is required.');
    const body = req.body;
    if (body.schema !== 'rlgym.sme-review-package.v1') throw new AppError(422, 'VALIDATION_FAILED', 'schema must be rlgym.sme-review-package.v1');
    const batchId = typeof body.batch_id === 'string' ? body.batch_id.trim() : '';
    if (!batchId || batchId.length > 200) throw new AppError(422, 'VALIDATION_FAILED', 'batch_id is required');
    if (!Array.isArray(body.tasks)) throw new AppError(422, 'VALIDATION_FAILED', 'tasks must be an array');
    // Reference answers are never in a batch; a batch that carries them is refused rather than stored.
    if (/"reference_answers"\s*:/.test(JSON.stringify(body))) throw new AppError(422, 'VALIDATION_FAILED', 'A review batch must not carry reference answers.');
    // Idempotent by batch_id: the same batch sent again returns the same ref, whatever the route's project.
    const existing = await db.runReviewBatch.findUnique({ where: { clientId_batchId: { clientId: client.clientId, batchId } } });
    if (existing) return reply.status(202).send({ forge_batch_ref: existing.forgeBatchRef });
    const project = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await db.project.findFirst({ where: { id: req.params.id, clientId: client.clientId } }) : null;
    if (!project) throw notFound('Project not found');
    await runStaffOrServiceCommand(db, req, reply, async ({ tx, audit }) => {
      const again = await tx.runReviewBatch.findUnique({ where: { clientId_batchId: { clientId: client.clientId, batchId } } });
      if (again) return { status: 202, body: { forge_batch_ref: again.forgeBatchRef } };
      const ref = `rr-${jcsSha256({ c: client.clientId, b: batchId }).slice(0, 12)}`;
      const row = await tx.runReviewBatch.create({ data: { clientId: client.clientId, projectId: project.id, batchId, forgeBatchRef: ref, runId: typeof body.run_id === 'string' ? body.run_id : null, body: body as Prisma.InputJsonValue, bodySha256: jcsSha256(body), apiClientId: client.apiClientId } });
      await audit({ entityType: 'RunReviewBatch', entityId: row.id, action: 'run_review.received', after: { batchId, runId: row.runId, projectId: project.id, items: batchItems(body).length, forgeBatchRef: ref } });
      return { status: 202, body: { forge_batch_ref: ref } };
    });
    return reply;
  });

  app.get('/projects/:id/run-reviews', { config: { access: STAFF_REVIEW }, schema: { tags: ['projects'], params: Id } }, async (req) => {
    const p = await db.project.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!p) throw notFound('Project not found');
    const batches = await db.runReviewBatch.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, include: { decisions: true } });
    return {
      connected: !!rlgym,
      items: batches.map((b) => {
        const body = b.body as Record<string, unknown>;
        return {
          ref: b.forgeBatchRef,
          batchId: b.batchId,
          runId: b.runId,
          receivedAt: b.createdAt.toISOString(),
          scoringPass: body.scoring_pass ?? null,
          rubric: body.rubric ?? [],
          note: body.note ?? null,
          items: batchItems(body).map((i) => {
            const d = b.decisions.find((x) => x.itemId === i.itemId);
            // suspected_cause is the RL Gym's hint only; a person decides.
            return { itemId: i.itemId, taskId: i.taskId, revision: i.revision, episode: i.episode, decision: d ? { decision: d.decision, rationale: d.rationale, criterionId: d.criterionId, decidedBy: d.decidedBy, at: d.createdAt.toISOString(), response: d.response, reworkTaskId: d.reworkTaskId } : null };
          }),
        };
      }),
    };
  });

  type DecisionPrep = { batchRowId: string; batchId: string; items: z.infer<typeof DecisionsBody>['decisions']; taskOf: Record<string, string>; result: RlGymResult; decidedBy: string };
  app.post('/projects/:id/run-reviews/:ref/decisions', { config: { access: STAFF_REVIEW }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), ref: z.string().min(1).max(100) }), body: DecisionsBody } }, async (req, reply) => {
    await runCommandPrepared<DecisionPrep, unknown>(
      db,
      req,
      reply,
      async (actor) => {
        if (!rlgym) throw new AppError(409, 'RLGYM_NOT_CONNECTED', 'RL Gym isn’t connected yet, so decisions cannot be sent.');
        const b = await db.runReviewBatch.findFirst({ where: { forgeBatchRef: req.params.ref, projectId: req.params.id, clientId: actor.clientId }, include: { decisions: true } });
        if (!b) throw notFound('Review batch not found');
        const items = batchItems(b.body);
        const seen = new Set<string>();
        for (const d of req.body.decisions) {
          if (!items.some((i) => i.itemId === d.itemId)) throw new AppError(422, 'UNKNOWN_ITEM', `Item ${d.itemId} is not in this batch.`);
          if (seen.has(d.itemId)) throw new AppError(422, 'DUPLICATE_ITEM', `Item ${d.itemId} is decided twice.`);
          seen.add(d.itemId);
          // A decision is final: a different decision on the same item is refused.
          if (b.decisions.some((x) => x.itemId === d.itemId)) throw new AppError(409, 'ALREADY_DECIDED', `Item ${d.itemId} already has a decision.`);
          if ((d.decision === 'grader_wrong' || d.decision === 'rubric_correction') && !d.criterionId) throw new AppError(422, 'CRITERION_REQUIRED', `${d.decision} needs the criterion it is about.`);
        }
        const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } });
        const decidedBy = user.name || actor.userId;
        const body = { schema: 'rlgym.sme-decisions.v1', batch_id: b.batchId, decisions: req.body.decisions.map((d) => ({ item_id: d.itemId, decision: d.decision, rationale: d.rationale, decided_by: decidedBy, ...(d.criterionId ? { criterion_id: d.criterionId } : {}) })) };
        const result = await rlgym.sendDecisions(b.batchId, body, `${b.batchId}-${jcsSha256(body).slice(0, 16)}`);
        return { batchRowId: b.id, batchId: b.batchId, items: req.body.decisions, taskOf: Object.fromEntries(items.map((i) => [i.itemId, i.taskId])), result, decidedBy };
      },
      async ({ tx, actor, audit }, prep) => {
        if (!prep.result.ok) {
          await audit({ entityType: 'RunReviewBatch', entityId: prep.batchRowId, action: 'run_review.decisions_not_sent', after: { code: prep.result.code, httpStatus: prep.result.httpStatus } });
          return { status: prep.result.kind === 'rejected' ? 422 : 503, body: { error: 'RLGYM_' + prep.result.code, message: `RL Gym did not take the decisions: ${prep.result.message}. Nothing was recorded; try again.` } };
        }
        const out = [];
        for (const d of prep.items) {
          const taskId = prep.taskOf[d.itemId] ?? '';
          let reworkTaskId: string | null = null;
          // task_correction: the task goes back to Rework through the normal path; its next approval is a new revision.
          if (d.decision === 'task_correction' && /^[0-9a-f-]{36}$/i.test(taskId)) {
            const t = await tx.taskInstance.findFirst({ where: { id: taskId, clientId: actor.clientId } });
            if (t) {
              reworkTaskId = t.id;
              if (t.status === 'ACCEPTED') {
                const notes = `RL Gym review (batch ${prep.batchId}): ${d.rationale}`;
                const { count } = await tx.taskInstance.updateMany({ where: { id: t.id, status: 'ACCEPTED', revision: t.revision }, data: { status: 'REWORK', reviewStage: null, reworkCount: { increment: 1 }, revision: { increment: 1 }, reviewNotes: notes, reviewerId: actor.userId } });
                if (count) {
                  const sub = await tx.taskSubmission.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' }, select: { version: true } });
                  await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: sub?.version ?? 1, reviewerId: actor.userId, decision: 'REWORK', checklist: {}, comments: [{ section: 'general', text: d.rationale, source: 'rlgym_review' }] as Prisma.InputJsonValue, notes } });
                  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
                  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.rework_rlgym_review', before: { status: 'ACCEPTED' }, after: { status: 'REWORK', batchId: prep.batchId, itemId: d.itemId } });
                }
              }
            }
          }
          const row = await tx.runReviewDecision.create({ data: { clientId: actor.clientId, batchRowId: prep.batchRowId, itemId: d.itemId, taskId, decision: d.decision, rationale: d.rationale, criterionId: d.criterionId ?? null, decidedById: actor.userId, decidedBy: prep.decidedBy, sendOutcome: 'received', httpStatus: prep.result.httpStatus, response: prep.result.data as Prisma.InputJsonValue, reworkTaskId } });
          out.push({ itemId: row.itemId, decision: row.decision, reworkTaskId });
        }
        await audit({ entityType: 'RunReviewBatch', entityId: prep.batchRowId, action: 'run_review.decided', after: { batchId: prep.batchId, decisions: out.map((o) => ({ itemId: o.itemId, decision: o.decision })), requestId: prep.result.requestId } });
        return { status: 201, body: { decisions: out, rlgym: prep.result.data } };
      },
    );
    return reply;
  });

  // ── Review → Decision: the task's checks, read-only (spec 2.3) ──
  const checksFor = async (t: { benchmark: unknown; output: unknown; project: { template: Template } }) => {
    const b = templateBenchmark(t.project.template);
    const value = taskBenchmarkOf(t.benchmark);
    const s1 = ((t.output as { sections?: { S1?: Record<string, unknown> } } | null)?.sections?.S1 ?? {}) as Record<string, unknown>;
    const sme = b.verifiers?.expectedValuesFrom === 'sme';
    return { checks: checksView(b.verifiers), edgeCase: value.edgeCase ? (b.edgeCases.find((e) => e.tag === value.edgeCase) ?? null) : null, complexity: typeof s1.complexity === 'string' ? s1.complexity : null, archetype: typeof s1.archetype === 'string' ? s1.archetype : null, slots: sme ? value.slots : {}, extraStateChecks: sme ? value.extraStateChecks : [] };
  };

  app.get('/tasks/:id/benchmark-checks', { config: { access: STAFF_REVIEW }, schema: { tags: ['tasks'], params: Id } }, async (req) => {
    const t = await db.taskInstance.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { project: { include: { template: true } } } });
    if (!t) throw notFound('Task not found');
    return checksFor(t);
  });

  app.get('/me/reviews/:taskId/benchmark-checks', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ taskId: z.string().uuid() }) } }, async (req) => {
    const t = await db.taskInstance.findFirst({ where: { id: req.params.taskId, clientId: req.candidate!.clientId, reviewerSmeUserId: req.candidate!.smeUserId }, include: { project: { include: { template: true } } } });
    if (!t) throw notFound('Task not found');
    return checksFor(t);
  });

};
