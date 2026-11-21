import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import { jcs, jcsSha256 } from '../anvil/jcs';
import { taskAssetHashes } from '../anvil/generic-package';
import { jointHashes, jointTemplateSpec } from '../anvil/joint-template';
import { declaredToolIds, undeclaredTools } from '../anvil/tool-binding';
import type { Db, Tx } from '../db';
import { emitEvent } from '../outbox/outbox';
import { writeAudit, type AuditInput } from '../platform/audit';
import { snapshotTask } from '../policy/task-policy';
import { authoredContent } from '../tasks/profile-output';
import { checkOptions, revalidateTask } from '../tasks/revalidation';
import type { StoredChecks } from '../tasks/submission';

/**
 * KYC v8 tool-binding correction (RL Gym's request of 20 Nov 2026; owner decisions APR-13a-d). RL Gym's importer
 * refused 9 procedure-step tools of 3 approved v8 tasks that v8's `execution.tools` does not declare
 * (`PX_TOOL_CALL_MISSING`). The owner approved 7 exact rebindings (APR-13a), a blank tool for the 2 pending-TIN steps
 * with capability gap CG-01 (APR-13b; v8 is not changed), and a one-time correction through successor revisions that
 * the owner reviews and approves in the console (APR-13c).
 *
 * The job uses the supported revision path for an approved task (D18): the task leaves Accepted (or Rework) as a new
 * submitted version whose only difference is the listed `S5.steps[i].tool` values; its approved record stays as it is
 * (append-only), is no longer exported while the task awaits review, and the record a person writes by approving the
 * revision in the console replaces it in exports. Nothing here writes or extends an approval.
 *
 * Dry run by default; `--apply` writes. Authorised (an active Admin asks), audited (actor SYSTEM, this job, with the
 * Admin's user ID), idempotent (a task that already carries this correction is reported, not touched), all or nothing
 * (any refused precondition writes nothing).
 */

const ACTOR = 'kyc-v8-tool-binding';
export const TOOL_BINDING_SCHEMA = 'adi-forge.tool-binding-correction.v1';
const POINTER = /^\/authored\/sections\/S5\/steps\/(\d+)\/tool$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface BindingChange {
  /** JSON pointer in the task's private `reference.json` (RL Gym's notation). */
  pointer: string;
  old: string;
  new: string;
  justification: string;
  approval: string;
  capabilityGap?: string;
}
export interface BindingTask {
  title: string;
  applicationType: string;
  taskId: string;
  predecessorRecordId: string;
  changes: BindingChange[];
}
export interface ApprovalRecord {
  id: string;
  what: string;
  decision: string;
  approved_by: string;
  approved_at: string;
  status: string;
}
export interface CapabilityGap {
  id: string;
  title: string;
  status: string;
  detail: string;
  disposition: string;
}
export interface ToolBindingSpec {
  projectId: string;
  templateVersionId: string;
  templateSha256: string;
  request: Record<string, string>;
  approvals: ApprovalRecord[];
  capabilityGaps: CapabilityGap[];
  tasks: BindingTask[];
  unchanged: { title: string; applicationType: string; taskId: string; recordId: string }[];
}

const CG01 = 'CG-01';
const just = {
  read: 'Reads the application record: application.read is the declared tool that returns it.',
  docs: 'Checks the identity documents are present: document.check is the declared generic document-presence check.',
  identity: 'Looks up the identity: identity.check compares the name and birth date on the identity evidence.',
  screening: 'Watchlist and PEP screening: screening.check is the declared screening tool.',
  recommend: 'Submits the KYC assessment: recommend is the declared tool that records the recommendation.',
  address: 'Verifies the address evidence: address.check checks that it matches and is no more than 90 days old.',
  tin: 'Pending TIN application verification: v8 declares no TIN capability, so the tool is left blank (the field is optional); the step action and failure handling are unchanged. Capability gap CG-01.',
};

