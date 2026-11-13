import { evaluatorMap, JOINT_TEMPLATE_SPEC, jointToolIds } from '../anvil/joint-template';
import type { Prisma, TaskInstance } from '@prisma/client';
import { praxisContractChecks } from '@praxis/shared';
import type { CoverageTags, SubmitTaskRequest, TaskCheck } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import type { OutboxInput } from '../outbox/outbox';
import { coverageChecks, definitionFor, finalCoverage, type SlotRef } from './definitions';
import { draftingChecks } from './drafting/service';
import { findSimilar, storeEmbedding, type SimilarMatch } from './similarity';
import { scanForRealData, type DataFlag } from './synthetic-scan';
import { templateRef } from './task-service';
import { chatOf } from './conversation/service';
import { effectivePolicy, snapshotTask } from '../policy/task-policy';
import { graphChecks } from './workflow-graph';
import { compileForSubmission, profileChecks, type ExportStatus } from './profile-output';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;

export interface StoredChecks {
  results: TaskCheck[];
  keyInputs: string[];
  similar: SimilarMatch[];
  embeddingModel: string | null;
  /** Anvil export readiness of a profile-driven task (compiled at submission); absent for other tasks. */
  export?: ExportStatus;
}

export const blocking = (c: TaskCheck) => !c.ok && c.severity !== 'warning';

/** Every automated check for the task's current output (TASK-KYC section 5), without changing anything. */
export async function evaluateTask(tx: Db | Tx, task: Pick<TaskInstance, 'id' | 'projectId' | 'taskType' | 'output' | 'input' | 'drafting' | 'revision'>) {
  const project = await tx.project.findUniqueOrThrow({ where: { id: task.projectId }, include: { template: true } });
  const template = await templateRef(tx, project.templateId);
  const def = definitionFor(template);
  const output = (task.output ?? {}) as Record<string, unknown>;
  const slot = task.taskType === 'AUTHORING' ? ((task.input as { slot?: SlotRef }).slot ?? null) : null;
  const checks: TaskCheck[] = [...coverageChecks(template, slot, output), ...(def.key === 'kyc-onboarding-v1' ? praxisContractChecks(output) : []), ...def.validateSubmission(template, output, slot), ...(task.taskType === 'AUTHORING' ? profileChecks(template, output) : []), ...draftingChecks(task), ...(task.taskType === 'AUTHORING' ? graphChecks(output, project.template) : [])];
  const chat = chatOf(task);
  if (task.taskType === 'AUTHORING' && project.authoringExperience) checks.push({id:'authoring.consent',section:'W06',ok:!!chat.consent && !!chat.humanOnly,message:'Accept human-authorship terms and review this revision before submission'});
  if (chat.humanOnly) checks.push({id:'conversation.authorship',section:'W06',ok:chat.declaration?.revision===task.revision,message:'Confirm human authorship, no external LLM generation and authorised sources for this revision'});
  if (chat.reviewedRevision !== undefined) checks.push({ id: 'conversation.reviewed_revision', section: 'W06', ok: chat.reviewedRevision === task.revision, message: 'Review the latest task revision after manual edits' });
  if (chat.policyDigest) {
    const policy = await effectivePolicy(tx, project.clientId, task);
    checks.push({ id: 'conversation.policy_version', section: 'W06', ok: chat.policyDigest === (policy?.digest ?? 'none'), message: 'Reconcile conversation against current published project rules' });
  }
  if (task.taskType === 'AUTHORING' && template.profileId) checks.push(...(await boundRuleChecks(tx, project.clientId, task, output)));
  if (task.taskType === 'AUTHORING' && project.template.anvilSpec) checks.push(...anvilSpecChecks(project.template.anvilSpec, output));
  const coverage: CoverageTags | null = task.taskType === 'AUTHORING' ? finalCoverage(slot, output) : null;
  return {
    project,
    template,
    checks,
    flags: task.taskType === 'AUTHORING' ? scanForRealData(output) : ([] as DataFlag[]),
    coverage,
    keyInputs: def.keyInputs(output),
    text: def.canonicalText(output),
    threshold: Number(project.template.similarityThreshold),
    lineageId: project.template.lineageId,
  };
}

