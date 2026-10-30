import stagedExample from './praxis-staged-example.json';
import example from './praxis-example.json';
import { z } from 'zod';
import type { TaskCheck } from './tasks';

export const PRAXIS_CONTRACT_VERSION = 'praxis.anvil.task.v1';
export const EXECUTABLE_WORKFLOW = 'Structured decision authoring';
const text = z.string().trim().min(1).max(20000);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
export const DecisionBinding = z.object({
  kind: z.enum(['json_equals', 'json_number_min', 'json_number_max']),
  field: id,
  value: scalar,
}).strict().superRefine((b, ctx) => {
  if (b.kind !== 'json_equals' && typeof b.value !== 'number') ctx.addIssue({ code: 'custom', path: ['value'], message: 'Numeric binding requires a finite number' });
});
export const PraxisTaskContract = z.object({
  schema_version: z.literal(PRAXIS_CONTRACT_VERSION),
  task_id: id, task_version: id, revision_id: id,
  title: text, objective: text,
  evidence: z.array(z.object({ id, visibility: z.enum(['actor', 'private']), content: text }).strict()).max(100),
  constraints: z.array(z.object({ id, description: text, hard_failure: z.boolean(), binding: DecisionBinding }).strict()).max(50),
  environment: z.object({ binding: z.literal('structured-decision-v1'), initial_state: z.record(z.string(), z.unknown()) }).strict(),
  actions: z.array(z.object({ id, description: text }).strict()).min(1).max(50),
  stages: z.array(z.object({ id, instruction: text, evidence_ids: z.array(id).max(100), completion: text }).strict()).length(1),
  deliverables: z.array(z.object({ id, path: z.literal('output.json'), description: text }).strict()).length(1),
  rubric: z.object({ criteria: z.array(z.object({ id, description: text, weight_bps: z.number().int().positive().max(10000), binding: DecisionBinding }).strict()).min(1).max(50), reference_output: z.record(z.string(), z.unknown()) }).strict(),
  provenance: z.object({ classification: z.literal('synthetic'), source: text,
    rights: z.object({ status: z.literal('declared'), basis: text }).strict(),
    review: z.object({ status: z.enum(['draft', 'approved']), reviewer_ref: text, reviewed_revision_id: id }).strict(),
  }).strict(),
}).strict();
export const PraxisStagedContract = PraxisTaskContract.extend({
  schema_version: z.literal('praxis.anvil.task.v2'),
  environment: z.object({ binding: z.literal('staged-decision-v1'), initial_state: z.record(id, scalar.nullable()) }).strict(),
  evidence: z.array(z.object({ id, visibility: z.enum(['actor', 'private', 'future']), content: text, reveal_stage_id: id.nullable().optional() }).strict()).max(100),
  actions: z.array(z.object({ id, description: text, kind: z.literal('submit_json') }).strict()).min(1).max(50),
  stages: z.array(z.object({ id, instruction: text, evidence_ids: z.array(id).max(100), completion: z.literal('submit_output_json'), action_id: id,
    constraints: PraxisTaskContract.shape.constraints,
    rubric: PraxisTaskContract.shape.rubric,
    state_updates: z.array(z.object({ id, key: id, from_field: id }).strict()).max(50),
  }).strict()).min(2).max(12),
});
export const PRAXIS_STAGED_EXAMPLE = stagedExample;
export type PraxisTaskContract = z.infer<typeof PraxisTaskContract>;
export function bindingSatisfied(b: z.infer<typeof DecisionBinding>, output: Record<string, unknown>) {
  if (!Object.hasOwn(output, b.field)) return false;
  const v = output[b.field];
  return b.kind === 'json_equals' ? v === b.value : typeof v === 'number' && Number.isFinite(v) && typeof b.value === 'number' && (b.kind === 'json_number_min' ? v >= b.value : v <= b.value);
}
/** Field-specific issues; prose is never interpreted as executable code. */
export function praxisContractIssues(value: unknown): { path: string; message: string }[] {
  const version = (value as { schema_version?: unknown } | null)?.schema_version;
  const parsed = version === 'praxis.anvil.task.v2' ? PraxisStagedContract.safeParse(value) : PraxisTaskContract.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const t = parsed.data;
  const issues: { path: string; message: string }[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const allIds = new Set<string>();
  const unique = (items: { id: string }[], path: string) => items.forEach((v, i) => { if (allIds.has(v.id)) add(`${path}.${i}.id`, 'IDs must be globally unique'); allIds.add(v.id); });
  for (const key of ['evidence', 'constraints', 'actions', 'stages', 'deliverables'] as const) unique(t[key], key);
  unique(t.rubric.criteria, 'rubric.criteria');
  const rules = (part: { constraints: { binding: z.infer<typeof DecisionBinding> }[]; rubric: { criteria: { binding: z.infer<typeof DecisionBinding>; weight_bps: number }[]; reference_output: Record<string, unknown> } }, path: string) => {
    if (part.rubric.criteria.reduce((n, c) => n + c.weight_bps, 0) !== 10000) add(`${path}rubric.criteria`, 'Weights must sum to 10000 basis points');
    for (const [key, bindings] of [['constraints', part.constraints], ['rubric.criteria', part.rubric.criteria]] as const) bindings.forEach((c, i) => { if (!bindingSatisfied(c.binding, part.rubric.reference_output)) add(`${path}${key}.${i}.binding`, 'Reference output must satisfy every executable rule'); });
  };
  rules(t, '');
  t.stages.forEach((stage, i) => {
    stage.evidence_ids.forEach((ref) => {
      const evidence = t.evidence.find((e) => e.id === ref);
      const futureStage = evidence && 'reveal_stage_id' in evidence ? t.stages.findIndex((s) => s.id === evidence.reveal_stage_id) : -1;
      if (!evidence || evidence.visibility === 'private' || (evidence.visibility === 'future' && (futureStage < 1 || futureStage > i))) add(`stages.${i}.evidence_ids`, `Unknown or unavailable evidence: ${ref}`);
    });
    if (t.schema_version === 'praxis.anvil.task.v2') {
      const stage = t.stages[i]!;
      unique(stage.constraints, `stages.${i}.constraints`);
      unique(stage.rubric.criteria, `stages.${i}.rubric.criteria`);
      unique(stage.state_updates, `stages.${i}.state_updates`);
      rules(stage, `stages.${i}.`);
      if (!t.actions.some((a) => a.id === stage.action_id)) add(`stages.${i}.action_id`, 'Stage must name a declared submit_json action');
      const keys = new Set<string>();
      stage.state_updates.forEach((u, j) => {
        if (keys.has(u.key)) add(`stages.${i}.state_updates.${j}.key`, 'State update keys must be unique within a stage');
        keys.add(u.key);
        const v = stage.rubric.reference_output[u.from_field];
        if (!Object.hasOwn(stage.rubric.reference_output, u.from_field) || !(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) add(`stages.${i}.state_updates.${j}.from_field`, 'State updates require declared finite scalar reference fields');
      });
    }
  });
  if (t.schema_version === 'praxis.anvil.task.v2') {
    t.evidence.forEach((e, i) => {
      if ((e.visibility === 'future') !== (e.reveal_stage_id != null)) add(`evidence.${i}.reveal_stage_id`, 'Only future evidence requires a reveal stage');
      if (e.visibility === 'future' && t.stages.findIndex((s) => s.id === e.reveal_stage_id) <= 0) add(`evidence.${i}.reveal_stage_id`, 'Future evidence must reveal in a later declared stage');
    });
    const last = t.stages.at(-1)!;
    for (const c of [...t.constraints, ...t.rubric.criteria]) if (!bindingSatisfied(c.binding, last.rubric.reference_output)) add('stages', 'Last stage reference must satisfy final rubric and constraints');
  }
  if (t.provenance.review.reviewed_revision_id !== t.revision_id) add('provenance.review', 'Review must bind this exact revision');
  return issues;
}
export function praxisContractChecks(output: Record<string, unknown>, required = false): TaskCheck[] {
  if (!required && !Object.hasOwn(output, 'praxisContract')) return [];
  const issues = praxisContractIssues(output.praxisContract);
  return issues.length ? issues.map((i) => ({ id: `contract.${i.path}`, section: 'W02', ok: false, message: `${i.path}: ${i.message}` })) : [{ id: 'contract.valid', section: 'W02', ok: true, message: 'Versioned executable contract is valid' }];
}

/** A draft demonstration, never a human approval or a rights clearance. */
export const PRAXIS_SYNTHETIC_EXAMPLE = example;

export const PraxisExportEnvelope = z.object({
  schema_version: z.literal('praxis.anvil.export.v1'),
  source: z.object({ record_id: z.string().min(1), record_hash: z.string().regex(/^[a-f0-9]{64}$/), project_id: z.string().min(1), client_id: z.string().min(1), submission_time: z.string().datetime(), reviewer_id: z.string().nullable(), review_decision_time: z.string().datetime().nullable() }).strict(),
  payload_json: z.string().min(1), payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