/** The owner's decisions of 20 Nov 2026 (shared notes `kyc-v8-tool-binding-correction.md`), exactly. */
export const KYC_V8_TOOL_BINDING: ToolBindingSpec = {
  projectId: 'caddc6b4-2d34-47f2-8196-d73da6285ca0',
  templateVersionId: 'a6e20c93-7d00-4633-9847-5ec8ef5b75a0',
  templateSha256: '8449adb008b6ecea7858b594dd5765f60b9b9596b57568d25f5e0598a334f7d5',
  request: {
    from: 'RL Gym',
    document: 'KYC-V8-AUTHORING-TOOL-BINDING-CORRECTION.md',
    exportZip: 'praxis-b9a97d32f74db519950ca71d-p1.zip',
    exportZipSha256: 'ced49fece4cc9d0ad46b7c3a3b1d3ab4f15ffbf2a33e03646e0bb74595674f60',
    errorCode: 'PX_TOOL_CALL_MISSING',
  },
  approvals: [
    { id: 'APR-13a', what: 'The 7 exact S5 tool rebindings of the approved KYC v8 tasks to tools v8 declares.', decision: 'Approved', approved_by: 'Product Owner (ADI Forge owner)', approved_at: '2026-11-20', status: 'approved' },
    { id: 'APR-13b', what: 'The 2 pending-TIN steps keep their action and failure handling with a blank tool; capability gap CG-01 goes to the Template Studio; v8 is not changed.', decision: 'Approved', approved_by: 'Product Owner (ADI Forge owner)', approved_at: '2026-11-20', status: 'approved' },
    { id: 'APR-13c', what: 'One-time correction of approved v8 tasks through successor revisions; originals unchanged; only S5 tool values change, so SMEs are not involved; the owner reviews and approves each revision in the console.', decision: 'Approved', approved_by: 'Product Owner (ADI Forge owner)', approved_at: '2026-11-20', status: 'approved' },
  ],
  capabilityGaps: [
    {
      id: CG01,
      title: 'Pending TIN application verification',
      status: 'open',
      detail: 'KYC v8 declares no tool that verifies a pending TIN application, and RL Gym’s KYC engine has no TIN or pending-TIN concept.',
      disposition: 'Template Studio enhancement request for a future release (for example a tin.check tool); v8 is not changed.',
    },
  ],
  tasks: [
    {
      title: 'Individual',
      applicationType: 'individual',
      taskId: 'bdbda764-eabc-40bf-82d8-cfd94277b9f8',
      predecessorRecordId: 'd032f505-b527-4fe5-968a-f8811ce8280b',
      changes: [
        { pointer: '/authored/sections/S5/steps/0/tool', old: 'get_application_record', new: 'application.read', justification: just.read, approval: 'APR-13a' },
        { pointer: '/authored/sections/S5/steps/1/tool', old: 'verify_identity_documents', new: 'document.check', justification: just.docs, approval: 'APR-13a' },
        { pointer: '/authored/sections/S5/steps/2/tool', old: 'lookup_identity_registry', new: 'identity.check', justification: just.identity, approval: 'APR-13a' },
        { pointer: '/authored/sections/S5/steps/3/tool', old: 'screen_watchlists_and_pep', new: 'screening.check', justification: just.screening, approval: 'APR-13a' },
        { pointer: '/authored/sections/S5/steps/4/tool', old: 'submit_kyc_assessment', new: 'recommend', justification: just.recommend, approval: 'APR-13a' },
      ],
    },
    {
      title: 'Teen joint',
      applicationType: 'teen_joint',
      taskId: '2291de2d-5d6c-41fe-9d8d-e95278f3f3e8',
      predecessorRecordId: '1296b117-462f-4937-a333-207f6ffc6504',
      changes: [
        { pointer: '/authored/sections/S5/steps/1/tool', old: 'document.verify', new: 'address.check', justification: just.address, approval: 'APR-13a' },
        { pointer: '/authored/sections/S5/steps/2/tool', old: 'document.verify', new: '', justification: just.tin, approval: 'APR-13b', capabilityGap: CG01 },
      ],
    },
    {
      title: 'Custodial',
      applicationType: 'custodial',
      taskId: 'e63aee92-4f4f-4624-9ef2-d4fd0e9d6c5a',
      predecessorRecordId: '67ba81a9-6869-4df6-9636-e6d556509533',
      changes: [
        { pointer: '/authored/sections/S5/steps/1/tool', old: 'address_verification.check', new: 'address.check', justification: just.address, approval: 'APR-13a' },
        { pointer: '/authored/sections/S5/steps/2/tool', old: 'tin_verification.check', new: '', justification: just.tin, approval: 'APR-13b', capabilityGap: CG01 },
      ],
    },
  ],
  unchanged: [{ title: 'Adult joint', applicationType: 'adult_joint', taskId: 'c71004ea-83a1-490f-b392-3c1283e5f407', recordId: 'a7bd89e2-ce67-47f0-8afa-6cca846fe1f7' }],
};