/**
 * Submits the autosaved output. Blocked by any failing check or any unexplained synthetic-data flag. Near-duplicates
 * never block; they are flagged for the Reviewer. Each submission is kept as a numbered version.
 */
export async function submitTask(
  tx: Tx,
  args: { task: TaskInstance; body: SubmitTaskRequest; embedding: number[] | null; embeddingModel: string | null },
  audit: Audit,
  emit: (e: OutboxInput) => Promise<void>,
) {
  const t = args.task;
  if (!['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) throw new AppError(409, 'NOT_SUBMITTABLE', `This task is ${t.status.toLowerCase()} and cannot be submitted.`);
  if (t.revision !== args.body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: t.revision });
  if (!t.output) throw new AppError(422, 'EMPTY', 'Save your work before submitting.');

  const ev = await evaluateTask(tx, t);
  const unexplained = ev.flags.filter((f) => !args.body.flagExplanations[f.id]);
  if (ev.checks.some(blocking) || unexplained.length) {
    throw new AppError(422, 'CHECKS_FAILED', 'Some checks need attention before you can submit.', { checks: ev.checks, flags: ev.flags, unexplained: unexplained.map((f) => f.id) });
  }

  const similar = args.embedding && t.taskType === 'AUTHORING' ? await refreshSimilarity(tx, t, ev, args.embedding) : [];

  // Export readiness is separate from authoring: a blocked compile never blocks the submission.
  const compiled = t.taskType === 'AUTHORING' ? compileForSubmission(ev.template, t.output as Record<string, unknown>, { taskId: t.id, revisionId: `${t.id}-r${t.revision}` }) : null;
  const output = (compiled?.output ?? t.output) as Prisma.InputJsonValue;
  const stored: StoredChecks = { results: ev.checks, keyInputs: ev.keyInputs, similar, embeddingModel: args.embeddingModel, ...(compiled ? { export: compiled.status } : {}) };
  const flags = ev.flags.map((f) => ({ ...f, explanation: args.body.flagExplanations[f.id] }));
  const now = new Date();
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, revision: t.revision },
    data: {
      status: 'SUBMITTED',
      submittedAt: now,
      ...(compiled ? { output } : {}),
      coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined,
      checks: stored as unknown as Prisma.InputJsonValue,
      flags: flags as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
      // SME -> Expert -> PM: every submission (first, after rework or after reconfirming an Expert edit) starts at Expert review.
      reviewStage: ev.project.reviewRoute === 'SME_EXPERT_PM' ? 'EXPERT_REVIEW' : null,
    },
  });
  if (!count) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.');
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
  const version = (await tx.taskSubmission.count({ where: { taskInstanceId: t.id } })) + 1;
  const policy = await snapshotTask(tx, { clientId: t.clientId, task: { id: t.id, projectId: t.projectId }, actorId: 'task-submission' });
  await tx.taskSubmission.create({ data: { clientId: t.clientId, taskInstanceId: t.id, version, policySnapshotId: policy?.snapshot.id ?? null, output, coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined, checks: stored as unknown as Prisma.InputJsonValue } });
  const flagged = similar.filter((m) => m.flagged);
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.submitted', before: { status: t.status }, after: { status: 'SUBMITTED', version, ...(ev.project.reviewRoute === 'SME_EXPERT_PM' ? { stage: 'EXPERT_REVIEW' } : {}), ...(compiled ? { export: compiled.status.status } : {}), flaggedDuplicates: flagged.map((m) => m.taskId), dataFlags: flags.length } });
  await emit({ name: 'task.submitted', aggregateType: 'TaskInstance', aggregateId: t.id, payload: { taskId: t.id, projectId: t.projectId, version, flaggedDuplicate: flagged.length > 0 } });
  return { version, similar };
}

