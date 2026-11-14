import type { Db } from '../db';
import { writeAudit } from '../platform/audit';
import { caseSelectorOf, ensureSlots } from '../tasks/task-service';

/**
 * Rebuilds the coverage slots of a project whose template has a case selector (owner, 13 Nov 2026: one task per
 * state). Projects submitted before the selector was stored on the template got generic open slots; this replaces them
 * with one slot per value. Only while nothing has been issued: it refuses when the project has any task or any slot
 * that is not OPEN and unassigned, so no expert's work is touched. Dry run by default; audited as
 * `project.slots_rebuilt` (actor SYSTEM, `case-selector-slots`).
 */
export interface SlotRebuildReport {
  projectId: string;
  outcome: 'rebuilt' | 'would_rebuild' | 'already_per_value' | 'refused';
  reason?: string;
  before: { brief: string; tags: unknown }[];
  after: { brief: string; tags: unknown }[];
}

export async function rebuildCaseSelectorSlots(db: Db, args: { projectId: string; apply: boolean }): Promise<SlotRebuildReport> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${args.projectId}::uuid FOR UPDATE`;
    const p = await tx.project.findUniqueOrThrow({ where: { id: args.projectId }, include: { template: true } });
    const slots = await tx.coverageSlot.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' } });
    const before = slots.map((s) => ({ brief: s.brief, tags: s.coverageTags }));
    const refuse = (reason: string): SlotRebuildReport => ({ projectId: p.id, outcome: 'refused', reason, before, after: [] });
    const sel = caseSelectorOf(p.template.caseSelector);
    if (!sel) return refuse('The project’s template version has no case selector.');
    if (p.taskMode !== 'AUTHORING') return refuse('Only authoring projects have coverage slots.');
    const perValue = slots.length === sel.values.length && slots.every((s) => (s.coverageTags as { case?: { value?: string } }).case?.value === sel.values[s.position]);
    if (perValue) return { projectId: p.id, outcome: 'already_per_value', before, after: before };
    const tasks = await tx.taskInstance.count({ where: { projectId: p.id } });
    if (tasks) return refuse(`The project already has ${tasks} task(s); its slots are not rebuilt.`);
    const busy = slots.filter((s) => s.status !== 'OPEN' || s.assignedToId);
    if (busy.length) return refuse(`${busy.length} slot(s) are already offered or assigned.`);
    if (!args.apply) return { projectId: p.id, outcome: 'would_rebuild', before, after: sel.values.map((v) => ({ brief: `${sel.field}: ${v}`, tags: { tags: { [sel.field]: v }, edgeCase: null } })) };

    await tx.coverageSlot.deleteMany({ where: { projectId: p.id } });
    await ensureSlots(tx, p.id);
    const fresh = await tx.coverageSlot.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' } });
    const after = fresh.map((s) => ({ brief: s.brief, tags: s.coverageTags }));
    await writeAudit(tx, { clientId: p.clientId, actorType: 'SYSTEM', actorId: 'case-selector-slots' }, {
      entityType: 'Project',
      entityId: p.id,
      action: 'project.slots_rebuilt',
      before: { slots: before.length, open: slots.filter((s) => s.isOpen).length },
      after: { slots: after.length, field: sel.field, values: sel.values },
    });
    return { projectId: p.id, outcome: 'rebuilt', before, after };
  });
}