/** The approvals every revision carries: APR-13a, b and c (APR-13d is the recurrence check, not a task decision). */
const CARRIED_APPROVALS = ['APR-13a', 'APR-13b', 'APR-13c'] as const;

/** Applies a task's changes to a copy of the output; refuses on a pointer outside S5 step tools or an unexpected old value. */
export function applyBindings(output: unknown, changes: BindingChange[]): { output: Record<string, unknown> } | { problems: string[] } {
  if (!isObj(output) || !isObj(output.sections)) return { problems: ['The task has no sections.'] };
  const next = structuredClone(output) as Record<string, unknown> & { sections: Record<string, unknown> };
  const s5 = next.sections.S5;
  const steps = isObj(s5) && Array.isArray(s5.steps) ? (s5.steps as unknown[]) : null;
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    const m = POINTER.exec(c.pointer);
    if (!m) {
      problems.push(`${c.pointer} is not an S5 step tool; only S5.steps[i].tool may change.`);
      continue;
    }
    if (seen.has(c.pointer)) problems.push(`${c.pointer} is listed twice.`);
    seen.add(c.pointer);
    const step = steps?.[Number(m[1])];
    if (!isObj(step) || !('tool' in step)) {
      problems.push(`${c.pointer} does not exist in the approved content.`);
      continue;
    }
    if (step.tool !== c.old) {
      problems.push(`${c.pointer} is ${JSON.stringify(step.tool)}, not the expected old value ${JSON.stringify(c.old)}.`);
      continue;
    }
    step.tool = c.new;
  }
  return problems.length ? { problems } : { output: next };
}

export interface TaskPlan {
  title: string;
  taskId: string;
  predecessorRecordId: string;
  outcome: 'would_submit' | 'submitted' | 'already_submitted' | 'refused';
  reason?: string;
  status?: string;
  predecessorContentHash?: string;
  changes: { pointer: string; old: string; new: string; approval: string; capabilityGap?: string }[];
  predecessor?: { outputSha256: string; actorSha256: string | null; referenceSha256: string | null };
  successor?: { outputSha256: string; actorSha256: string; referenceSha256: string };
  failing?: { id: string; section: string; message: string }[];
  /** For an already-submitted correction: the record a person wrote by approving it, once they have. */
  successorRecordId?: string | null;
}
export interface ToolBindingReport {
  outcome: 'ok' | 'refused';
  reason?: string;
  projectId: string;
  templateVersionId: string;
  template_sha256?: string;
  declaredTools?: string[];
  approvals: string[];
  capabilityGaps: string[];
  tasks: TaskPlan[];
  unchanged: { title: string; taskId: string; recordId: string; toolCheck: 'pass' | 'fail' | 'not_checked'; reason?: string }[];
}

const declaredOf = (v8: Template) => declaredToolIds(jointTemplateSpec(v8)?.execution) ?? [];

function hashesOf(record: Pick<ApprovedTaskRecord, 'id' | 'taskInstanceId' | 'contentHash' | 'input'>, output: unknown, template: Template, opts: { checkTools?: boolean } = {}) {
  const pseudo = { ...record, output } as unknown as ApprovedTaskRecord;
  return taskAssetHashes({ record: pseudo, template }, opts);
}

