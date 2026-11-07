import { Prisma, type TaskInstance } from '@prisma/client';
import { CAPPED_TASK_STATUSES, effectiveCoverage, CoverageDimensions, CoverageQuotas, generateSlots, OPEN_TASK_STATUSES, pickSlot } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import type { TemplateRef } from './definitions';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
export const WORKABLE_PROJECT = ['STAFFING', 'STAFFED', 'IN_PROGRESS'] as const;
/** Expert work; RL_REVIEW tasks (FLOW 4) belong to internal Reviewers and never mix with project work. */
export const EXPERT_TASK_TYPES = { in: ['AUTHORING', 'ANNOTATION'] as ('AUTHORING' | 'ANNOTATION')[] };

export async function templateRef(tx: Db | Tx, templateId: string): Promise<TemplateRef> {
  const t = await tx.template.findUniqueOrThrow({ where: { id: templateId }, include: { domain: true } });
  const matrix = CoverageDimensions.safeParse(t.coverageDimensions).data ?? { dimensions: [], cells: [] };
  const edges = (Array.isArray(t.edgeCaseCatalog) ? t.edgeCaseCatalog : []) as { name?: string }[];
  return {
    workflowName: t.workflowName,
    domainName: t.domain.name,
    taskDefinitionSchema: t.taskDefinitionSchema,
    collectionSchema: t.collectionSchema,
    coverageDimensions: matrix.dimensions,
    edgeCases: edges.map((e) => e.name ?? '').filter(Boolean),
  };
}

/** Coverage slots for an authoring project, generated once (SPEC: on project submit). Idempotent. */
export async function ensureSlots(tx: Tx, projectId: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { template: true } });
  if (p.taskMode !== 'AUTHORING' || !p.distinctTarget) return 0;
  if (await tx.coverageSlot.count({ where: { projectId } })) return 0;
  const cov = effectiveCoverage(p.template, CoverageQuotas.nullable().safeParse(p.coverageQuotas).data ?? null);
  const matrix = CoverageDimensions.safeParse(p.template.coverageDimensions).data ?? { dimensions: [], cells: [] };
  const slots = generateSlots({
    dimensions: matrix.dimensions,
    cells: cov.cells,
    edgeCases: cov.edgeCases,
    distinctTarget: p.distinctTarget,
    openSlotShare: Number(p.openSlotShare ?? p.template.openSlotShare),
  });
  await tx.coverageSlot.createMany({
    data: slots.map((s, position) => ({
      clientId: p.clientId,
      projectId,
      coverageTags: { tags: s.tags, edgeCase: s.edgeCase } as Prisma.InputJsonValue,
      isOpen: s.isOpen,
      required: s.required,
      position,
      brief: s.brief,
    })),
  });
  return slots.length;
}

/** The candidate's accepted place on the project, or null. A direct (stub-gate) assignment counts as accepted. */
export async function activeAssignment(tx: Db | Tx, projectId: string, candidateId: string) {
  const pa = await tx.projectAssignment.findUnique({ where: { projectId_candidateId: { projectId, candidateId } }, include: { smeAssignment: true } });
  if (!pa || pa.releasedAt) return null;
  if (pa.smeAssignment && !['ACCEPTED', 'HANDED_OFF'].includes(pa.smeAssignment.status)) return null;
  return pa;
}

/**
 * Issues up to `want` tasks to a candidate (SPEC FLOW 3 task generation). Authoring: one task per coverage slot the
 * expert's scope fits, never two identical slots, within the per-expert cap. Annotation: from the shared queue.
 * Both respect the concurrent open-task cap. Serialised per project so two experts never get the same slot.
 */
