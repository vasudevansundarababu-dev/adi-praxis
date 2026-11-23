import type { ApprovedTaskRecord, Prisma, TaskInstance, Template } from '@prisma/client';
import { EXECUTABLE_WORKFLOW, praxisContractChecks, type TaskCheck } from '@praxis/shared';
import { jointTemplateSpec } from '../anvil/joint-template';
import { AUTHOR_FIXABLE_PACKAGE, taskPackageProblem } from '../anvil/generic-package';
import { STEP_TOOL_SECTION, TOOL_UNDECLARED } from '../anvil/tool-binding';
import type { Tx } from '../db';
import type { AuditInput } from '../platform/audit';
import { authoredContent, compileForSubmission } from './profile-output';
import { blocking, evaluateTask, type StoredChecks } from './submission';

/**
 * D18 (owner, 16 Nov 2026): "If validation fails even if its approved then we need make the task needed for re work."
 *
 * Every approval (one-step accept, Reviewer pass, PM approval; console and candidate app) and every RL Gym export first
 * re-runs the task's submit checks and the per-task export package checks on the exact content being approved or
 * exported. Any blocking failure stops the approval or export: the task goes to Rework with the failing checks as
 * comments pinned to their sections, so the author sees what to fix. Warnings never block. The checks are
 * deterministic; the approval itself, and every later decision, stays with a person.
 *
 * Nothing here edits the append-only dataset: a task with an approved record that fails at export goes back to Rework
 * as a new revision, its earlier record stays, and the record of its next approval replaces it in exports.
 */

type Audit = (i: AuditInput) => Promise<void>;

/** Checks that attest the author's own actions at submission (consent, declarations, section confirmations). */
const AUTHOR_ATTESTATION = (id: string) => id.startsWith('authoring.') || id.startsWith('conversation.') || id.startsWith('suggestions.confirmed.');


export type RevalidationTask = Pick<TaskInstance, 'id' | 'clientId' | 'projectId' | 'taskType' | 'output' | 'input' | 'drafting' | 'revision' | 'checks'> & { project: { template: Template } };

/** The optional check families that ran at submission; tasks submitted before D18 infer the rubric family from their results. */
export function checkOptions(checks: unknown): { rubricChecks: boolean; suggestionChecks: boolean } {
  const stored = checks as StoredChecks | null;
  if (stored?.options) return stored.options;
  return { rubricChecks: (stored?.results ?? []).some((c) => c.id.startsWith('rubric.') || c.id === 'policy.library-reference'), suggestionChecks: false };
}

/**
 * The per-task export checks: the contract compile of a profile-driven task (warnings: an earlier owner decision lets a
 * task with compile blockers be approved) and the RL Gym generic package entry (blocking when the author can fix it).
 */
export function exportPackageChecks(template: Template, task: Pick<TaskInstance, 'id' | 'taskType' | 'input' | 'revision'>, output: unknown, record?: Pick<ApprovedTaskRecord, 'id' | 'contentHash'>): TaskCheck[] {
  if (task.taskType !== 'AUTHORING' || !output || typeof output !== 'object') return [];
  const checks: TaskCheck[] = [];
  const authored = authoredContent(output) as Record<string, unknown>;
  const compiled = compileForSubmission(template, authored, { taskId: task.id, revisionId: `${task.id}-r${task.revision}` });
  if (compiled?.status.status === 'blocked') {
    // Owner decision (golden KYC, 12 Nov 2026): a blocked contract compile never blocks the task; shown, not blocking.
    for (const b of compiled.status.blockers) checks.push({ id: `export.${b.code}`, section: sectionOf(b.path), ok: false, severity: 'warning', message: `RL Gym export: ${b.message} (${b.path})` });
  }
  if (jointTemplateSpec(template)) {
    const pseudo = { id: record?.id ?? `pending-${task.id}`, taskInstanceId: task.id, output, input: task.input, contentHash: record?.contentHash ?? '0'.repeat(64) } as unknown as ApprovedTaskRecord;
    const p = taskPackageProblem({ record: pseudo, template });
    if (p && AUTHOR_FIXABLE_PACKAGE.has(p.code)) checks.push({ id: `export.${p.code}`, section: p.code.startsWith('GENERIC_CASE_SELECTOR_') ? 'S1' : p.code === 'GENERIC_GRAPH_INVALID' ? 'S2' : p.code === TOOL_UNDECLARED ? STEP_TOOL_SECTION : 'W06', ok: false, message: `RL Gym export: ${p.message}` });
  }
  return checks;
}

/**
 * Owner (23 Nov 2026): approval runs the same package check as Validate. A problem the author can fix is a blocking
 * check (the task goes back to them, D18); any other problem (the template's form, or Authoring itself) stops the
 * approval with a plain message instead, because sending the task to its author would not help.
 */
export function approvalExportBlocker(template: Template, task: Pick<TaskInstance, 'id' | 'taskType' | 'input'>, output: unknown): string | null {
  if (task.taskType !== 'AUTHORING' || !output || typeof output !== 'object' || !jointTemplateSpec(template)) return null;
  const pseudo = { id: `pending-${task.id}`, taskInstanceId: task.id, output, input: task.input, contentHash: '0'.repeat(64) } as unknown as ApprovedTaskRecord;
  const p = taskPackageProblem({ record: pseudo, template });
  if (!p || AUTHOR_FIXABLE_PACKAGE.has(p.code)) return null;
  return `This task can’t be approved yet: the benchmark could not receive it. ${p.message} This is not something the author can fix; Validate shows the same problem. Ask your Admin to raise it with Studio.`;
}

