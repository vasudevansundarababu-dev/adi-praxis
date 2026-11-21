import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import { jcs, jcsSha256 } from '../anvil/jcs';
import { taskAssetHashes } from '../anvil/generic-package';
import { jointHashes, jointTemplateSpec } from '../anvil/joint-template';
import { undeclaredTools } from '../anvil/tool-binding';
import type { Db, Tx } from '../db';
import { emitEvent } from '../outbox/outbox';
import { writeAudit, type AuditInput } from '../platform/audit';
import { snapshotTask } from '../policy/task-policy';
import { authoredContent } from '../tasks/profile-output';
import { checkOptions, revalidateTask } from '../tasks/revalidation';
import type { StoredChecks } from '../tasks/submission';

/**
 * KYC v8 pending-TIN exclusion (owner decision APR-14, 21 Nov 2026). RL Gym has no TIN capability (CG-01), so the
 * owner removed pending-TIN verification from the Teen joint and Custodial tasks: the pending-TIN procedure step
 * (S5.steps[2], left with a blank tool by APR-13b) and every instruction, output, rubric, reference and
 * failure-handling sentence that depends on it. No substitute tool; nothing claims TIN was verified; the limitation
 * sentence goes into S1.scope and S8.reviewerNotes verbatim. v8 is not changed (its contract does not require TIN).
 *
 * Same revision path as the APR-13 tool-binding job (D18): each task leaves Accepted (or Rework) as a new submitted
 * version; its approved record (the APR-13 successor) stays as it is (append-only); a person approves the revision in
 * the console, which writes the next record. Nothing here writes or extends an approval.
 *
 * Every edit is guarded by the exact old text (each `find` must occur exactly once in the current value), and the
 * removed step must be the pending-TIN step with a blank tool; any mismatch refuses and writes nothing. Putting the
 * old values back and re-inserting the step must give the approved bytes exactly. Dry run by default; `--apply`
 * writes. Authorised (active Admin), audited (actor SYSTEM, this job), idempotent, all or nothing.
 */

