import { CoverageDimensions, CoverageQuotas, coverageStatus, effectiveCoverage, type CoverageTags } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { runCommand } from '../platform/command';
import { definitionFor } from '../tasks/definitions';
import { draftingView } from '../tasks/drafting/service';
import { CHECKLIST, completionStatus, decideTask, reviewableTask, TaskDecisionRequest } from '../tasks/review-service';
import type { StoredChecks } from '../tasks/submission';
import { EXPERT_TASK_TYPES, templateRef } from '../tasks/task-service';
import { loadProject } from './projects';

const IdParams = z.object({ id: z.string().uuid() });
const REVIEW = ['REVIEWER', 'ADMIN'] as const;
const brief = (input: unknown) => (input as { slot?: { brief?: string } }).slot?.brief ?? null;

/** TASK-KYC R01 to R03 (task review) and the SPEC coverage and PM dashboard. */
export const taskReviewRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // R01: flagged items first; never the reviewer's own tasks or tasks from an author they declared a conflict with.
  app.get('/review/tasks', { config: { access: REVIEW }, schema: { tags: ['review'], querystring: z.object({ projectId: z.string().uuid().optional() }) } }, async (req) => {
    const actor = req.actor!;
    const me = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const projectIds = actor.roles.includes('ADMIN') ? undefined : (await db.projectReviewer.findMany({ where: { userId: actor.userId } })).map((r) => r.projectId);
    const conflicted = new Set((await db.conflictDeclaration.findMany({ where: { reviewerId: actor.userId, resolvedAt: null } })).map((c) => c.smeUserId));
    const rows = await db.taskInstance.findMany({
      where: { clientId: actor.clientId, status: 'SUBMITTED', taskType: { in: ['AUTHORING', 'ANNOTATION'] }, ...(projectIds ? { projectId: { in: projectIds } } : {}), ...(req.query.projectId ? { projectId: req.query.projectId } : {}) },
      include: { project: { include: { template: true } }, assignedTo: { include: { smeUser: true } } },
      orderBy: { submittedAt: 'asc' },
    });
    const items = rows
      .filter((t) => !t.assignedTo?.smeUser || (!conflicted.has(t.assignedTo.smeUserId) && t.assignedTo.smeUser.contactEmail?.toLowerCase() !== me.email.toLowerCase()))
      .map((t) => {
        const checks = t.checks as StoredChecks | null;
        return {
          id: t.id,
          projectId: t.projectId,
          projectName: t.project.name,
          workflow: t.project.template.workflowName,
          taskType: t.taskType,
          brief: brief(t.input),
          author: t.assignedTo?.smeUser?.displayName ?? null,
          submittedAt: t.submittedAt?.toISOString() ?? null,
          reworkCount: t.reworkCount,
          flaggedDuplicate: (checks?.similar ?? []).some((m) => m.flagged),
          dataFlags: Array.isArray(t.flags) ? t.flags.length : 0,
        };
      })
      .sort((a, b) => Number(b.flaggedDuplicate || b.dataFlags > 0) - Number(a.flaggedDuplicate || a.dataFlags > 0));
    return { items };
  });

  // R02: the full task read-only, automated check results, the similarity panel and what changed since the last version.
  app.get('/review/tasks/:id', { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams } }, async (req) => {
    const t = await reviewableTask(db, req.actor!, req.params.id);
    const template = await templateRef(db, t.project.templateId);
    const def = definitionFor(template);
    const checks = t.checks as StoredChecks | null;
    const similar = checks?.similar ?? [];
    const others = await db.taskInstance.findMany({ where: { id: { in: similar.map((m) => m.taskId) } }, include: { project: true } });
    const versions = t.submissions;
    return {
      id: t.id,
      status: t.status,
      revision: t.revision,
      taskType: t.taskType,
      definition: def.key,
      project: { id: t.projectId, name: t.project.name, workflow: template.workflowName, verificationCriteria: t.project.template.verificationCriteria, humanGate: t.project.template.humanGate, tptMinutes: t.project.tptMinutes },
      slot: t.slot ? { brief: t.slot.brief, isOpen: t.slot.isOpen, ...(t.slot.coverageTags as object) } : null,
      author: t.assignedTo?.smeUser?.displayName ?? null,
      input: t.input,
      output: t.output,
      coverageTags: t.coverageTags,
      coverageDimensions: template.coverageDimensions,
      activeSeconds: t.activeSeconds,
      submittedAt: t.submittedAt?.toISOString() ?? null,
      reworkCount: t.reworkCount,
      checks: checks?.results ?? [],
      flags: t.flags ?? [],
      embeddingModel: checks?.embeddingModel ?? null,
      similar: similar.map((m) => {
        const o = others.find((x) => x.id === m.taskId);
        return { taskId: m.taskId, embeddingScore: m.embeddingScore, structuredScore: m.structuredScore, flagged: m.flagged, status: o?.status ?? null, project: o?.project.name ?? null, brief: o ? brief(o.input) : null, coverageTags: o?.coverageTags ?? null, text: o?.output && !o.quarantinedAt ? def.canonicalText(o.output as Record<string, unknown>) : null };
      }),
      text: t.output ? def.canonicalText(t.output as Record<string, unknown>) : '',
      versions: versions.map((v) => ({ version: v.version, submittedAt: v.submittedAt.toISOString() })),
      previousOutput: versions.length > 1 ? versions.at(-2)!.output : null,
      reviews: t.reviews.map((r) => ({ decision: r.decision, comments: r.comments, notes: r.notes, rejectReason: r.rejectReason, at: r.createdAt.toISOString(), version: r.submissionVersion })),
      checklist: CHECKLIST,
      // M9 "How this task was made": sources (files open via /review/tasks/:id/sources/:sourceId/file), interview, drafts.
      drafting: t.taskType === 'AUTHORING' ? await draftingView(db, t) : null,
    };
  });

  // R03: accept (writes the ApprovedTaskRecord in the same transaction), rework with pinned comments, or reject.
  app.post('/review/tasks/:id/decision', { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, body: TaskDecisionRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => ({ status: 200, body: await decideTask(tx, actor, req.params.id, req.body, audit, emit) }));
    return reply;
  });

  // SPEC coverage dashboard (PM and Admin): distinct accepted vs target, authors, coverage heatmap, duplicates, rework, TPT.
  app.get('/projects/:id/dashboard', { config: { access: ['PM', 'ADMIN'] }, schema: { tags: ['tasks'], params: IdParams } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id, taskType: EXPERT_TASK_TYPES }, include: { assignedTo: { include: { smeUser: true } }, slot: true } });
    const byStatus = Object.fromEntries(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK', 'ACCEPTED', 'REJECTED'].map((s) => [s, tasks.filter((t) => t.status === s).length]));
    const accepted = tasks.filter((t) => t.status === 'ACCEPTED');
    const everSubmitted = tasks.filter((t) => t.submittedAt);
    const perExpert = new Map<string, { name: string | null; accepted: number; working: number; submitted: number }>();
    for (const t of tasks.filter((x) => x.assignedTo)) {
      const e = perExpert.get(t.assignedTo!.id) ?? { name: t.assignedTo!.smeUser?.displayName ?? null, accepted: 0, working: 0, submitted: 0 };
      if (t.status === 'ACCEPTED') e.accepted++;
      else if (t.status === 'SUBMITTED') e.submitted++;
      else if (['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) e.working++;
      perExpert.set(t.assignedTo!.id, e);
    }
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 6) / 10 : null);
    const done = await completionStatus(db, p.id);
    const base = {
      project: { id: p.id, name: p.name, status: p.status, taskMode: p.taskMode, tptMinutes: p.tptMinutes },
      byStatus,
      accepted: accepted.length,
      target: done.target,
      complete: done.met,
      tpt: { targetMinutes: p.tptMinutes, averageActiveMinutes: avg(everSubmitted.map((t) => t.activeSeconds)) },
      reworkRate: everSubmitted.length ? Math.round((everSubmitted.filter((t) => t.reworkCount > 0).length / everSubmitted.length) * 100) / 100 : 0,
      experts: [...perExpert.values()].sort((a, b) => b.accepted - a.accepted),
      updatedAt: new Date().toISOString(),
    };
    if (p.taskMode !== 'AUTHORING') return { ...base, coverage: null };

    const template = await db.template.findUniqueOrThrow({ where: { id: p.templateId } });
    const cov = effectiveCoverage(template, CoverageQuotas.nullable().safeParse(p.coverageQuotas).data ?? null);
    const dims = (CoverageDimensions.safeParse(template.coverageDimensions).data ?? { dimensions: [] }).dimensions;
    const tagsOf = (t: { coverageTags: unknown }) => (t.coverageTags ?? { tags: {}, edgeCase: null }) as CoverageTags;
    const status = coverageStatus({ cells: cov.cells, edgeCases: cov.edgeCases }, accepted.map(tagsOf), tasks.filter((t) => ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK'].includes(t.status)).map(tagsOf));
    const catalog = new Set(cov.edgeCases.map((e) => e.name.toLowerCase()));
    const slotCounts = await db.coverageSlot.groupBy({ by: ['status'], where: { projectId: p.id }, _count: true });
    const flagged = tasks.filter((t) => ((t.checks as StoredChecks | null)?.similar ?? []).some((m) => m.flagged)).length;
    return {
      ...base,
      authors: { distinct: new Set(accepted.map((t) => t.assignedToId)).size, minimum: p.maxPerExpert ? Math.ceil((p.distinctTarget ?? 0) / p.maxPerExpert) : null, cap: p.maxPerExpert },
      coverage: { met: done.coverageMet, cells: status.cells, edgeCases: status.edgeCases, dimensions: dims.map((d) => ({ key: d.key, label: d.label })) },
      slots: Object.fromEntries(['OPEN', 'OFFERED', 'IN_PROGRESS', 'FILLED', 'RELEASED'].map((s) => [s, slotCounts.find((c) => c.status === s)?._count ?? 0])),
      duplicates: { flagged, rejected: tasks.filter((t) => t.rejectReason === 'DUPLICATE').length },
      // Open-slot edge cases not yet in the template's catalog: candidates for adding to it.
      discoveredEdgeCases: [...new Set(accepted.filter((t) => t.slot?.isOpen).map((t) => tagsOf(t).edgeCase).filter((e): e is string => !!e && !catalog.has(e.toLowerCase())))],
    };
  });
};
