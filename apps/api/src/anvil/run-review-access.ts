import type { Db, Tx } from '../db';

/**
 * D-004 (owner, 23 Nov 2026): who reviews RL Gym run results, and what each person's inbox (header bell) shows.
 * - Run results of a task are verified by PM/Admin, or by the SME a PM/Admin assigned: the task's author or an SME
 *   Reviewer on the project. Assignment is per task within a batch; the latest assignment is in force.
 * - The staff bell is for PM and Admin; the SME bell shows the SME's Rework and the run reviews assigned to them.
 * Items disappear when their work is done; there is no separate read state.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The episodes of a batch body, grouped by the task they belong to (same reading as the batch route). */
export function batchTasks(body: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of (isObj(body) && Array.isArray(body.tasks) ? body.tasks : []).filter(isObj))
    for (const e of (Array.isArray(t.episodes) ? t.episodes : []).filter(isObj)) {
      const itemId = typeof e.item_id === 'string' && e.item_id ? e.item_id : typeof e.episode_id === 'string' ? e.episode_id : '';
      if (!itemId) continue;
      const taskId = String(t.task_id ?? '');
      out.set(taskId, [...(out.get(taskId) ?? []), itemId]);
    }
  return out;
}

/** The assignment in force per task: the latest row (rows must be in creation order). */
export function currentAssignees(rows: { taskId: string; smeUserId: string; createdAt: Date }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) out.set(r.taskId, r.smeUserId);
  return out;
}

export interface EligibleReviewer {
  smeUserId: string;
  name: string;
  role: 'author' | 'reviewer';
}

const nameOf = (u: { displayName: string | null; contactEmail: string | null } | null, fallback: string) => u?.displayName || u?.contactEmail || fallback;

/** Per task: its author (the SME it is assigned to) and the project's SME Reviewers, author first. */
export async function eligibleReviewers(db: Db | Tx, clientId: string, projectId: string, taskIds: string[]): Promise<Map<string, EligibleReviewer[]>> {
  const ids = taskIds.filter(isUuid);
  const tasks = ids.length ? await db.taskInstance.findMany({ where: { id: { in: ids }, clientId, projectId }, select: { id: true, assignedTo: { select: { smeUserId: true, smeUser: { select: { displayName: true, contactEmail: true } } } } } }) : [];
  const reviewers = await db.sourcedPerson.findMany({ where: { clientId, projectId, role: 'REVIEWER', smeUserId: { not: null }, releasedAt: null }, select: { smeUserId: true, firstName: true, lastName: true, smeUser: { select: { displayName: true, contactEmail: true } } }, orderBy: { createdAt: 'asc' } });
  const out = new Map<string, EligibleReviewer[]>();
  for (const id of taskIds) {
    const t = tasks.find((x) => x.id === id);
    const list: EligibleReviewer[] = [];
    if (t?.assignedTo) list.push({ smeUserId: t.assignedTo.smeUserId, name: nameOf(t.assignedTo.smeUser, 'Author'), role: 'author' });
    for (const r of reviewers) if (r.smeUserId && !list.some((l) => l.smeUserId === r.smeUserId)) list.push({ smeUserId: r.smeUserId, name: nameOf(r.smeUser, `${r.firstName} ${r.lastName}`.trim()), role: 'reviewer' });
    out.set(id, list);
  }
  return out;
}

/** The run reviews assigned to this SME: per batch, only the episodes of the tasks currently assigned to them. */
export async function assignedRunReviews(db: Db, clientId: string, smeUserId: string) {
  const batches = await db.runReviewBatch.findMany({ where: { clientId, assignments: { some: { smeUserId } } }, orderBy: { createdAt: 'desc' }, include: { decisions: true, assignments: true } });
  const projects = await db.project.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.projectId))] }, clientId }, select: { id: true, name: true } });
  return batches.flatMap((b) => {
    const mine = [...currentAssignees(b.assignments)].filter(([, sme]) => sme === smeUserId).map(([taskId]) => taskId);
    if (!mine.length) return [];
    const body = b.body as Record<string, unknown>;
    const items = (Array.isArray(body.tasks) ? body.tasks : []).filter(isObj).filter((t) => mine.includes(String(t.task_id ?? ''))).flatMap((t) =>
      (Array.isArray(t.episodes) ? t.episodes : []).filter(isObj).flatMap((e) => {
        const itemId = typeof e.item_id === 'string' && e.item_id ? e.item_id : typeof e.episode_id === 'string' ? e.episode_id : '';
        if (!itemId) return [];
        const d = b.decisions.find((x) => x.itemId === itemId);
        // suspected_cause is the RL Gym's hint only; a person decides.
        return [{ itemId, taskId: String(t.task_id ?? ''), revision: Number(t.revision ?? 1), episode: e, decision: d ? { decision: d.decision, rationale: d.rationale, criterionId: d.criterionId, decidedBy: d.decidedBy, at: d.createdAt.toISOString() } : null }];
      }),
    );
    return [{ ref: b.forgeBatchRef, batchId: b.batchId, runId: b.runId, projectId: b.projectId, projectName: projects.find((p) => p.id === b.projectId)?.name ?? 'Project', receivedAt: b.createdAt.toISOString(), rubric: body.rubric ?? [], items }];
  });
}