export async function kycV8ToolBinding(db: Db, args: { requestedBy: string; apply: boolean; spec?: ToolBindingSpec }): Promise<ToolBindingReport> {
  const spec = args.spec ?? KYC_V8_TOOL_BINDING;
  return db.$transaction(
    async (tx) => {
      const report: ToolBindingReport = {
        outcome: 'refused',
        projectId: spec.projectId,
        templateVersionId: spec.templateVersionId,
        approvals: [...CARRIED_APPROVALS],
        capabilityGaps: spec.capabilityGaps.map((g) => g.id),
        tasks: spec.tasks.map((t) => ({ title: t.title, taskId: t.taskId, predecessorRecordId: t.predecessorRecordId, outcome: 'refused', changes: t.changes.map((c) => ({ pointer: c.pointer, old: c.old, new: c.new, approval: c.approval, ...(c.capabilityGap ? { capabilityGap: c.capabilityGap } : {}) })) })),
        unchanged: spec.unchanged.map((u) => ({ title: u.title, taskId: u.taskId, recordId: u.recordId, toolCheck: 'not_checked' })),
      };
      const refuse = (reason: string): ToolBindingReport => ({ ...report, outcome: 'refused', reason });

      const project = await tx.project.findUnique({ where: { id: spec.projectId } });
      if (!project) return refuse('The project was not found.');
      if (project.templateId !== spec.templateVersionId) return refuse('The project is not on the expected template version.');
      const v8 = await tx.template.findUnique({ where: { id: spec.templateVersionId } });
      const joint = v8 ? jointTemplateSpec(v8) : null;
      if (!v8 || !joint) return refuse('The template version was not found or has no joint template spec.');
      if (v8.status !== 'PUBLISHED') return refuse('The template version is not published.');
      const sha = jointHashes(joint).template_sha256;
      report.template_sha256 = sha;
      if (sha !== spec.templateSha256) return refuse(`The template version hashes to ${sha}, not ${spec.templateSha256}; it must be unchanged.`);
      const declared = declaredOf(v8);
      report.declaredTools = declared;
      if (!declared.length) return refuse('The template version declares no execution.tools.');
      const admin = await tx.user.findFirst({ where: { clientId: project.clientId, email: { equals: args.requestedBy, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
      if (!admin) return refuse('The requester must be an active Admin of this client.');
      for (const id of CARRIED_APPROVALS) if (!spec.approvals.some((a) => a.id === id && a.status === 'approved')) return refuse(`Approval ${id} is not recorded as approved.`);
      for (const t of spec.tasks)
        for (const c of t.changes) {
          if (c.new !== '' && !declared.includes(c.new)) return refuse(`${t.title} ${c.pointer}: "${c.new}" is not one of the template's execution.tools IDs.`);
          if (c.new === '' && !c.capabilityGap) return refuse(`${t.title} ${c.pointer}: a blank tool must name its capability gap.`);
          if (c.capabilityGap && !spec.capabilityGaps.some((g) => g.id === c.capabilityGap)) return refuse(`${t.title} ${c.pointer}: capability gap ${c.capabilityGap} is not recorded.`);
          if (!spec.approvals.some((a) => a.id === c.approval)) return refuse(`${t.title} ${c.pointer}: approval ${c.approval} is not recorded.`);
        }

      // The unchanged task: reported, and its tools must already conform.
      for (const [i, u] of spec.unchanged.entries()) {
        const rec = await tx.approvedTaskRecord.findUnique({ where: { id: u.recordId } });
        const row = report.unchanged[i]!;
        if (!rec || rec.taskInstanceId !== u.taskId) Object.assign(row, { toolCheck: 'fail', reason: 'The approved record was not found for this task.' });
        else {
          const bad = undeclaredTools(joint.execution, (authoredContent(rec.output) as { sections?: unknown }).sections);
          Object.assign(row, bad.length ? { toolCheck: 'fail', reason: `Undeclared tools at ${bad.map((b) => b.pointer).join(', ')}.` } : { toolCheck: 'pass' });
        }
      }

      // Plan every task first; any refusal writes nothing.
      type Ready = { plan: TaskPlan; task: NonNullable<Awaited<ReturnType<typeof loadTask>>>; record: ApprovedTaskRecord; output: Record<string, unknown>; lineage: Record<string, unknown>; stored: StoredChecks; spec: BindingTask };
      const ready: Ready[] = [];
      for (const [i, bt] of spec.tasks.entries()) {
        const plan = report.tasks[i]!;
        const task = await loadTask(tx, bt.taskId);
        if (!task || task.projectId !== project.id) {
          plan.reason = 'The task was not found in the project.';
          continue;
        }
        plan.status = task.status;
        const prior = (task.input as { toolBindingCorrection?: { predecessor?: { recordId?: string }; changes?: { pointer: string; old: string; new: string }[] } } | null)?.toolBindingCorrection;
        if (prior) {
          const same = prior.predecessor?.recordId === bt.predecessorRecordId && jcs((prior.changes ?? []).map((c) => [c.pointer, c.old, c.new])) === jcs(bt.changes.map((c) => [c.pointer, c.old, c.new]));
          if (!same) {
            plan.reason = 'The task already carries a different tool-binding correction.';
            continue;
          }
          const later = await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: task.id, seq: { gt: (await tx.approvedTaskRecord.findUnique({ where: { id: bt.predecessorRecordId }, select: { seq: true } }))?.seq ?? 0n } }, orderBy: { seq: 'desc' } });
          Object.assign(plan, { outcome: 'already_submitted', successorRecordId: later?.id ?? null });
          continue;
        }
        const record = await tx.approvedTaskRecord.findUnique({ where: { id: bt.predecessorRecordId } });
        if (!record || record.taskInstanceId !== task.id || record.projectId !== project.id || record.templateId !== v8.id) {
          plan.reason = 'The predecessor approved record was not found for this task, project and template version.';
          continue;
        }
        plan.predecessorContentHash = record.contentHash;
        if (await tx.approvedTaskRecord.count({ where: { supersedesId: record.id } })) {
          plan.reason = 'The predecessor record has been superseded; it is not the latest approved revision.';
          continue;
        }
        if (await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: task.id, seq: { gt: record.seq } } })) {
          plan.reason = 'The task has a later approved record; the predecessor is not the latest approved revision.';
          continue;
        }
        if (task.status !== 'ACCEPTED' && task.status !== 'REWORK') {
          plan.reason = `The task is ${task.status.toLowerCase()}, not accepted (or sent back after approval).`;
          continue;
        }
        if (jcs(task.output) !== jcs(record.output)) {
          plan.reason = 'The task’s content differs from its approved record.';
          continue;
        }
        if (jcs(authoredContent(record.output)) !== jcs(record.output)) {
          plan.reason = 'The approved content carries a compiled contract; this correction changes authored content only.';
          continue;
        }
        const applied = applyBindings(record.output, bt.changes);
        if ('problems' in applied) {
          plan.reason = applied.problems.join(' ');
          continue;
        }
        // Only the listed values changed: putting the old values back gives the approved bytes exactly.
        const back = applyBindings(applied.output, bt.changes.map((c) => ({ ...c, old: c.new, new: c.old })));
        if ('problems' in back || jcs(back.output) !== jcs(record.output)) throw new Error(`The correction of ${bt.title} changed more than its listed pointers.`);
        const still = undeclaredTools(joint.execution, applied.output.sections);
        if (still.length) {
          plan.reason = `After the correction, ${still.map((s) => `${s.pointer} "${String(s.value)}"`).join(', ')} would still not be a declared tool.`;
          continue;
        }
        const before = hashesOf(record, record.output, v8, { checkTools: false });
        const after = hashesOf(record, applied.output, v8);
        if ('code' in after) {
          plan.reason = `The corrected task would not package: ${after.message}`;
          continue;
        }
        plan.predecessor = { outputSha256: jcsSha256(record.output), actorSha256: 'code' in before ? null : before.actor, referenceSha256: 'code' in before ? null : before.reference };
        plan.successor = { outputSha256: jcsSha256(applied.output), actorSha256: after.actor, referenceSha256: after.reference };

        const options = checkOptions(task.checks);
        const rv = await revalidateTask(tx, { ...task, output: applied.output as Prisma.JsonValue, project: { template: v8 } });
        if (rv.failing.length) {
          Object.assign(plan, { reason: 'The corrected task does not pass the checks its approval re-runs.', failing: rv.failing.map((f) => ({ id: f.id, section: f.section, message: f.message })) });
          continue;
        }
        const prev = (task.checks ?? {}) as unknown as StoredChecks;
        const stored: StoredChecks = { ...prev, results: [...(prev.results ?? []).filter((c) => c.id.startsWith('authoring.') || c.id.startsWith('conversation.') || c.id.startsWith('suggestions.confirmed.')), ...rv.checks], options };
        const lineage = {
          schema: TOOL_BINDING_SCHEMA,
          predecessor: { recordId: record.id, taskId: record.taskInstanceId, contentHash: record.contentHash, seq: record.seq.toString(), reviewerId: record.reviewerId, reviewDecisionAt: record.reviewDecisionAt.toISOString(), outputSha256: plan.predecessor.outputSha256, actorSha256: plan.predecessor.actorSha256, referenceSha256: plan.predecessor.referenceSha256 },
          template: { templateVersionId: v8.id, templateId: v8.lineageId, version: v8.version, template_sha256: sha },
          changes: bt.changes.map((c) => ({ pointer: c.pointer, old: c.old, new: c.new, justification: c.justification, approval: c.approval, ...(c.capabilityGap ? { capabilityGap: c.capabilityGap } : {}) })),
          approvals: CARRIED_APPROVALS.map((id) => {
            const a = spec.approvals.find((x) => x.id === id)!;
            return { id, what: a.what, decision: a.decision, approvedAt: a.approved_at, status: a.status };
          }),
          capabilityGaps: spec.capabilityGaps.filter((g) => bt.changes.some((c) => c.capabilityGap === g.id)),
          request: spec.request,
          successor: plan.successor,
          note: 'One-time correction (APR-13c). Only the listed S5 step tool values changed; the predecessor record is unchanged and its approval is not extended: a person approves this revision in the console.',
        };
        plan.outcome = 'would_submit';
        ready.push({ plan, task, record, output: applied.output, lineage, stored, spec: bt });
      }
      if (report.tasks.some((t) => t.outcome === 'refused')) return refuse('A precondition does not hold; nothing was written. See each task’s reason.');
      if (report.unchanged.some((u) => u.toolCheck === 'fail')) return refuse('The unchanged task does not pass the tool check; nothing was written.');
      if (!args.apply) return { ...report, outcome: 'ok' };

      const audit = (a: AuditInput) => writeAudit(tx, { clientId: project.clientId, actorType: 'SYSTEM', actorId: ACTOR }, a);
      for (const r of ready) {
        const now = new Date();
        const version = (r.task.submissions.at(-1)?.version ?? 0) + 1;
        const input = { ...(r.task.input as Record<string, unknown>), toolBindingCorrection: r.lineage };
        const { count } = await tx.taskInstance.updateMany({
          where: { id: r.task.id, revision: r.task.revision, status: r.task.status },
          data: { status: 'SUBMITTED', input: input as Prisma.InputJsonValue, output: r.output as Prisma.InputJsonValue, submittedAt: now, checks: r.stored as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, reviewStage: null },
        });
        if (!count) throw new Error(`Task ${r.task.id} changed while the correction was submitted.`);
        // Awaiting review again, the task no longer fills its slot (as after an export re-validation, D18).
        if (r.task.slotId) await tx.coverageSlot.update({ where: { id: r.task.slotId }, data: { status: 'IN_PROGRESS' } });
        const policy = await snapshotTask(tx, { clientId: project.clientId, task: { id: r.task.id, projectId: project.id }, actorId: ACTOR });
        await tx.taskSubmission.create({ data: { clientId: project.clientId, taskInstanceId: r.task.id, version, policySnapshotId: policy?.snapshot.id ?? null, output: r.output as Prisma.InputJsonValue, coverageTags: (r.task.coverageTags ?? undefined) as Prisma.InputJsonValue | undefined, checks: r.stored as unknown as Prisma.InputJsonValue } });
        await audit({
          entityType: 'TaskInstance',
          entityId: r.task.id,
          action: 'task.tool_binding_revision_submitted',
          before: { status: r.task.status, recordId: r.record.id, contentHash: r.record.contentHash, outputSha256: r.plan.predecessor!.outputSha256 },
          after: { status: 'SUBMITTED', version, requestedBy: admin.id, recordKept: true, changes: r.spec.changes.map((c) => ({ pointer: c.pointer, old: c.old, new: c.new })), approvals: [...CARRIED_APPROVALS], capabilityGaps: report.capabilityGaps.filter((g) => r.spec.changes.some((c) => c.capabilityGap === g)), outputSha256: r.plan.successor!.outputSha256 },
        });
        await emitEvent(tx, project.clientId, { name: 'task.submitted', aggregateType: 'TaskInstance', aggregateId: r.task.id, payload: { taskId: r.task.id, projectId: project.id, version, flaggedDuplicate: false } });
        Object.assign(r.plan, { outcome: 'submitted', status: 'SUBMITTED' });
      }
      return { ...report, outcome: 'ok' };
    },
    { timeout: 120_000 },
  );
}

function loadTask(tx: Tx, id: string) {
  return tx.taskInstance.findUnique({ where: { id }, include: { submissions: { orderBy: { version: 'asc' }, select: { version: true } } } });
}

// ───────────────────────── Command line ─────────────────────────

export const KYC_V8_TOOL_BINDING_USAGE = 'Use: kyc-v8-tool-binding --requested-by <admin email> [--apply]';

export function parseToolBindingArgs(argv: string[]): { requestedBy: string; apply: boolean } {
  const out = { requestedBy: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') out.apply = true;
    else if (a === '--requested-by') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`--requested-by needs a value. ${KYC_V8_TOOL_BINDING_USAGE}`);
      out.requestedBy = v;
    } else throw new Error(`Unknown argument "${a}". ${KYC_V8_TOOL_BINDING_USAGE}`);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(out.requestedBy)) throw new Error(`--requested-by <admin email> is required. ${KYC_V8_TOOL_BINDING_USAGE}`);
  return out;
}