export async function allocateTasks(tx: Tx, args: { projectId: string; candidateId: string; want: number }, audit: Audit): Promise<TaskInstance[]> {
  await tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${args.projectId}::uuid FOR UPDATE`;
  const p = await tx.project.findUniqueOrThrow({ where: { id: args.projectId } });
  if (!(WORKABLE_PROJECT as readonly string[]).includes(p.status)) throw new AppError(409, 'PROJECT_NOT_ACTIVE', `This project is ${p.status.toLowerCase().replace(/_/g, ' ')}; no new tasks can be issued.`);
  const pa = await activeAssignment(tx, p.id, args.candidateId);
  if (!pa) throw new AppError(409, 'NOT_ASSIGNED', 'You are not assigned to this project.');

  const mine = await tx.taskInstance.findMany({ where: { projectId: p.id, assignedToId: args.candidateId }, include: { slot: true } });
  const open = mine.filter((t) => (OPEN_TASK_STATUSES as readonly string[]).includes(t.status)).length;
  let room = Math.min(args.want, p.openTaskCapPerCandidate - open);
  if (p.taskMode === 'AUTHORING') {
    const capped = mine.filter((t) => (CAPPED_TASK_STATUSES as readonly string[]).includes(t.status)).length;
    room = Math.min(room, (p.maxPerExpert ?? 0) - capped);
  }
  if (room <= 0) return [];

  const issued: TaskInstance[] = [];
  const now = new Date();
  if (p.taskMode === 'AUTHORING') {
    await ensureSlots(tx, p.id);
    const scope = (pa.smeAssignment?.scope ?? {}) as { jurisdictions?: string[] };
    const held = mine
      .filter((t) => t.slot && (CAPPED_TASK_STATUSES as readonly string[]).includes(t.status))
      .map((t) => ({ ...(t.slot!.coverageTags as { tags: Record<string, string>; edgeCase: string | null }), isOpen: t.slot!.isOpen }));
    const rows = await tx.coverageSlot.findMany({ where: { projectId: p.id, status: { in: ['OPEN', 'RELEASED'] } }, orderBy: { position: 'asc' } });
    const available = rows.map((r) => ({ ...(r.coverageTags as { tags: Record<string, string>; edgeCase: string | null }), id: r.id, isOpen: r.isOpen, required: r.required, row: r }));
    for (let n = 0; n < room; n++) {
      const s = pickSlot(available, held, { jurisdictions: scope.jurisdictions ?? [] });
      if (!s) break;
      available.splice(available.indexOf(s), 1);
      held.push({ tags: s.tags, edgeCase: s.edgeCase, isOpen: s.isOpen });
      await tx.coverageSlot.update({ where: { id: s.id }, data: { status: 'OFFERED', assignedToId: args.candidateId } });
      const input = { slot: { id: s.id, brief: s.row.brief, tags: s.tags, edgeCase: s.edgeCase, isOpen: s.isOpen } } as Prisma.InputJsonValue;
      // A reclaimed task on this slot is reused (cleared); otherwise a new one is created.
      const reuse = await tx.taskInstance.findFirst({ where: { slotId: s.id, status: 'CREATED', assignedToId: null } });
      const data = { status: 'ASSIGNED' as const, assignedToId: args.candidateId, projectAssignmentId: pa.id, assignedAt: now, input, output: Prisma.DbNull, checks: Prisma.DbNull, flags: Prisma.DbNull, coverageTags: { tags: s.tags, edgeCase: s.edgeCase } as Prisma.InputJsonValue };
      if (reuse?.output && (reuse.input as { syntheticExample?: boolean }).syntheticExample === true) {
        Object.assign(data, { output: reuse.output, input: { ...input as object, syntheticExample: true } });
      }
      const t = reuse
        ? await tx.taskInstance.update({ where: { id: reuse.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.taskInstance.create({ data: { ...data, clientId: p.clientId, projectId: p.id, taskType: 'AUTHORING', slotId: s.id } });
      issued.push(t);
    }
  } else {
    const queued = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "TaskInstance" WHERE project_id = ${p.id}::uuid AND task_type = 'ANNOTATION' AND status = 'CREATED' AND assigned_to_id IS NULL
      ORDER BY created_at, id LIMIT ${room} FOR UPDATE SKIP LOCKED`;
    for (const q of queued) {
      issued.push(await tx.taskInstance.update({ where: { id: q.id }, data: { status: 'ASSIGNED', assignedToId: args.candidateId, projectAssignmentId: pa.id, assignedAt: now, revision: { increment: 1 } } }));
    }
  }
  for (const t of issued) {
    await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.issued', after: { projectId: p.id, candidateId: args.candidateId, slotId: t.slotId, status: 'ASSIGNED' } });
  }
  if (issued.length) await markInProgressIfStarted(tx, p.id, audit);
  return issued;
}

/** SPEC status model: STAFFED → IN_PROGRESS once the first task instance is issued. */
export async function markInProgressIfStarted(tx: Tx, projectId: string, audit: Audit) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  if (p.status !== 'STAFFED') return false;
  const started = await tx.taskInstance.count({ where: { projectId, taskType: EXPERT_TASK_TYPES, status: { not: 'CREATED' } } });
  if (!started) return false;
  const { count } = await tx.project.updateMany({ where: { id: projectId, status: 'STAFFED' }, data: { status: 'IN_PROGRESS' } });
  if (count) await audit({ entityType: 'Project', entityId: projectId, action: 'project.started', before: { status: 'STAFFED' }, after: { status: 'IN_PROGRESS' } });
  return count > 0;
}

/**
 * A PM takes back a stalled task (SPEC): it returns to CREATED and the queue, its slot is released for another expert,
 * and the author's draft is cleared. TPT alone never expires a task.
 */
export async function reclaimTask(tx: Tx, args: { projectId: string; taskId: string; reason: string; note?: string }, audit: Audit) {
  const t = await tx.taskInstance.findFirst({ where: { id: args.taskId, projectId: args.projectId, taskType: EXPERT_TASK_TYPES } });
  if (!t) throw notFound('Task not found');
  if (!['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) throw new AppError(409, 'NOT_RECLAIMABLE', `A ${t.status.toLowerCase()} task cannot be reclaimed.`);
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, revision: t.revision },
    data: { status: 'CREATED', assignedToId: null, projectAssignmentId: null, assignedAt: null, startedAt: null, output: Prisma.DbNull, checks: Prisma.DbNull, flags: Prisma.DbNull, activeSeconds: 0, revision: { increment: 1 } },
  });
  if (!count) throw new AppError(409, 'STALE_REVISION', 'The task changed meanwhile; reload and try again.');
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'RELEASED', assignedToId: null } });
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.reclaimed', before: { status: t.status, assignedToId: t.assignedToId }, after: { status: 'CREATED', reason: args.reason, note: args.note ?? null } });
}
