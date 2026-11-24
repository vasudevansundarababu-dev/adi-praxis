import { benchmarkInputProblems, RaiseNeedRequest, SaveTaskBenchmarkRequest, type TemplateVerifiers } from '@praxis/shared';
import type { ApprovedTaskRecord, Prisma, RlGymProjectExport, SmeNeed, Template } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand, runCandidateCommandPrepared, runCommand, runCommandPrepared, runStaffOrServiceCommand } from '../platform/command';
import { templateBenchmark, taskBenchmarkOf } from '../anvil/benchmark';
import { buildRlGymExport, exportReceipt, projectIdFromRlGym, rlgymProjectId, rlgymTaskAnswers, rlgymTemplateRef, titleOf, type BuiltExport } from '../anvil/rlgym-export';
import { recordReports } from './project-export';
import { familyCatalog } from '../anvil/edge-family-catalog';
import { familyOfTag, focusTags } from '@praxis/shared';
import type { RlGymClient, RlGymResult } from '../anvil/rlgym-client';
import type { StudioClient, StudioResult, InboxItemBody } from '../anvil/studio-client';
import { jcsSha256 } from '../anvil/jcs';
import { NotConnectedCoverageClient, type StudioCoverageClient } from '../anvil/coverage-client';
import { approvedClauses } from '../policy/fact-catalog';
import { assignedRunReviews, batchTasks, currentAssignees, eligibleReviewers, smeInbox, staffInbox } from '../anvil/run-review-access';
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
const PM_ADMIN = ['ADMIN', 'PM'] as const;
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
  // E-001 Q4: a task the PM released (after the need was sent) is no longer held.
  const releases = needs.length ? await tx.taskHoldRelease.findMany({ where: { projectId, taskInstanceId: { in: needs.map((n) => n.taskInstanceId) } } }) : [];
  for (const n of needs) {
    const root = n.state === 'merged' && n.mergedIntoId ? byId.get(n.mergedIntoId) : n;
    const released = releases.some((r) => r.taskInstanceId === n.taskInstanceId && (!root?.sentAt || r.createdAt >= root.sentAt));
    if (!released && root?.state === 'sent' && root.studioItemId && root.studioState !== 'declined') held.set(n.taskInstanceId, root.studioItemId);
  }
  return held;
}

export const HOLD_PROMPT_DAYS = 3;