/** Near-duplicate search for the task's current text; replaces the task's stored similarity rows and embedding. */
export async function refreshSimilarity(tx: Tx, t: Pick<TaskInstance, 'id' | 'clientId'>, ev: Pick<Awaited<ReturnType<typeof evaluateTask>>, 'lineageId' | 'coverage' | 'keyInputs' | 'threshold'>, embedding: number[]) {
  const similar = await findSimilar(tx, { taskId: t.id, lineageId: ev.lineageId, embedding, coverage: ev.coverage, keyInputs: ev.keyInputs, threshold: ev.threshold });
  await storeEmbedding(tx, t.id, embedding);
  await tx.similarityCheck.deleteMany({ where: { taskInstanceId: t.id } });
  await tx.similarityCheck.createMany({
    data: similar.flatMap((m) => [
      { clientId: t.clientId, taskInstanceId: t.id, comparedToId: m.taskId, score: m.embeddingScore.toFixed(4), method: 'EMBEDDING' as const, flagged: m.embeddingScore >= ev.threshold },
      { clientId: t.clientId, taskInstanceId: t.id, comparedToId: m.taskId, score: m.structuredScore.toFixed(4), method: 'STRUCTURED' as const, flagged: m.flagged && m.embeddingScore < ev.threshold },
    ]),
  });
  return similar;
}

/**
 * Policy binding for template versions with a chosen form (owner, 11 Nov 2026; Golden KYC reference: "bind exact
 * federal/state/product versions"). Every rule cited in S4 must be a rule version published for this project and
 * applying to this task, cited by its rule key and exact version ID. Missing project policy is reported as a
 * configuration problem, never as a case fact.
 */
export async function boundRuleChecks(tx: Db | Tx, clientId: string, task: { id: string; projectId: string }, output: Record<string, unknown>): Promise<TaskCheck[]> {
  const cited = ((output.sections as Record<string, { policies?: unknown }> | undefined)?.S4?.policies ?? []) as { ruleId?: string; ruleVersion?: string }[];
  if (!Array.isArray(cited) || !cited.length) return [];
  const policy = await effectivePolicy(tx, clientId, task);
  if (!policy) return [{ id: 'policy.bound-versions', section: 'S4', ok: false, message: 'This project has no published rules yet, so the cited rules cannot be bound. Ask the PM to publish the project policy (a configuration gap, not a case fact).' }];
  const byVersion = new Map(policy.body.rules.map((r) => [r.rule_version_id, r]));
  const bad = cited.filter((c) => {
    const r = c.ruleVersion ? byVersion.get(c.ruleVersion) : undefined;
    // Rule keys are stored with an `R-` prefix (R-GB-01); authors may cite either form.
    const key = (k: string | null | undefined) => (k ?? '').replace(/^R-/i, '').toLowerCase();
    return !r || (!!c.ruleId && key(c.ruleId) !== key(r.rule_key) && c.ruleId !== r.rule_id);
  });
  return [{ id: 'policy.bound-versions', section: 'S4', ok: bad.length === 0, message: bad.length ? `Cite published project rules by key and exact version: ${bad.map((c) => c.ruleId ?? c.ruleVersion ?? '?').join(', ')} ${bad.length === 1 ? 'is' : 'are'} not published for this project (or the key and version do not match)` : `Every cited rule is a published project rule version (${cited.length})` }];
}

/**
 * Template versions Anvil proposed carry its execution part (Praxis-Anvil contract, 12 Nov 2026). A task must use only
 * what that part declares: each rubric criterion names one of the allowed evaluator kinds, and each recorded tool call
 * uses a tool Anvil described with its schemas. Owner, 11 Nov 2026: weights above 0 totalling exactly 100, and 5/2/0
 * descriptions on every criterion.
 */