const ACTOR = 'kyc-v8-tin-exclusion';
export const TIN_EXCLUSION_SCHEMA = 'adi-forge.tin-exclusion-revision.v1';
export const APR_14 = 'APR-14';
export const TIN_LIMITATION = 'Pending-TIN verification is excluded from this benchmark; results do not establish TIN verification or complete regulatory compliance.';
const TIN_RULE = 'R-CONFIRM-PENDING-TIN-APPLICATION';
const PREFIX = '/authored/sections/';
/** Fields APR-14 leaves byte-identical; a change listed under one of them is refused. */
export const PROTECTED_POINTERS = ['/authored/sections/S3/tools', '/authored/sections/S4', '/authored/sections/S7/criteria'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface TextEdit {
  find: string;
  replace: string;
}
export interface FieldChange {
  /** JSON pointer in the task's private `reference.json` (RL Gym's notation), before the step removal. */
  pointer: string;
  /** Where the field sits after the step removal, when that moves it. */
  successorPointer?: string;
  edits: TextEdit[];
}
export interface TinTask {
  title: string;
  applicationType: string;
  taskId: string;
  predecessorRecordId: string;
  /** The S5 step removed (the pending-TIN step, blank tool since APR-13b). */
  removeStep: number;
  fields: FieldChange[];
}
export interface ApprovalRecord {
  id: string;
  what: string;
  decision: string;
  approved_by: string;
  approved_at: string;
  status: string;
}
export interface TinExclusionSpec {
  projectId: string;
  templateVersionId: string;
  templateSha256: string;
  approval: ApprovalRecord;
  limitation: string;
  capabilityGap: string;
  tasks: TinTask[];
  unchanged: { title: string; applicationType: string; taskId: string; recordId: string }[];
}

const tail = (find: string): TextEdit => ({ find, replace: `${find} ${TIN_LIMITATION}` });

/** The owner-approved APR-14 change list (shared notes `kyc-v8-tin-exclusion-changes.md`), field by field. */
export const KYC_V8_TIN_EXCLUSION: TinExclusionSpec = {
  projectId: 'caddc6b4-2d34-47f2-8196-d73da6285ca0',
  templateVersionId: 'a6e20c93-7d00-4633-9847-5ec8ef5b75a0',
  templateSha256: '8449adb008b6ecea7858b594dd5765f60b9b9596b57568d25f5e0598a334f7d5',
  approval: {
    id: APR_14,
    what: 'Remove pending-TIN verification (S5 step 3 and every dependent instruction, output, rubric, reference and failure-handling text) from the approved KYC v8 Teen joint and Custodial tasks through successor revisions; no substitute tool; no claim that TIN was verified; the limitation is recorded; v8 is not changed; the owner approves each revision in the console.',
    decision: 'Approved',
    approved_by: 'Product Owner (ADI Forge owner)',
    approved_at: '2026-11-21',
    status: 'approved',
  },
  limitation: TIN_LIMITATION,
  capabilityGap: 'CG-01',
  tasks: [
    {
      title: 'Teen joint',
      applicationType: 'teen_joint',
      taskId: '2291de2d-5d6c-41fe-9d8d-e95278f3f3e8',
      predecessorRecordId: '070604bd-64c6-4d23-afbe-5f2077b68371',
      removeStep: 2,
      fields: [
        { pointer: '/authored/sections/S1/businessContext', edits: [{ find: ' Furthermore, when an applicant has applied for but not yet received a TIN, the workflow mandates confirming that an application for a TIN was filed pursuant to R-CONFIRM-PENDING-TIN-APPLICATION.', replace: '' }] },
        { pointer: '/authored/sections/S1/deliverable', edits: [{ find: 'validation of pending TIN application filings where applicable, ', replace: '' }] },
        { pointer: '/authored/sections/S1/scope', edits: [tail('bank charter, and application date.')] },
        {
          pointer: '/authored/sections/S2/inputContract',
          edits: [
            { find: 'Declared legal name, residential address, date of birth, and TIN application status (including any proof of pending TIN application filing).', replace: 'Declared legal name, residential address and date of birth.' },
            { find: 'identity credentials, address verifications, and pending TIN filing receipts.', replace: 'identity credentials and address verifications.' },
          ],
        },
        { pointer: '/authored/sections/S3/failureBehaviour', edits: [{ find: ', or when confirmation of a pending TIN application cannot be established under R-CONFIRM-PENDING-TIN-APPLICATION', replace: '' }] },
        { pointer: '/authored/sections/S5/steps/3/action', successorPointer: '/authored/sections/S5/steps/2/action', edits: [{ find: 'attributes, pending TIN application confirmations, and remaining exceptions', replace: 'attributes and remaining exceptions' }] },
        {
          pointer: '/authored/sections/S6/outputContract',
          edits: [
            { find: '\n- Where an applicant has applied for but not yet received a TIN, explicit confirmation and supporting documentation proving that an application for a TIN was filed pursuant to R-CONFIRM-PENDING-TIN-APPLICATION.', replace: '' },
            { find: 'unconfirmed pending TIN application filings, ', replace: '' },
          ],
        },
        {
          pointer: '/authored/sections/S7/scoringRule',
          edits: [
            { find: '1. Core Attribute Collection & Validation (35 points):', replace: '1. Core Attribute Collection & Validation (50 points):' },
            { find: '2. Pending TIN Application Verification (25 points):\n- Full points awarded for confirming that an application for a TIN was filed whenever an applicant has applied for but not yet received a TIN (R-CONFIRM-PENDING-TIN-APPLICATION).\n\n', replace: '' },
            { find: '3. Discrepancy Handling & Information Gathering (20 points):', replace: '2. Discrepancy Handling & Information Gathering (25 points):' },
            { find: '4. Report Completeness & Recommendation Quality (20 points):', replace: '3. Report Completeness & Recommendation Quality (25 points):' },
            { find: '; (b) failing to confirm a pending TIN application filing when required under R-CONFIRM-PENDING-TIN-APPLICATION; or (c) fabricating', replace: '; or (b) fabricating' },
          ],
        },
        { pointer: '/authored/sections/S8/reviewerNotes', edits: [tail('require further operational validation.')] },
        { pointer: '/authored/sections/S8/sourcesUsed', edits: [{ find: 'R-COLLECT-CUSTOMER-NAME, R-COLLECT-ADDRESS, and R-CONFIRM-PENDING-TIN-APPLICATION.', replace: 'R-COLLECT-CUSTOMER-NAME and R-COLLECT-ADDRESS.' }] },
      ],
    },
    {
      title: 'Custodial',
      applicationType: 'custodial',
      taskId: 'e63aee92-4f4f-4624-9ef2-d4fd0e9d6c5a',
      predecessorRecordId: 'ecc4f6f5-0af9-4da7-ba0b-0e40016ba7b5',
      removeStep: 2,
      fields: [
        { pointer: '/authored/sections/S1/businessContext', edits: [{ find: 'customer name is obtained (R-COLLECT-CUSTOMER-NAME), customer address is collected prior to opening (R-COLLECT-ADDRESS), and bank procedures confirm a pending TIN application was filed when the customer has applied for but not yet received a TIN (R-CONFIRM-PENDING-TIN-APPLICATION).', replace: 'customer name is obtained (R-COLLECT-CUSTOMER-NAME) and customer address is collected prior to opening (R-COLLECT-ADDRESS).' }] },
        { pointer: '/authored/sections/S1/deliverable', edits: [{ find: 'verification of pending TIN application filings where applicable, ', replace: '' }] },
        { pointer: '/authored/sections/S1/scope', edits: [tail('governing state, charter, and application date.')] },
        { pointer: '/authored/sections/S2/inputContract', edits: [{ find: '\n- Tax identification details: Reported TIN/SSN/ITIN, or evidence and confirmation that a TIN application has been formally filed (R-CONFIRM-PENDING-TIN-APPLICATION).', replace: '' }] },
        {
          pointer: '/authored/sections/S3/failureBehaviour',
          edits: [
            { find: '\n2. Pending or Missing TIN Information: If the customer reports an applied-for TIN but verification or documentation confirming that an application was filed cannot be retrieved (R-CONFIRM-PENDING-TIN-APPLICATION), record the lack of confirmation as an unresolved finding. Do not mark TIN verification complete without documented confirmation.', replace: '' },
            { find: '\n3. Tool Unavailability or System Errors:', replace: '\n2. Tool Unavailability or System Errors:' },
            { find: '\n4. Discrepancies and Conflicts:', replace: '\n3. Discrepancies and Conflicts:' },
          ],
        },
        {
          pointer: '/authored/sections/S6/outputContract',
          edits: [
            { find: '\n- TIN Status: Documentation of the provided TIN or, where a TIN has been applied for but not yet issued, verification that bank procedures confirmed a pending TIN application was filed (R-CONFIRM-PENDING-TIN-APPLICATION).', replace: '' },
            { find: 'unverified identity elements, invalid addresses, or unconfirmed pending TIN filings.', replace: 'unverified identity elements or invalid addresses.' },
          ],
        },
        {
          pointer: '/authored/sections/S7/scoringRule',
          edits: [
            { find: '- Customer Name Collection & Verification (25 Points):', replace: '- Customer Name Collection & Verification (35 Points):' },
            { find: '- Customer Address Collection (25 Points):', replace: '- Customer Address Collection (35 Points):' },
            { find: '\n- Pending TIN Application Confirmation (25 Points): Ensures procedures confirm a pending TIN application was filed when an account is opened for a customer who applied for but has not yet received a TIN (R-CONFIRM-PENDING-TIN-APPLICATION), or correctly validates provided TIN details.', replace: '' },
            { find: '- Evidence Logging & Safe Failure Execution (15 Points):', replace: '- Evidence Logging & Safe Failure Execution (20 Points):' },
            { find: '- Hallucinating customer details, fabricating TIN records, or failing to flag unverified/unconfirmed pending TIN statuses where required by R-CONFIRM-PENDING-TIN-APPLICATION.', replace: '- Hallucinating customer details, fabricating TIN records, or claiming TIN verification was performed.' },
          ],
        },
        {
          pointer: '/authored/sections/S8/reviewerNotes',
          edits: [
            { find: ' and validating third-party database integration rules for pending TIN application confirmations', replace: '' },
            tail('Approval status remains pending final subject-matter expert sign-off.'),
          ],
        },
        {
          pointer: '/authored/sections/S8/sourcesUsed',
          edits: [{ find: 'R-COLLECT-ADDRESS (mandatory collection of address prior to account opening), R-COLLECT-CUSTOMER-NAME (mandatory collection of customer name prior to account opening), and R-CONFIRM-PENDING-TIN-APPLICATION (confirming filing of application for pending TIN prior to or at account opening).', replace: 'R-COLLECT-ADDRESS (mandatory collection of address prior to account opening) and R-COLLECT-CUSTOMER-NAME (mandatory collection of customer name prior to account opening).' }],
        },
      ],
    },
  ],
  unchanged: [
    { title: 'Individual', applicationType: 'individual', taskId: 'bdbda764-eabc-40bf-82d8-cfd94277b9f8', recordId: '7b588c33' },
    { title: 'Adult joint', applicationType: 'adult_joint', taskId: 'c71004ea-83a1-490f-b392-3c1283e5f407', recordId: 'a7bd89e2-ce67-47f0-8afa-6cca846fe1f7' },
  ],
};

/** One changed field as recorded: the whole old and new value (or the removed step). */
export interface RecordedChange {
  op: 'replace' | 'remove';
  pointer: string;
  successorPointer?: string;
  old: unknown;
  new: unknown;
}

/** Resolves `/authored/sections/<S>/<key>[/<i>/<key>]` inside an output's sections. */
function locate(sections: Record<string, unknown>, pointer: string): { parent: Record<string, unknown>; key: string } | null {
  if (!pointer.startsWith(PREFIX)) return null;
  const parts = pointer.slice(PREFIX.length).split('/');
  let at: unknown = sections;
  for (const [i, p] of parts.entries()) {
    const last = i === parts.length - 1;
    if (Array.isArray(at)) {
      if (!/^\d+$/.test(p) || last) return null;
      at = at[Number(p)];
      continue;
    }
    if (!isObj(at) || !(p in at)) return null;
    if (last) return { parent: at, key: p };
    at = at[p];
  }
  return null;
}

const occurrences = (s: string, f: string) => (f ? s.split(f).length - 1 : 0);
const isProtected = (pointer: string) => PROTECTED_POINTERS.some((p) => pointer === p || pointer.startsWith(`${p}/`));

/**
 * Applies a task's APR-14 changes to a copy of the output: the text edits (each `find` exactly once in the current
 * value, in order), then the step removal. Refuses on a protected or unknown pointer, an old text that is not there
 * (or not unique), or a removed step that is not the pending-TIN step with a blank tool.
 */
export function applyTinExclusion(output: unknown, task: Pick<TinTask, 'removeStep' | 'fields'>): { output: Record<string, unknown>; changes: RecordedChange[] } | { problems: string[] } {
  if (!isObj(output) || !isObj(output.sections)) return { problems: ['The task has no sections.'] };
  const next = structuredClone(output) as Record<string, unknown> & { sections: Record<string, unknown> };
  const problems: string[] = [];
  const changes: RecordedChange[] = [];
  const seen = new Set<string>();
  for (const f of task.fields) {
    if (isProtected(f.pointer)) {
      problems.push(`${f.pointer} must stay unchanged (S3.tools, S4 and S7.criteria are not edited).`);
      continue;
    }
    if (seen.has(f.pointer)) problems.push(`${f.pointer} is listed twice.`);
    seen.add(f.pointer);
    const at = locate(next.sections, f.pointer);
    const value = at?.parent[at.key];
    if (!at || typeof value !== 'string') {
      problems.push(`${f.pointer} is not a text field of the approved content.`);
      continue;
    }
    let v = value;
    for (const e of f.edits) {
      const n = occurrences(v, e.find);
      if (n !== 1) {
        problems.push(`${f.pointer} does not contain the expected old text ${JSON.stringify(e.find)}${n > 1 ? ` exactly once (found ${n} times)` : ''}.`);
        continue;
      }
      v = v.replace(e.find, () => e.replace);
    }
    at.parent[at.key] = v;
    changes.push({ op: 'replace', pointer: f.pointer, ...(f.successorPointer ? { successorPointer: f.successorPointer } : {}), old: value, new: v });
  }
  const s5 = next.sections.S5;
  const steps = isObj(s5) && Array.isArray(s5.steps) ? (s5.steps as unknown[]) : null;
  const step = steps?.[task.removeStep];
  const pointer = `${PREFIX}S5/steps/${task.removeStep}`;
  if (!isObj(step)) problems.push(`${pointer} does not exist in the approved content.`);
  else if (step.tool !== '' || typeof step.action !== 'string' || !step.action.includes(TIN_RULE)) problems.push(`${pointer} is not the pending-TIN step with a blank tool (tool ${JSON.stringify(step.tool)}).`);
  else {
    steps!.splice(task.removeStep, 1);
    changes.push({ op: 'remove', pointer, old: step, new: null });
  }
  // The successor pointer of a moved field must be where its new value now is.
  for (const c of changes) {
    if (c.op !== 'replace' || !c.successorPointer) continue;
    const at = locate(next.sections, c.successorPointer);
    if (!at || at.parent[at.key] !== c.new) problems.push(`${c.successorPointer} does not hold the edited value of ${c.pointer} after the step removal.`);
  }
  return problems.length ? { problems } : { output: next, changes };
}

/** The inverse: the successor with the old values put back and the step re-inserted (must equal the predecessor). */
export function revertTinExclusion(output: Record<string, unknown>, changes: RecordedChange[]): Record<string, unknown> {
  const back = structuredClone(output) as { sections: Record<string, unknown> };
  for (const c of changes) {
    if (c.op !== 'replace') continue;
    const at = locate(back.sections, c.successorPointer ?? c.pointer);
    if (at) at.parent[at.key] = c.old;
  }
  for (const c of changes) {
    if (c.op !== 'remove') continue;
    const i = Number(c.pointer.split('/').at(-1));
    ((back.sections.S5 as { steps: unknown[] }).steps).splice(i, 0, structuredClone(c.old));
  }
  return back as unknown as Record<string, unknown>;
}

export interface TaskPlan {
  title: string;
  taskId: string;
  predecessorRecordId: string;
  outcome: 'would_submit' | 'submitted' | 'already_submitted' | 'refused';
  reason?: string;
  status?: string;
  predecessorContentHash?: string;
  steps?: { before: number; after: number };
  changes: { op: 'replace' | 'remove'; pointer: string; successorPointer?: string }[];
  predecessor?: { outputSha256: string; actorSha256: string | null; referenceSha256: string | null };
  successor?: { outputSha256: string; actorSha256: string; referenceSha256: string };
  failing?: { id: string; section: string; message: string }[];
  successorRecordId?: string | null;
}
export interface TinExclusionReport {
  outcome: 'ok' | 'refused';
  reason?: string;
  projectId: string;
  templateVersionId: string;
  template_sha256?: string;
  approval: string;
  limitation: string;
  tasks: TaskPlan[];
  unchanged: { title: string; taskId: string; recordId: string; check: 'pass' | 'fail' | 'not_checked'; reason?: string; contentHash?: string }[];
}

function hashesOf(record: ApprovedTaskRecord, output: unknown, template: Template, opts: { checkTools?: boolean } = {}) {
  return taskAssetHashes({ record: { ...record, output } as unknown as ApprovedTaskRecord, template }, opts);
}

type Lineage = { predecessor?: { recordId?: string }; changes?: { op: string; pointer: string }[] };

export async function kycV8TinExclusion(db: Db, args: { requestedBy: string; apply: boolean; spec?: TinExclusionSpec }): Promise<TinExclusionReport> {
  const spec = args.spec ?? KYC_V8_TIN_EXCLUSION;
  return db.$transaction(
    async (tx) => {
      const report: TinExclusionReport = {
        outcome: 'refused',
        projectId: spec.projectId,
        templateVersionId: spec.templateVersionId,
        approval: spec.approval.id,
        limitation: spec.limitation,
        tasks: spec.tasks.map((t) => ({ title: t.title, taskId: t.taskId, predecessorRecordId: t.predecessorRecordId, outcome: 'refused', changes: [...t.fields.map((f) => ({ op: 'replace' as const, pointer: f.pointer, ...(f.successorPointer ? { successorPointer: f.successorPointer } : {}) })), { op: 'remove' as const, pointer: `${PREFIX}S5/steps/${t.removeStep}` }] })),
        unchanged: spec.unchanged.map((u) => ({ title: u.title, taskId: u.taskId, recordId: u.recordId, check: 'not_checked' })),
      };
      const refuse = (reason: string): TinExclusionReport => ({ ...report, outcome: 'refused', reason });

      if (spec.approval.id !== APR_14 || spec.approval.status !== 'approved') return refuse('Approval APR-14 is not recorded as approved.');
      if (spec.limitation !== TIN_LIMITATION) return refuse('The limitation text is not the approved sentence.');
      for (const t of spec.tasks) {
        for (const f of t.fields) if (!f.pointer.startsWith(PREFIX) || isProtected(f.pointer)) return refuse(`${t.title} ${f.pointer}: only authored text outside S3.tools, S4 and S7.criteria may change.`);
        const limited = t.fields.filter((f) => f.edits.some((e) => e.replace.endsWith(` ${TIN_LIMITATION}`))).map((f) => f.pointer);
        if (jcs(limited.sort()) !== jcs([`${PREFIX}S1/scope`, `${PREFIX}S8/reviewerNotes`])) return refuse(`${t.title}: the limitation must be appended to S1.scope and S8.reviewerNotes.`);
      }

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
      const admin = await tx.user.findFirst({ where: { clientId: project.clientId, email: { equals: args.requestedBy, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
      if (!admin) return refuse('The requester must be an active Admin of this client.');

      // The unchanged tasks: reported with their current record (matched by ID or ID prefix), never touched.
      for (const [i, u] of spec.unchanged.entries()) {
        const row = report.unchanged[i]!;
        const recs = await tx.approvedTaskRecord.findMany({ where: { taskInstanceId: u.taskId, projectId: project.id }, orderBy: { seq: 'desc' }, take: 1 });
        const rec = recs[0];
        const task = await tx.taskInstance.findUnique({ where: { id: u.taskId }, select: { status: true } });
        if (!rec || !rec.id.startsWith(u.recordId)) Object.assign(row, { check: 'fail', reason: `The task's latest approved record is ${rec?.id ?? 'missing'}, not ${u.recordId}.` });
        else if (task?.status !== 'ACCEPTED') Object.assign(row, { check: 'fail', reason: `The task is ${String(task?.status).toLowerCase()}, not accepted.` });
        else {
          const bad = undeclaredTools(joint.execution, (authoredContent(rec.output) as { sections?: unknown }).sections);
          Object.assign(row, { recordId: rec.id, contentHash: rec.contentHash }, bad.length ? { check: 'fail', reason: `Undeclared tools at ${bad.map((b) => b.pointer).join(', ')}.` } : { check: 'pass' });
        }
      }

      type Ready = { plan: TaskPlan; task: NonNullable<Awaited<ReturnType<typeof loadTask>>>; record: ApprovedTaskRecord; output: Record<string, unknown>; lineage: Record<string, unknown>; stored: StoredChecks };
      const ready: Ready[] = [];
      for (const [i, tt] of spec.tasks.entries()) {
        const plan = report.tasks[i]!;
        const task = await loadTask(tx, tt.taskId);
        if (!task || task.projectId !== project.id) {
          plan.reason = 'The task was not found in the project.';
          continue;
        }
        plan.status = task.status;
        const prior = (task.input as { tinExclusion?: Lineage } | null)?.tinExclusion;
        if (prior) {
          if (prior.predecessor?.recordId !== tt.predecessorRecordId) {
            plan.reason = 'The task already carries a different pending-TIN exclusion.';
            continue;
          }
          const predSeq = (await tx.approvedTaskRecord.findUnique({ where: { id: tt.predecessorRecordId }, select: { seq: true } }))?.seq ?? 0n;
          const later = await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: task.id, seq: { gt: predSeq } }, orderBy: { seq: 'desc' } });
          Object.assign(plan, { outcome: 'already_submitted', successorRecordId: later?.id ?? null });
          continue;
        }
        const record = await tx.approvedTaskRecord.findUnique({ where: { id: tt.predecessorRecordId } });
        if (!record || record.taskInstanceId !== task.id || record.projectId !== project.id || record.templateId !== v8.id) {
          plan.reason = 'The predecessor approved record was not found for this task, project and template version.';
          continue;
        }
        plan.predecessorContentHash = record.contentHash;
        if (!(record.input as { toolBindingCorrection?: unknown } | null)?.toolBindingCorrection) {
          plan.reason = 'The predecessor record is not the APR-13 tool-binding revision.';
          continue;
        }
        if ((await tx.approvedTaskRecord.count({ where: { supersedesId: record.id } })) || (await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: task.id, seq: { gt: record.seq } } }))) {
          plan.reason = 'The predecessor is not the latest approved revision of the task.';
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
          plan.reason = 'The approved content carries a compiled contract; this revision changes authored content only.';
          continue;
        }
        const applied = applyTinExclusion(record.output, tt);
        if ('problems' in applied) {
          plan.reason = applied.problems.join(' ');
          continue;
        }
        // Only the listed fields and the one step changed: reverting gives the approved bytes exactly.
        if (jcs(revertTinExclusion(applied.output, applied.changes)) !== jcs(record.output)) throw new Error(`The exclusion for ${tt.title} changed more than its listed fields.`);
        const before = (record.output as { sections: { S5: { steps: unknown[] } } }).sections.S5.steps.length;
        const after = (applied.output as { sections: { S5: { steps: unknown[] } } }).sections.S5.steps.length;
        plan.steps = { before, after };
        const left = JSON.stringify(applied.output.sections);
        if (left.includes(TIN_RULE)) {
          plan.reason = `After the edits, ${TIN_RULE} is still cited in the task.`;
          continue;
        }
        const h0 = hashesOf(record, record.output, v8, { checkTools: false });
        const h1 = hashesOf(record, applied.output, v8);
        if ('code' in h1) {
          plan.reason = `The revised task would not package: ${h1.message}`;
          continue;
        }
        plan.predecessor = { outputSha256: jcsSha256(record.output), actorSha256: 'code' in h0 ? null : h0.actor, referenceSha256: 'code' in h0 ? null : h0.reference };
        plan.successor = { outputSha256: jcsSha256(applied.output), actorSha256: h1.actor, referenceSha256: h1.reference };

        const options = checkOptions(task.checks);
        const rv = await revalidateTask(tx, { ...task, output: applied.output as Prisma.JsonValue, project: { template: v8 } });
        if (rv.failing.length) {
          Object.assign(plan, { reason: 'The revised task does not pass the checks its approval re-runs.', failing: rv.failing.map((f) => ({ id: f.id, section: f.section, message: f.message })) });
          continue;
        }
        const prev = (task.checks ?? {}) as unknown as StoredChecks;
        const stored: StoredChecks = { ...prev, results: [...(prev.results ?? []).filter((c) => c.id.startsWith('authoring.') || c.id.startsWith('conversation.') || c.id.startsWith('suggestions.confirmed.')), ...rv.checks], options };
        const lineage = {
          schema: TIN_EXCLUSION_SCHEMA,
          predecessor: { recordId: record.id, taskId: record.taskInstanceId, contentHash: record.contentHash, seq: record.seq.toString(), reviewerId: record.reviewerId, reviewDecisionAt: record.reviewDecisionAt.toISOString(), outputSha256: plan.predecessor.outputSha256, actorSha256: plan.predecessor.actorSha256, referenceSha256: plan.predecessor.referenceSha256 },
          template: { templateVersionId: v8.id, templateId: v8.lineageId, version: v8.version, template_sha256: sha },
          changes: applied.changes,
          approvals: [{ id: spec.approval.id, what: spec.approval.what, decision: spec.approval.decision, approvedAt: spec.approval.approved_at, status: spec.approval.status }],
          limitation: spec.limitation,
          capabilityGap: spec.capabilityGap,
          successor: plan.successor,
          note: 'One-time revision (APR-14). Pending-TIN verification is removed; no substitute tool; TIN is not claimed as verified. The predecessor record is unchanged and its approval is not extended: a person approves this revision in the console.',
        };
        plan.outcome = 'would_submit';
        ready.push({ plan, task, record, output: applied.output, lineage, stored });
      }
      if (report.tasks.some((t) => t.outcome === 'refused')) return refuse('A precondition does not hold; nothing was written. See each task’s reason.');
      if (report.unchanged.some((u) => u.check === 'fail')) return refuse('An unchanged task is not as expected; nothing was written.');
      if (!args.apply) return { ...report, outcome: 'ok' };

      const audit = (a: AuditInput) => writeAudit(tx, { clientId: project.clientId, actorType: 'SYSTEM', actorId: ACTOR }, a);
      for (const r of ready) {
        const now = new Date();
        const version = (r.task.submissions.at(-1)?.version ?? 0) + 1;
        const input = { ...(r.task.input as Record<string, unknown>), tinExclusion: r.lineage };
        const { count } = await tx.taskInstance.updateMany({
          where: { id: r.task.id, revision: r.task.revision, status: r.task.status },
          data: { status: 'SUBMITTED', input: input as Prisma.InputJsonValue, output: r.output as Prisma.InputJsonValue, submittedAt: now, checks: r.stored as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, reviewStage: null },
        });
        if (!count) throw new Error(`Task ${r.task.id} changed while the revision was submitted.`);
        if (r.task.slotId) await tx.coverageSlot.update({ where: { id: r.task.slotId }, data: { status: 'IN_PROGRESS' } });
        const policy = await snapshotTask(tx, { clientId: project.clientId, task: { id: r.task.id, projectId: project.id }, actorId: ACTOR });
        await tx.taskSubmission.create({ data: { clientId: project.clientId, taskInstanceId: r.task.id, version, policySnapshotId: policy?.snapshot.id ?? null, output: r.output as Prisma.InputJsonValue, coverageTags: (r.task.coverageTags ?? undefined) as Prisma.InputJsonValue | undefined, checks: r.stored as unknown as Prisma.InputJsonValue } });
        await audit({
          entityType: 'TaskInstance',
          entityId: r.task.id,
          action: 'task.tin_exclusion_revision_submitted',
          before: { status: r.task.status, recordId: r.record.id, contentHash: r.record.contentHash, outputSha256: r.plan.predecessor!.outputSha256 },
          after: { status: 'SUBMITTED', version, requestedBy: admin.id, recordKept: true, approval: spec.approval.id, changes: r.plan.changes, steps: r.plan.steps, limitation: spec.limitation, outputSha256: r.plan.successor!.outputSha256 },
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

export const KYC_V8_TIN_EXCLUSION_USAGE = 'Use: kyc-v8-tin-exclusion --requested-by <admin email> [--apply]';

export function parseTinExclusionArgs(argv: string[]): { requestedBy: string; apply: boolean } {
  const out = { requestedBy: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') out.apply = true;
    else if (a === '--requested-by') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`--requested-by needs a value. ${KYC_V8_TIN_EXCLUSION_USAGE}`);
      out.requestedBy = v;
    } else throw new Error(`Unknown argument "${a}". ${KYC_V8_TIN_EXCLUSION_USAGE}`);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(out.requestedBy)) throw new Error(`--requested-by <admin email> is required. ${KYC_V8_TIN_EXCLUSION_USAGE}`);
  return out;
}