/** E-001 Q4: tasks held at least 3 days waiting for a new case kind, across the client's projects (oldest first). */
export async function longHeldTasks(tx: Db | Tx, clientId: string, now = new Date()) {
  const needs = await tx.smeNeed.findMany({ where: { clientId, kind: 'new_case_kind', state: { in: ['sent', 'merged'] } } });
  const byId = new Map(needs.map((n) => [n.id, n]));
  const releases = needs.length ? await tx.taskHoldRelease.findMany({ where: { clientId, taskInstanceId: { in: needs.map((n) => n.taskInstanceId) } } }) : [];
  const cutoff = now.getTime() - HOLD_PROMPT_DAYS * 86_400_000;
  return needs.flatMap((n) => {
    const root = n.state === 'merged' && n.mergedIntoId ? byId.get(n.mergedIntoId) : n;
    if (!root || root.state !== 'sent' || !root.studioItemId || root.studioState === 'declined' || !root.sentAt || root.sentAt.getTime() > cutoff) return [];
    if (releases.some((r) => r.taskInstanceId === n.taskInstanceId && r.createdAt >= root.sentAt!)) return [];
    return [{ projectId: n.projectId, taskInstanceId: n.taskInstanceId, needId: n.id, studioItemId: root.studioItemId, heldSince: root.sentAt.toISOString(), days: Math.floor((now.getTime() - root.sentAt.getTime()) / 86_400_000) }];
  }).sort((a, b) => a.heldSince.localeCompare(b.heldSince));
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

const runDto = (r: RlGymProjectExport, all: RlGymProjectExport[] = []) => ({
  authoringReceiptSha256: (r.authoringReceipt as { receipt_sha256?: string } | null)?.receipt_sha256 ?? null,
  taskAnswers: rlgymTaskAnswers(r, all),
  id: r.id, exportId: r.exportId, exportSha256: r.exportSha256, reason: r.reason, tasks: r.tasks, notSent: r.notSent, outcome: r.outcome, httpStatus: r.httpStatus, requestId: r.requestId, receipt: r.receipt, error: r.error, createdAt: r.createdAt.toISOString() });

const needDto = (n: SmeNeed, title: string | null) => ({ id: n.id, taskId: n.taskInstanceId, taskTitle: title, kind: n.kind, content: n.content, state: n.state, mergedIntoId: n.mergedIntoId, rejectReason: n.rejectReason, summary: n.summary, studioItemId: n.studioItemId, studioState: n.studioState, sentAt: n.sentAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() });

/** Studio's evidence entry for one need (AUTHORING-SPEC 1.5). `raised_by` is an opaque pseudonym, never a name. */
function evidenceOf(n: SmeNeed): Record<string, unknown> {
  const c = (n.content ?? {}) as Record<string, unknown>;
  const raised = { task_id: n.taskInstanceId, raised_by: `sme-${n.raisedBySmeUserId.slice(0, 8)}` };
  if (n.kind === 'new_case_kind') return { context: c.context, twist: c.twist, expected_outcome: c.expectedOutcome, complexity: c.complexity, archetype: c.archetype, ...raised };
  if (n.kind === 'new_edge_case_family') {
    // E-001 §6b: the family and its first variants, each with the SME's outcome (agreed with Studio, 24 Nov 2026).
    const variants = (Array.isArray(c.variants) ? c.variants : []) as { name: string; description: string; boundary?: string; outcome: { counts: boolean; decision?: string; rationale: string; evidence?: string[] } }[];
    return {
      family: { name: c.name, why_it_matters: c.whyItMatters, ...(c.archetype ? { archetype: c.archetype } : {}), ...(c.complexity ? { complexity: c.complexity } : {}) },
      variants: variants.map((v) => ({ name: v.name, description: v.description, boundary: v.boundary || null, outcome: v.outcome.counts ? { verdict: 'confirm', decision: v.outcome.decision, rationale: v.outcome.rationale, evidence: v.outcome.evidence ?? [] } : { verdict: 'reject', rationale: v.outcome.rationale } })),
      ...raised,
    };
  }
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

const DECISIONS = ['agent_failure', 'task_correction', 'rubric_correction', 'grader_wrong', 'environment_wrong', 'cannot_assess'] as const;
/**
 * E-007 phase 2 (owner, 24 Nov 2026): each decision is Accept (the score stands: agent failure confirmed), Dispute (with
 * what is wrong: task, rubric, grader or environment) or Can't assess. Can't assess stays in ADI Forge: the RL Gym takes
 * only its five decisions, and nothing is released by it.
 */
const verdictOf = (decision: string) => (decision === 'agent_failure' ? 'accept' : decision === 'cannot_assess' ? 'cannot_assess' : 'dispute');
const DecisionsBody = z
  .object({
    decisions: z
      .array(z.object({ itemId: z.string().min(1).max(200), decision: z.enum(DECISIONS), rationale: z.string().trim().min(1).max(4000), criterionId: z.string().min(1).max(100).optional(), evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict())
      .min(1)
      .max(200),
    /** The score pass the reviewer saw; a decision for another pass is refused. */
    scorePass: z.number().int().min(1).optional(),
  })
  .strict();

/** The RL Gym's score pass a batch was scored on (scoring_pass.pass), or null for older batches. */
export const scorePassOf = (body: unknown): number | null => {
  const p = isObj(body) && isObj(body.scoring_pass) ? body.scoring_pass.pass : null;
  return Number.isInteger(p) ? (p as number) : null;
};
/** The digest of the evidence a reviewer sees for one episode: the RL Gym's own evidence_sha256, else the episode's JCS SHA-256. */
export const evidenceDigest = (episode: Record<string, unknown>) => (typeof episode.evidence_sha256 === 'string' && /^[0-9a-f]{64}$/.test(episode.evidence_sha256) ? episode.evidence_sha256 : jcsSha256(episode));

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

/** Batches with at least one episode that has no decision yet, oldest first; each names its project and links to its Benchmark tab. */
export function waitingBatches(
  batches: { projectId: string; forgeBatchRef: string; batchId: string; runId: string | null; body: unknown; createdAt: Date; decisions: { itemId: string }[] }[],
  projects: { id: string; name: string }[],
) {
  return batches.flatMap((b) => {
    const items = batchItems(b.body);
    const decided = new Set(b.decisions.map((d) => d.itemId));
    const waiting = items.filter((i) => !decided.has(i.itemId)).length;
    const project = projects.find((p) => p.id === b.projectId);
    if (!waiting || !project) return [];
    return [{ projectId: project.id, projectName: project.name, ref: b.forgeBatchRef, batchId: b.batchId, runId: b.runId, items: items.length, waiting, receivedAt: b.createdAt.toISOString(), href: `/projects/${project.id}?tab=benchmark` }];
  });
}

export const benchmarkRoutes: FastifyPluginAsyncZod<{ db: Db; rlgym: RlGymClient | null; studio: StudioClient | null; coverage?: StudioCoverageClient }> = async (app, { db, rlgym, studio, coverage = new NotConnectedCoverageClient() }) => {
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
    const value = taskBenchmarkOf(t.benchmark);
    // E-001 §6b: the families (Studio's catalog, else one per S4 edge case). A task that only has a single edge case
    // shows the family it belongs to, read here; the task's stored data is never rewritten from it.
    const cat = await familyCatalog(db, t.project.template, studio);
    const derived = !value.familyFocus && value.edgeCase ? familyOfTag(cat.families, value.edgeCase) : null;
    const focus = value.familyFocus ?? (derived ? { familyId: derived.familyId, variants: [derived.variants.find((v) => v.tag === value.edgeCase)!.variantId], derived: true } : null);
    return { ...authorView(t.project.template), value, editable, needs: needs.map((n) => needDto(n, null)), families: { source: cat.source, fallbackReason: cat.fallbackReason, items: cat.families.map((f) => ({ ...f, variants: f.variants.filter((v) => v.kind !== 'fixture').map(({ outcome: _o, proposedOutcome: _p, ...v }) => v) })).filter((f) => f.variants.length) }, focus };
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
      const tb = templateBenchmark(t.project.template);
      if (input.familyFocus) {
        // E-001 §6b: a family focus takes every variant that counts (or the chosen ones). A single variant that is one of
        // the template's own edge cases is also kept as `edgeCase`, so packages and older readers stay as they were.
        const cat = await familyCatalog(tx, t.project.template, studio);
        const ft = focusTags(input.familyFocus, cat.families);
        if (ft.problems.length) throw new AppError(422, 'BENCHMARK_INPUT_INVALID', ft.problems.join(' '), { problems: ft.problems });
        input.edgeCase = ft.tags.length === 1 && tb.edgeCases.some((e) => e.tag === ft.tags[0]) ? ft.tags[0]! : null;
      }
      const problems = benchmarkInputProblems(input, tb);
      if (problems.length) throw new AppError(422, 'BENCHMARK_INPUT_INVALID', problems.join(' '), { problems });
      const next = { ...input, version: current.version + 1 };
      await tx.taskInstance.update({ where: { id: t.id }, data: { benchmark: next as unknown as Prisma.InputJsonValue } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.benchmark_saved', before: { edgeCase: current.edgeCase, slots: Object.keys(current.slots), extraChecks: current.extraStateChecks.length }, after: { edgeCase: input.edgeCase, familyFocus: input.familyFocus ?? null, slots: Object.keys(input.slots), extraChecks: input.extraStateChecks.length, version: next.version } });
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
      } else if (body.kind === 'new_edge_case_family') {
        // E-001 §6b: SMEs create families. The archetype and complexity, when given, are the template's own values.
        for (const k of ['complexity', 'archetype'] as const) if (body[k] && b.sliceLists[k].length && !b.sliceLists[k].includes(body[k]!)) throw new AppError(422, 'NEED_INVALID', `${k} must be one of ${b.sliceLists[k].join(', ')}.`);
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

  // ── E-001 §4 / E-002 §5: Validate = Studio's coverage check for the project's edge cases (needs and task focus) and clauses ──
  app.post('/projects/:id/coverage-check', { config: { access: PM }, schema: { tags: ['projects'], params: Id } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id }, select: { benchmark: true } });
    const needs = await db.smeNeed.findMany({ where: { projectId: p.id, state: { in: ['open', 'sent', 'merged'] } }, select: { content: true } });
    const tags = new Set<string>();
    for (const t of tasks) if (isObj(t.benchmark) && typeof t.benchmark.edgeCase === 'string' && t.benchmark.edgeCase) tags.add(t.benchmark.edgeCase);
    for (const n of needs) if (isObj(n.content) && typeof n.content.edgeCase === 'string' && n.content.edgeCase) tags.add(n.content.edgeCase);
    const clauses = (await approvedClauses(db, req.actor!.clientId, p.id, project.template.anvilSpec)).filter((c) => c.condition !== null).map((c) => ({ clause_id: c.clauseId, version: c.version, condition: c.condition }));
    const ref = { id: project.template.lineageId, version: project.template.version };
    const spec = project.template.anvilSpec as { authoring?: { edge_cases?: unknown } } | null;
    const entries = (Array.isArray(spec?.authoring?.edge_cases) ? spec!.authoring!.edge_cases : []).filter((e): e is Record<string, unknown> => isObj(e) && typeof e.tag === 'string' && tags.has(e.tag));
    const r = await coverage.check({ template: ref, edge_case_tags: [...tags].sort(), edge_cases: entries, clauses });
    return r.ok ? { connected: true, request: { edgeCaseTags: [...tags].sort(), clauses: clauses.length }, result: r.result } : { connected: coverage.connected, request: { edgeCaseTags: [...tags].sort(), clauses: clauses.length }, message: r.message };
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
      rlgymProjectId: rlgymProjectId(p.id),
      canExport: !s.reason,
      reason: s.reason,
      rlgymTemplate: s.ref,
      exported: s.runs.some((r) => r.outcome === 'received'),
      tasks: s.records.map((r: ApprovedTaskRecord) => ({ recordId: r.id, taskId: r.taskInstanceId, title: titleOf(r), revision: packages.get(r.id) ?? null, inRlGym: sent.has(r.id), waitingFor: s.held.get(r.taskInstanceId) ?? null })),
      runs: s.runs.slice(0, 20).map((r) => runDto(r, s.runs)),
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
        // E-007 phase 2: every approved record is checked on its frozen snapshot first; a failing one is not sent.
        const reports = await recordReports(db, s.records);
        // E-001 §6b: a task focused on a family takes every variant that counts at export time (later ones included).
        const focused = await db.taskInstance.findMany({ where: { id: { in: s.records.map((r) => r.taskInstanceId) } }, select: { id: true, benchmark: true } });
        const familyTags = new Map<string, string[]>();
        if (focused.some((x) => taskBenchmarkOf(x.benchmark).familyFocus)) {
          const cat = await familyCatalog(db, p.template, studio, { fresh: true });
          for (const x of focused) {
            const f = taskBenchmarkOf(x.benchmark).familyFocus;
            if (f) familyTags.set(x.id, focusTags(f, cat.families).tags);
          }
        }
        const built = await db.$transaction((tx) => buildRlGymExport(tx, { id: p.id, name: p.name, template: p.template }, s.records, s.ref!, { exported: s.runs.some((r) => r.outcome === 'received'), held: s.held, batches, reports, familyTags }));
        if (!built.tasks.length) throw new AppError(422, 'NOTHING_TO_EXPORT', 'None of the approved tasks can be sent.', { notSent: built.notSent });
        const result = await rlgym.exportProject(rlgymProjectId(p.id), built.body, built.exportSha256);
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
            authoringReceipt: exportReceipt(built, new Date()) as Prisma.InputJsonValue,
            outcome: result.ok ? 'received' : result.kind,
            httpStatus: result.httpStatus,
            requestId: result.requestId,
            ...(result.ok ? { receipt: receiptOf(result.data) as Prisma.InputJsonValue } : { error: { code: result.code, message: result.message } as Prisma.InputJsonValue }),
            requestedById: actor.userId,
          },
        });
        await audit({ entityType: 'Project', entityId: projectId, action: 'project.exported_to_rlgym', after: { runId: run.id, exportId: run.exportId, exportSha256: run.exportSha256, authoringReceiptSha256: (run.authoringReceipt as { receipt_sha256?: string } | null)?.receipt_sha256 ?? null, outcome: run.outcome, tasks: built.tasks.length, notSent: built.notSent.length, requestId: run.requestId, ...(result.ok ? { receipt: receiptOf(result.data) } : { error: result.code }) } });
        return { status: 201, body: runDto(run, await tx.rlGymProjectExport.findMany({ where: { clientId: actor.clientId, projectId } })) };
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
    // The RL Gym names the project as exported (`prj_<32 hex>`); the Authoring UUID is accepted too.
    const uuid = projectIdFromRlGym(req.params.id);
    const project = uuid ? await db.project.findFirst({ where: { id: uuid, clientId: client.clientId } }) : null;
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
    const batches = await db.runReviewBatch.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, include: { decisions: true, assignments: true } });
    const allTasks = [...new Set(batches.flatMap((b) => [...batchTasks(b.body).keys()]))];
    const eligible = await eligibleReviewers(db, req.actor!.clientId, p.id, allTasks);
    return {
      connected: !!rlgym,
      canDecide: req.actor!.roles.some((r) => r === 'ADMIN' || r === 'PM'),
      items: batches.map((b) => {
        const body = b.body as Record<string, unknown>;
        const current = currentAssignees(b.assignments);
        return {
          // D-004: who reviews each task's episodes (its author or a project SME Reviewer), chosen by a PM or Admin.
          tasks: [...batchTasks(b.body).keys()].map((taskId) => {
            const list = eligible.get(taskId) ?? [];
            const sme = current.get(taskId) ?? null;
            return { taskId, assignee: sme ? (list.find((e) => e.smeUserId === sme) ?? { smeUserId: sme, name: 'Former reviewer', role: 'reviewer' as const }) : null, eligible: list, locked: b.decisions.some((d) => d.taskId === taskId) };
          }),
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
            return { itemId: i.itemId, taskId: i.taskId, revision: i.revision, episode: i.episode, runId: b.runId, scorePass: scorePassOf(body), evidenceSha256: evidenceDigest(i.episode), decision: d ? { decision: d.decision, verdict: d.verdict ?? verdictOf(d.decision), scorePass: d.scorePass, evidenceSha256: d.evidenceSha256, rationale: d.rationale, criterionId: d.criterionId, decidedBy: d.decidedBy, at: d.createdAt.toISOString(), response: d.response, reworkTaskId: d.reworkTaskId } : null };
          }),
        };
      }),
    };
  });

  // Owner, 23 Nov 2026: a received batch was only visible on Project → Benchmark, so nobody knew it was waiting.
  // Console Home and the Benchmark tab read this: every batch, in every project, with episodes still undecided.
  app.get('/run-reviews/waiting', { config: { access: STAFF_REVIEW }, schema: { tags: ['projects'] } }, async (req) => {
    const batches = await db.runReviewBatch.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { createdAt: 'asc' }, include: { decisions: { select: { itemId: true } } } });
    const projects = await db.project.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.projectId))] }, clientId: req.actor!.clientId }, select: { id: true, name: true } });
    return { items: waitingBatches(batches, projects) };
  });

  // ── Benchmark review decisions (staff: PM, Admin; SME: the task's assigned reviewer). One implementation. ──
  type DecisionPrep = { batchRowId: string; batchId: string; items: z.infer<typeof DecisionsBody>['decisions']; taskOf: Record<string, string>; evidenceOf: Record<string, string>; scorePass: number | null; result: RlGymResult; decidedBy: string };
  type Decisions = z.infer<typeof DecisionsBody>['decisions'];

  /** Checks the decisions and sends them to the RL Gym (outside the transaction). `mayDecide` limits which tasks the person may decide. */
  async function prepareDecisions(where: Prisma.RunReviewBatchWhereInput, decisions: Decisions, decidedBy: string, mayDecide: (taskId: string, current: Map<string, string>) => boolean, seenPass?: number): Promise<DecisionPrep> {
    if (!rlgym) throw new AppError(409, 'RLGYM_NOT_CONNECTED', 'RL Gym isn’t connected yet, so decisions cannot be sent.');
    const b = await db.runReviewBatch.findFirst({ where, include: { decisions: true, assignments: { orderBy: { createdAt: 'asc' } } } });
    if (!b) throw notFound('Review batch not found');
    const items = batchItems(b.body);
    // E-007 phase 2: a decision is bound to the score pass and the evidence the reviewer saw. A decision made on an older
    // score pass never releases a newer one: it is refused, and the reviewer decides the newer pass.
    const pass = scorePassOf(b.body);
    if (seenPass !== undefined && pass !== null && seenPass !== pass) throw new AppError(409, 'STALE_SCORE_PASS', `You reviewed score pass ${seenPass}, but this batch is score pass ${pass}. Reload and review it again.`);
    if (b.runId && pass !== null) {
      const later = await db.runReviewBatch.findMany({ where: { clientId: b.clientId, runId: b.runId, createdAt: { gt: b.createdAt } }, select: { body: true, batchId: true } });
      const ids = new Set(decisions.map((d) => d.itemId));
      const newer = later.find((l) => (scorePassOf(l.body) ?? 0) > pass && batchItems(l.body).some((i) => ids.has(i.itemId) || ids.has(String(i.episode.episode_id ?? ''))));
      if (newer) throw new AppError(409, 'SUPERSEDED_SCORE_PASS', `The RL Gym re-scored this run (score pass ${scorePassOf(newer.body)}, batch ${newer.batchId}). Decide the newer score pass; a decision on pass ${pass} cannot stand for it.`);
    }
    const current = currentAssignees(b.assignments);
    const seen = new Set<string>();
    for (const d of decisions) {
      const item = items.find((i) => i.itemId === d.itemId);
      if (!item) throw new AppError(422, 'UNKNOWN_ITEM', `Item ${d.itemId} is not in this batch.`);
      if (!mayDecide(item.taskId, current)) throw new AppError(403, 'NOT_ASSIGNED_REVIEWER', `You are not the assigned reviewer for the task of item ${d.itemId}.`);
      if (seen.has(d.itemId)) throw new AppError(422, 'DUPLICATE_ITEM', `Item ${d.itemId} is decided twice.`);
      seen.add(d.itemId);
      // A decision is final: a different decision on the same item is refused.
      if (b.decisions.some((x) => x.itemId === d.itemId)) throw new AppError(409, 'ALREADY_DECIDED', `Item ${d.itemId} already has a decision.`);
      if ((d.decision === 'grader_wrong' || d.decision === 'rubric_correction') && !d.criterionId) throw new AppError(422, 'CRITERION_REQUIRED', `${d.decision} needs the criterion it is about.`);
      if (d.evidenceSha256 && d.evidenceSha256 !== evidenceDigest(item.episode)) throw new AppError(409, 'EVIDENCE_CHANGED', `The evidence for item ${d.itemId} is not what you reviewed. Reload and review it again.`);
    }
    const evidenceOf = Object.fromEntries(items.map((i) => [i.itemId, evidenceDigest(i.episode)]));
    // Can't assess is kept in ADI Forge only; the RL Gym takes the other decisions, with the pass and evidence they bind.
    const toSend = decisions.filter((d) => d.decision !== 'cannot_assess');
    const body = { schema: 'rlgym.sme-decisions.v1', batch_id: b.batchId, decisions: toSend.map((d) => ({ item_id: d.itemId, decision: d.decision, rationale: d.rationale, decided_by: decidedBy, ...(d.criterionId ? { criterion_id: d.criterionId } : {}), verdict: verdictOf(d.decision), ...(pass !== null ? { score_pass: pass } : {}), evidence_sha256: evidenceOf[d.itemId] })) };
    const result: RlGymResult = toSend.length ? await rlgym.sendDecisions(b.batchId, body, `${b.batchId}-${jcsSha256(body).slice(0, 16)}`) : { ok: true, httpStatus: null, requestId: null, data: { not_sent: 'cannot_assess' } } as unknown as RlGymResult;
    return { batchRowId: b.id, batchId: b.batchId, items: decisions, taskOf: Object.fromEntries(items.map((i) => [i.itemId, i.taskId])), evidenceOf, scorePass: pass, result, decidedBy };
  }

  /** Records what the RL Gym took; task_correction sends the task back to Rework with the rationale. `deciderId` is a staff user or an SME user. */
  async function commitDecisions(tx: Tx, audit: (i: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown }) => Promise<void>, clientId: string, deciderId: string, prep: DecisionPrep) {
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
        const t = await tx.taskInstance.findFirst({ where: { id: taskId, clientId } });
        if (t) {
          reworkTaskId = t.id;
          if (t.status === 'ACCEPTED') {
            const notes = `RL Gym review (batch ${prep.batchId}): ${d.rationale}`;
            const { count } = await tx.taskInstance.updateMany({ where: { id: t.id, status: 'ACCEPTED', revision: t.revision }, data: { status: 'REWORK', reviewStage: null, reworkCount: { increment: 1 }, revision: { increment: 1 }, reviewNotes: notes, reviewerId: deciderId } });
            if (count) {
              const sub = await tx.taskSubmission.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' }, select: { version: true } });
              await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: sub?.version ?? 1, reviewerId: deciderId, decision: 'REWORK', checklist: {}, comments: [{ section: 'general', text: d.rationale, source: 'rlgym_review' }] as Prisma.InputJsonValue, notes } });
              if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
              await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.rework_rlgym_review', before: { status: 'ACCEPTED' }, after: { status: 'REWORK', batchId: prep.batchId, itemId: d.itemId } });
            }
          }
        }
      }
      const row = await tx.runReviewDecision.create({ data: { clientId, batchRowId: prep.batchRowId, itemId: d.itemId, taskId, decision: d.decision, verdict: verdictOf(d.decision), scorePass: prep.scorePass, evidenceSha256: prep.evidenceOf[d.itemId] ?? null, rationale: d.rationale, criterionId: d.criterionId ?? null, decidedById: deciderId, decidedBy: prep.decidedBy, sendOutcome: d.decision === 'cannot_assess' ? 'kept_in_forge' : 'received', httpStatus: prep.result.httpStatus, response: prep.result.data as Prisma.InputJsonValue, reworkTaskId } });
      out.push({ itemId: row.itemId, decision: row.decision, verdict: row.verdict, scorePass: row.scorePass, evidenceSha256: row.evidenceSha256, reworkTaskId });
    }
    await audit({ entityType: 'RunReviewBatch', entityId: prep.batchRowId, action: 'run_review.decided', after: { batchId: prep.batchId, scorePass: prep.scorePass, decisions: out.map((o) => ({ itemId: o.itemId, decision: o.decision, verdict: o.verdict, evidenceSha256: o.evidenceSha256 })), requestId: prep.result.requestId } });
    return { status: 201, body: { decisions: out, rlgym: prep.result.data } };
  }

  // D-004 (owner, 23 Nov 2026): run results are verified by PM/Admin, or by the SME assigned to the task. The staff
  // Reviewer role can still read batches but no longer decides.
  app.post('/projects/:id/run-reviews/:ref/decisions', { config: { access: PM_ADMIN }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), ref: z.string().min(1).max(100) }), body: DecisionsBody } }, async (req, reply) => {
    await runCommandPrepared<DecisionPrep, unknown>(
      db,
      req,
      reply,
      async (actor) => {
        const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } });
        return prepareDecisions({ forgeBatchRef: req.params.ref, projectId: req.params.id, clientId: actor.clientId }, req.body.decisions, user.name || actor.userId, () => true, req.body.scorePass);
      },
      async ({ tx, actor, audit }, prep) => commitDecisions(tx, audit, actor.clientId, actor.userId, prep),
    );
    return reply;
  });

  // ── D-004: assign the SME who reviews each task of a batch (PM, Admin) ──
  app.post('/projects/:id/run-reviews/:ref/assignments', { config: { access: PM_ADMIN }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), ref: z.string().min(1).max(100) }), body: z.object({ taskId: z.string().min(1).max(200), smeUserId: z.string().uuid() }).strict() } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const b = await tx.runReviewBatch.findFirst({ where: { forgeBatchRef: req.params.ref, projectId: req.params.id, clientId: actor.clientId }, include: { decisions: { select: { taskId: true } }, assignments: { orderBy: { createdAt: 'asc' } } } });
      if (!b) throw notFound('Review batch not found');
      if (!batchItems(b.body).some((i) => i.taskId === req.body.taskId)) throw new AppError(422, 'UNKNOWN_TASK', 'That task is not in this batch.');
      const eligible = (await eligibleReviewers(tx, actor.clientId, req.params.id, [req.body.taskId])).get(req.body.taskId) ?? [];
      const who = eligible.find((e) => e.smeUserId === req.body.smeUserId);
      if (!who) throw new AppError(422, 'NOT_ELIGIBLE_REVIEWER', 'Only the SME who wrote the task, or an SME Reviewer on this project, can review its run results.');
      const current = currentAssignees(b.assignments).get(req.body.taskId) ?? null;
      if (current === req.body.smeUserId) {
        await audit({ entityType: 'RunReviewBatch', entityId: b.id, action: 'run_review.assignment_unchanged', after: { taskId: req.body.taskId, smeUserId: current } });
        return { status: 200, body: { taskId: req.body.taskId, smeUserId: current, unchanged: true } };
      }
      if (b.decisions.some((d) => d.taskId === req.body.taskId)) throw new AppError(409, 'ALREADY_DECIDED', 'This task already has a decision, so its reviewer can no longer change.');
      await tx.runReviewAssignment.create({ data: { clientId: actor.clientId, batchRowId: b.id, taskId: req.body.taskId, smeUserId: who.smeUserId, assignedById: actor.userId } });
      await audit({ entityType: 'RunReviewBatch', entityId: b.id, action: 'run_review.assigned', before: { smeUserId: current }, after: { taskId: req.body.taskId, smeUserId: who.smeUserId, role: who.role } });
      return { status: 201, body: { taskId: req.body.taskId, smeUserId: who.smeUserId, name: who.name, role: who.role } };
    });
    return reply;
  });

  // ── E-001 Q4: release a held task (drop its edge-case focus so it exports as a normal case). PM, Admin. ──
  app.post('/projects/:id/held-tasks/:taskId/release', { config: { access: PM_ADMIN }, schema: { tags: ['projects'], params: z.object({ id: z.string().uuid(), taskId: z.string().uuid() }), body: z.object({ reason: z.string().trim().min(3).max(1000) }).strict() } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await tx.project.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!p) throw notFound('Project not found');
      const held = await heldTasks(tx, p.id, p.templateId);
      if (!held.has(req.params.taskId)) throw new AppError(409, 'NOT_HELD', 'This task is not held waiting for a new case kind.');
      const need = await tx.smeNeed.findFirstOrThrow({ where: { projectId: p.id, taskInstanceId: req.params.taskId, kind: 'new_case_kind', state: { in: ['sent', 'merged'] } }, orderBy: { createdAt: 'desc' } });
      const t = await tx.taskInstance.findUniqueOrThrow({ where: { id: req.params.taskId } });
      const bench = isObj(t.benchmark) ? t.benchmark : null;
      // Drop the edge-case focus as a new benchmark version (the SME's other benchmark values stay).
      if (bench && bench.edgeCase) await tx.taskInstance.update({ where: { id: t.id }, data: { benchmark: { ...bench, edgeCase: null, version: (Number(bench.version) || 0) + 1 } as Prisma.InputJsonValue } });
      const row = await tx.taskHoldRelease.create({ data: { clientId: actor.clientId, projectId: p.id, taskInstanceId: t.id, needId: need.id, reason: req.body.reason, releasedById: actor.userId } });
      await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.hold_released', before: { held: held.get(t.id), edgeCase: bench?.edgeCase ?? null }, after: { edgeCase: null, reason: req.body.reason, releaseId: row.id } });
      return { status: 201, body: { released: true, taskId: t.id } };
    });
    return reply;
  });

  // ── D-004: the SME's side, in the SME app: the run reviews assigned to me, and my decisions on them ──
  app.get('/me/run-reviews', { config: { access: 'candidate' }, schema: { tags: ['work'] } }, async (req) => {
    const me = req.candidate!;
    return { items: await assignedRunReviews(db, me.clientId, me.smeUserId) };
  });

  app.post('/me/run-reviews/:ref/decisions', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ ref: z.string().min(1).max(100) }), body: DecisionsBody } }, async (req, reply) => {
    await runCandidateCommandPrepared<DecisionPrep, unknown>(
      db,
      req,
      reply,
      async (actor) => {
        const sme = await db.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId }, select: { displayName: true, contactEmail: true } });
        return prepareDecisions({ forgeBatchRef: req.params.ref, clientId: actor.clientId }, req.body.decisions, sme.displayName || sme.contactEmail || actor.smeUserId, (taskId, current) => current.get(taskId) === actor.smeUserId, req.body.scorePass);
      },
      async ({ tx, actor, audit }, prep) => commitDecisions(tx, audit, actor.clientId, actor.smeUserId, prep),
    );
    return reply;
  });

  // ── D-004: inboxes (the header bell). Items disappear when their work is done. ──
  app.get('/me/inbox', { config: { access: PM_ADMIN }, schema: { tags: ['projects'] } }, async (req) => ({ items: await staffInbox(db, req.actor!.clientId) }));
  app.get('/me/forge/inbox', { config: { access: 'candidate' }, schema: { tags: ['work'] } }, async (req) => ({ items: await smeInbox(db, req.candidate!.clientId, req.candidate!.smeUserId) }));

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