export interface InboxItem {
  kind: string;
  title: string;
  detail: string;
  href: string;
  count: number;
}

/** PM and Admin: tasks waiting for approval, run-review tasks with no reviewer or not decided yet, open SME needs. */
export async function staffInbox(db: Db, clientId: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  const submitted = await db.taskInstance.groupBy({ by: ['projectId'], where: { clientId, status: 'SUBMITTED', OR: [{ reviewStage: null }, { reviewStage: 'PM_APPROVAL' }] }, _count: { _all: true } });
  const batches = await db.runReviewBatch.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' }, include: { decisions: { select: { itemId: true } }, assignments: true } });
  const needs = await db.smeNeed.groupBy({ by: ['projectId'], where: { clientId, state: 'open' }, _count: { _all: true } });
  const projectIds = [...new Set([...submitted.map((s) => s.projectId), ...batches.map((b) => b.projectId), ...needs.map((n) => n.projectId)])];
  const names = new Map((await db.project.findMany({ where: { id: { in: projectIds }, clientId }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  for (const s of submitted) {
    const name = names.get(s.projectId);
    if (name) items.push({ kind: 'tasks_to_approve', title: `${plural(s._count._all, 'task')} to review or approve`, detail: name, href: `/projects/${s.projectId}?tab=tasks`, count: s._count._all });
  }
  for (const b of batches) {
    const name = names.get(b.projectId);
    if (!name) continue;
    const decided = new Set(b.decisions.map((d) => d.itemId));
    const current = currentAssignees(b.assignments);
    let unassigned = 0;
    let waiting = 0;
    for (const [taskId, itemIds] of batchTasks(b.body)) {
      const open = itemIds.filter((i) => !decided.has(i)).length;
      if (!open) continue;
      if (current.has(taskId)) waiting += open;
      else unassigned += 1;
    }
    const href = `/projects/${b.projectId}?tab=benchmark`;
    if (unassigned) items.push({ kind: 'run_review_unassigned', title: `Assign a reviewer to ${plural(unassigned, 'task')} in run review ${b.batchId}`, detail: `${name}${b.runId ? ` · run ${b.runId}` : ''}`, href, count: unassigned });
    if (waiting) items.push({ kind: 'run_review_waiting', title: `${plural(waiting, 'episode')} waiting for the assigned SME in ${b.batchId}`, detail: `${name}${b.runId ? ` · run ${b.runId}` : ''}`, href, count: waiting });
  }
  for (const n of needs) {
    const name = names.get(n.projectId);
    if (name) items.push({ kind: 'sme_needs', title: `${plural(n._count._all, 'SME need')} to merge, send or reject`, detail: name, href: `/projects/${n.projectId}?tab=benchmark`, count: n._count._all });
  }
  return items;
}

const titleOfOutput = (output: unknown) => {
  const s1 = isObj(output) && isObj(output.sections) && isObj(output.sections.S1) ? output.sections.S1 : {};
  return typeof s1.title === 'string' && s1.title.trim() ? s1.title.trim() : null;
};

/** The SME: own tasks in Rework (with the reason), and run reviews assigned to them that still have open episodes. */
export async function smeInbox(db: Db, clientId: string, smeUserId: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  const rework = await db.taskInstance.findMany({ where: { clientId, status: 'REWORK', assignedTo: { smeUserId } }, orderBy: { updatedAt: 'desc' }, select: { id: true, output: true, reviewNotes: true, project: { select: { name: true } } } });
  for (const t of rework) items.push({ kind: 'rework', title: `Rework: ${titleOfOutput(t.output) ?? t.project.name}`, detail: t.reviewNotes ?? 'Your reviewer sent this task back.', href: `/tasks/${t.id}`, count: 1 });
  for (const b of await assignedRunReviews(db, clientId, smeUserId)) {
    const open = b.items.filter((i) => !i.decision).length;
    if (open) items.push({ kind: 'run_review', title: `Review run results: ${plural(open, 'episode')}`, detail: `${b.projectName} · ${b.batchId}${b.runId ? ` · run ${b.runId}` : ''}`, href: '/run-reviews', count: open });
  }
  return items;
}