export function anvilSpecChecks(anvilSpec: unknown, output: Record<string, unknown>): TaskCheck[] {
  if ((anvilSpec as { schemaVersion?: unknown }).schemaVersion === JOINT_TEMPLATE_SPEC) return jointSpecChecks(anvilSpec as { execution: Record<string, unknown> }, output);
  const exec = (anvilSpec as { execution?: { evaluatorKinds?: string[]; tools?: { name: string }[] } }).execution ?? {};
  const kinds = new Set(exec.evaluatorKinds ?? []);
  const tools = new Set((exec.tools ?? []).map((t) => t.name));
  const sections = (output.sections ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const criteria = (Array.isArray(sections.S7?.criteria) ? sections.S7!.criteria : []) as { id?: string; evaluatorKind?: string; weight?: unknown; passCondition?: unknown; partialCredit?: unknown; failCondition?: unknown }[];
  const badKinds = criteria.filter((c) => !c.evaluatorKind || !kinds.has(c.evaluatorKind));
  const calls = (Array.isArray(sections.S3?.recordedResponses) ? sections.S3!.recordedResponses : []) as { id?: string; tool?: string }[];
  const badTools = calls.filter((c) => !c.tool || !tools.has(c.tool));
  // Owner, 11 Nov 2026 (Anvil Q4): weights above 0 with at most two decimals, totalling exactly 100 (10,000 basis points).
  const bps = criteria.map((c) => (typeof c.weight === 'number' && Number.isFinite(c.weight) ? Math.round(c.weight * 100) : NaN));
  const badWeights = criteria.filter((c, i) => !(bps[i]! > 0) || Math.abs((c.weight as number) * 100 - bps[i]!) > 1e-6);
  const total = bps.reduce((n, b) => n + (Number.isNaN(b) ? 0 : b), 0);
  const weightsOk = criteria.length > 0 && badWeights.length === 0 && total === 10_000;
  // Owner, 11 Nov 2026 (Anvil Q4): every criterion states full (5), partial (2) and fail (0).
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const badAnchors = criteria.filter((c) => !text(c.passCondition) || !text(c.partialCredit) || !text(c.failCondition));
  return [
    {
      id: 'anvil.criteria-weights',
      section: 'S7',
      ok: weightsOk,
      message: weightsOk
        ? 'Every weight is above 0 with at most two decimals, and the weights total exactly 100'
        : badWeights.length
          ? `Give criteria ${badWeights.map((c) => c.id ?? '?').join(', ')} a weight above 0 with at most two decimals`
          : `Weights must total exactly 100 (now ${total / 100})`,
    },
    { id: 'anvil.criteria-anchors', section: 'S7', ok: badAnchors.length === 0, message: badAnchors.length ? `State the pass condition (5), partial credit (2) and fail (0) for criteria ${badAnchors.map((c) => c.id ?? '?').join(', ')}` : 'Every criterion states full, partial and fail' },
    { id: 'anvil.evaluator-kinds', section: 'S7', ok: badKinds.length === 0, message: badKinds.length ? `Choose an evaluator kind the template allows (${[...kinds].join(', ')}) for criteria ${badKinds.map((c) => c.id ?? '?').join(', ')}` : 'Every criterion uses an evaluator kind the template allows' },
    { id: 'anvil.tools', section: 'S3', ok: badTools.length === 0, message: badTools.length ? `Recorded calls must use tools Anvil described for this template: ${badTools.map((c) => `${c.id ?? '?'} (${c.tool ?? 'no tool'})`).join(', ')}` : 'Every recorded call uses a tool Anvil described' },
  ];
}

/** Shared weight and 5/2/0 anchor checks (owner, 11 Nov 2026, Anvil Q4). */
function weightAndAnchorChecks(criteria: { id?: string; weight?: unknown; passCondition?: unknown; partialCredit?: unknown; failCondition?: unknown }[]): TaskCheck[] {
  const bps = criteria.map((c) => (typeof c.weight === 'number' && Number.isFinite(c.weight) ? Math.round(c.weight * 100) : NaN));
  const badWeights = criteria.filter((c, i) => !(bps[i]! > 0) || Math.abs((c.weight as number) * 100 - bps[i]!) > 1e-6);
  const total = bps.reduce((n, b) => n + (Number.isNaN(b) ? 0 : b), 0);
  const weightsOk = criteria.length > 0 && badWeights.length === 0 && total === 10_000;
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const badAnchors = criteria.filter((c) => !text(c.passCondition) || !text(c.partialCredit) || !text(c.failCondition));
  return [
    { id: 'anvil.criteria-weights', section: 'S7', ok: weightsOk, message: weightsOk ? 'Every weight is above 0 with at most two decimals, and the weights total exactly 100' : badWeights.length ? `Give criteria ${badWeights.map((c) => c.id ?? '?').join(', ')} a weight above 0 with at most two decimals` : `Weights must total exactly 100 (now ${total / 100})` },
    { id: 'anvil.criteria-anchors', section: 'S7', ok: badAnchors.length === 0, message: badAnchors.length ? `State the pass condition (5), partial credit (2) and fail (0) for criteria ${badAnchors.map((c) => c.id ?? '?').join(', ')}` : 'Every criterion states full, partial and fail' },
  ];
}

/**
 * Checks for a template in the joint format (Anvil's four confirmations, 11 Nov 2026): each criterion uses the exact
 * evaluator (id, version) its template maps to that criterion ID; output-reference criteria name an output field of
 * the template's output schema and a private expected value; at least one criterion is critical; recorded calls use
 * tools the execution part declares.
 */
function jointSpecChecks(spec: { execution: Record<string, unknown> }, output: Record<string, unknown>): TaskCheck[] {
  const sections = (output.sections ?? {}) as Record<string, Record<string, unknown> | undefined>;
  type C = { id?: string; evaluatorKind?: unknown; evaluatorVersion?: unknown; weight?: unknown; passCondition?: unknown; partialCredit?: unknown; failCondition?: unknown; critical?: unknown; outputField?: unknown; expectedValue?: unknown };
  const criteria = (Array.isArray(sections.S7?.criteria) ? sections.S7!.criteria : []) as C[];
  const map = evaluatorMap(spec);
  const outputs = Object.keys(((spec.execution.output_schema as { properties?: object } | undefined)?.properties ?? {}) as object);
  const unmapped = criteria.filter((c) => !c.id || !map.has(c.id));
  const wrong = criteria.filter((c) => c.id && map.has(c.id) && (c.evaluatorKind !== map.get(c.id)!.id || c.evaluatorVersion !== map.get(c.id)!.version));
  const filled = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  const noReference = criteria.filter((c) => c.id && map.get(c.id)?.evidenceSource === 'output' && (!filled(c.outputField) || !outputs.includes(String(c.outputField)) || !filled(c.expectedValue)));
  const tools = new Set(jointToolIds(spec as never));
  const calls = (Array.isArray(sections.S3?.recordedResponses) ? sections.S3!.recordedResponses : []) as { id?: string; tool?: string }[];
  const badTools = calls.filter((c) => !c.tool || !tools.has(c.tool));
  const hasCritical = criteria.some((c) => c.critical === true);
  // A 0-4 template (execution v3 rubric descriptor, Keystone decision 3) is never scored on KYC's 5/2/0 anchors; its form
  // already requires the level 4, 2 and 0 statements. Weights are still checked.
  const zeroToFour = (spec.execution.rubric as { scale?: unknown } | undefined)?.scale === 'zero_to_four';
  const weightAnchor = weightAndAnchorChecks(criteria).filter((c) => !(zeroToFour && c.id === 'anvil.criteria-anchors'));
  return [
    ...weightAnchor,
    { id: 'anvil.evaluator-binding', section: 'S7', ok: unmapped.length === 0, message: unmapped.length ? `Criteria ${unmapped.map((c) => c.id ?? '?').join(', ')} have no evaluator in this template; use the template’s criterion IDs (${[...map.keys()].join(', ')})` : 'Every criterion has an evaluator in the template' },
    { id: 'anvil.evaluator-kinds', section: 'S7', ok: wrong.length === 0, message: wrong.length ? `Use the template’s evaluator and version for ${wrong.map((c) => `${c.id} (${map.get(c.id!)!.id} v${map.get(c.id!)!.version})`).join(', ')}` : 'Every criterion uses the evaluator and version its template maps to it' },
    { id: 'anvil.output-reference', section: 'S7', ok: noReference.length === 0, message: noReference.length ? `Criteria ${noReference.map((c) => c.id).join(', ')} check the final answer: name an output field (${outputs.join(', ') || 'none declared'}) and the private expected value` : 'Every output check names an output field and its expected value' },
    { id: 'anvil.critical', section: 'S7', ok: hasCritical, message: hasCritical ? 'At least one criterion is critical' : 'Mark at least one criterion critical' },
    { id: 'anvil.tools', section: 'S3', ok: badTools.length === 0, message: badTools.length ? `Recorded calls must use tools Anvil described for this template: ${badTools.map((c) => `${c.id ?? '?'} (${c.tool ?? 'no tool'})`).join(', ')}` : 'Every recorded call uses a tool Anvil described' },
  ];
}