const sectionOf = (path: string) => /^(S\d+)\b/.exec(path)?.[1] ?? (path.startsWith('rubric') ? 'W05' : 'W06');

/**
 * Re-runs the submit checks (author attestations excepted: they record what the author did at submission) and the
 * export package checks on `output` (default: the task's current output). Returns every check and the blocking ones.
 */
export async function revalidateTask(tx: Tx, t: RevalidationTask, output: unknown = t.output, record?: Pick<ApprovedTaskRecord, 'id' | 'contentHash'>) {
  const authored = authoredContent(output);
  const ev = await evaluateTask(tx, { ...t, output: authored as Prisma.JsonValue }, checkOptions(t.checks));
  const all = [
    ...ev.checks.filter((c) => !AUTHOR_ATTESTATION(c.id)),
    ...praxisContractChecks((output ?? {}) as Record<string, unknown>, t.project.template.workflowName === EXECUTABLE_WORKFLOW),
    ...exportPackageChecks(t.project.template, t, output, record),
  ];
  const seen = new Set<string>();
  const checks = all.filter((c) => {
    const key = `${c.id}|${c.section}|${c.ok}|${c.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { checks, failing: checks.filter(blocking) };
}

/** What a blocked approval answers: committed (the task is in Rework), shown to the Reviewer as an error. */
export interface ApprovalBlocked {
  status: 'REWORK';
  approvalBlocked: true;
  version: number;
  checks: TaskCheck[];
}

export const reworkMessage = (trigger: 'approval' | 'export', n: number) =>
  `${trigger === 'approval' ? 'Approval' : 'Export'} blocked: the task fails ${n} check${n === 1 ? '' : 's'}, so it went back to the author for rework.`;

/** Comments for the author: each failing check under its section. */
const reasons = (failing: TaskCheck[]) => failing.map((c) => ({ section: c.section, text: c.message, checkId: c.id, source: 'validation' }));

/**
 * Moves a task to Rework because re-validation failed: an append-only TaskReview (REWORK, the failing checks as
 * comments) by the person whose approval or export triggered it, the re-run checks stored on the task, the audit
 * event. Only from the expected status (idempotent under a retry: a second call changes nothing and returns false).
 */
export async function reworkForValidation(
  tx: Tx,
  t: RevalidationTask & { status: string; reviewStage: string | null; slotId: string | null },
  args: { trigger: 'approval' | 'export'; actorId: string; version: number; checks: TaskCheck[]; failing: TaskCheck[]; stage?: 'EXPERT_REVIEW' | 'PM_APPROVAL' | null; contentHash?: string; recordId?: string; byUser?: boolean; auditExtra?: Record<string, unknown> },
  audit: Audit,
) {
  const from = t.status;
  if (from !== 'SUBMITTED' && from !== 'ACCEPTED') return false;
  const notes = reworkMessage(args.trigger, args.failing.length);
  const prev = (t.checks ?? {}) as unknown as StoredChecks;
  const stored: StoredChecks = {
    ...prev,
    results: [...(prev.results ?? []).filter((c) => AUTHOR_ATTESTATION(c.id)), ...args.checks],
    revalidation: { trigger: args.trigger, at: new Date().toISOString(), failing: args.failing.map((c) => c.id) },
  };
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, status: from, revision: t.revision },
    data: {
      status: 'REWORK',
      reviewStage: null,
      reworkCount: { increment: 1 },
      revision: { increment: 1 },
      reviewNotes: notes,
      checks: stored as unknown as Prisma.InputJsonValue,
      ...(args.byUser ? { reviewerId: args.actorId } : {}),
    },
  });
  if (!count) return false;
  await tx.taskReview.create({
    data: {
      clientId: t.clientId,
      taskInstanceId: t.id,
      submissionVersion: args.version,
      reviewerId: args.actorId,
      decision: 'REWORK',
      stage: args.stage ?? null,
      ...(args.contentHash ? { contentHash: args.contentHash } : {}),
      checklist: {},
      comments: reasons(args.failing) as Prisma.InputJsonValue,
      notes,
    },
  });
  // An approved task back in Rework no longer fills its slot; its author keeps it.
  if (from === 'ACCEPTED' && t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
  await audit({
    entityType: 'TaskInstance',
    entityId: t.id,
    action: 'task.rework_validation_failed',
    before: { status: from, ...(t.reviewStage ? { stage: t.reviewStage } : {}) },
    after: { status: 'REWORK', trigger: args.trigger, version: args.version, failingChecks: args.failing.map((c) => c.id), ...(args.recordId ? { recordId: args.recordId, recordKept: true } : {}), ...(args.auditExtra ?? {}) },
  });
  return true;
}

/** Route reply for a decision: a blocked approval is committed (the task is in Rework) and answered as 422. */
export function decisionReply<T extends object>(r: T | ApprovalBlocked): { status: number; body: unknown } {
  if ('approvalBlocked' in r && r.approvalBlocked) {
    const problems = r.checks.map((c) => `${c.section}: ${c.message}`);
    return { status: 422, body: { error: 'APPROVAL_BLOCKED', message: `${reworkMessage('approval', r.checks.length)} ${problems.join(' · ')}`, details: { status: 'REWORK', version: r.version, checks: r.checks, problems } } };
  }
  return { status: 200, body: r };
}
