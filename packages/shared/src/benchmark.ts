import { z } from 'zod';

/**
 * Edge cases, slice tags and state verifiers from Studio (adi-labs-design praxis/AUTHORING-SPEC-EDGE-CASES-VERIFIERS-
 * BRANDING.md, sections 1 and 2). Authoring only displays, collects and exports them: it never runs a check, and grading
 * data (an edge case's recipe or expected outcome, `reference_answers`, case-reference paths) never reaches it.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Public edge-case fields Authoring accepts (spec 1.3). Anything else is refused. */
export const EDGE_CASE_KEYS = ['tag', 'archetype', 'complexity', 'products', 'context', 'twist', 'source', 'name'] as const;
/** Grading data that must never be in a proposal (spec 1.3, "Never in the proposal"). */
export const EDGE_CASE_PRIVATE_KEYS = ['recipe', 'outcome', 'outcome_text', 'expected_outcome', 'rationale', 'reference_answers', 'min_per_product', 'minimum', 'policy_rule', 'rule_id'] as const;

export interface EdgeCase {
  tag: string;
  archetype: string | null;
  complexity: string | null;
  products: string[];
  context: string;
  twist: string;
  source: string | null;
  name: string | null;
}

const TAG = /^[a-z][a-z0-9_]{0,63}$/;
const SLOT_ID = /^[a-z][a-z0-9_]{0,63}$/;
export const FAILURE_CODES = ['STATE_MUTATION_ERROR', 'POLICY_VIOLATION', 'MISSING_PRECONDITION', 'UNSAFE_ACTION', 'QUALITY'] as const;
export const CHECK_OPS = ['equals', 'in', 'contains', 'exists_where', 'not_exists', 'count', 'changed', 'unchanged', 'nothing_else_changed'] as const;
export const VERIFIERS_SCHEMA = 'adi.verifier-blocks.v1' as const;

export interface SchemaProblem {
  pointer: string;
  message: string;
  /** True when the problem is grading data that must stay in Studio. */
  private?: boolean;
}

/** Checks `authoring.edge_cases` (spec 1.3). Returns problems; an empty list means the list is acceptable. */
export function edgeCaseProblems(v: unknown): SchemaProblem[] {
  if (!Array.isArray(v)) return [{ pointer: '/authoring/edge_cases', message: 'authoring.edge_cases must be an array.' }];
  const out: SchemaProblem[] = [];
  const seen = new Set<string>();
  v.forEach((e, i) => {
    const p = `/authoring/edge_cases/${i}`;
    if (!isObj(e)) return out.push({ pointer: p, message: 'An edge case must be an object.' });
    const priv = Object.keys(e).filter((k) => (EDGE_CASE_PRIVATE_KEYS as readonly string[]).includes(k));
    if (priv.length) out.push({ pointer: p, private: true, message: `Edge case fields not accepted: ${priv.join(', ')}. The recipe, expected outcome and reference answers are private grading data and stay in Studio.` });
    const unknown = Object.keys(e).filter((k) => !(EDGE_CASE_KEYS as readonly string[]).includes(k) && !(EDGE_CASE_PRIVATE_KEYS as readonly string[]).includes(k));
    if (unknown.length) out.push({ pointer: p, message: `Unknown edge case fields: ${unknown.join(', ')}.` });
    if (typeof e.tag !== 'string' || !TAG.test(e.tag)) out.push({ pointer: `${p}/tag`, message: 'tag is required: lowercase letters, digits and underscores.' });
    else if (seen.has(e.tag)) out.push({ pointer: `${p}/tag`, message: `Duplicate edge case tag "${e.tag}".` });
    else seen.add(e.tag);
    for (const k of ['archetype', 'complexity', 'context', 'twist', 'source', 'name'] as const) if (e[k] !== undefined && typeof e[k] !== 'string') out.push({ pointer: `${p}/${k}`, message: `${k} must be text.` });
    if (e.products !== undefined && (!Array.isArray(e.products) || e.products.some((x) => typeof x !== 'string'))) out.push({ pointer: `${p}/products`, message: 'products must be a list of product values.' });
  });
  return out;
}

export const edgeCasesOf = (v: unknown): EdgeCase[] =>
  (Array.isArray(v) ? v : []).filter(isObj).map((e) => ({
    tag: str(e.tag),
    archetype: str(e.archetype) || null,
    complexity: str(e.complexity) || null,
    products: Array.isArray(e.products) ? e.products.map(String) : [],
    context: str(e.context),
    twist: str(e.twist),
    source: str(e.source) || null,
    name: str(e.name) || null,
  }));

export interface VerifierSlot {
  id: string;
  criterionId: string | null;
  label: string;
  type: 'enum' | 'text' | 'number';
  choices: string[];
  required: boolean;
}
export interface AllowedCheck {
  table: string;
  row: 'case' | 'any';
  /** Field -> allowed values (an enum) or "string" / "number" (free value of that type). */
  fields: Record<string, string[] | 'string' | 'number'>;
  ops: string[];
}
export interface VerifierBlockView {
  id: string;
  criterionId: string;
  kind: 'state' | 'process' | 'rubric';
  name: string;
  onFail: string;
  /** State blocks: the generated query, for reviewers. */
  queryPreview: string | null;
  table: string | null;
  column: string | null;
  op: string | null;
  /** State blocks: where the expected value comes from (never the case-reference path itself). */
  valueSource: 'fixed' | 'slot' | 'case_reference' | null;
  fixedValue: unknown;
  slotId: string | null;
  mustCall: string | null;
  before: string | null;
  after: string | null;
  rubricId: string | null;
  sharePercent: number | null;
}
export interface TemplateVerifiers {
  expectedValuesFrom: 'case_reference' | 'sme';
  failureTaxonomy: string[];
  slots: VerifierSlot[];
  allowedChecks: AllowedCheck[];
  blocks: VerifierBlockView[];
}

/** Checks `authoring.verifiers` (spec 2.2). Case-reference paths and reference answers are refused: they are Studio's. */
export function verifierProblems(v: unknown): SchemaProblem[] {
  const P = '/authoring/verifiers';
  if (!isObj(v)) return [{ pointer: P, message: 'authoring.verifiers must be an object.' }];
  const out: SchemaProblem[] = [];
  const known = ['schema', 'expected_values_from', 'failure_taxonomy', 'slots', 'allowed_checks', 'blocks'];
  for (const k of Object.keys(v)) if (!known.includes(k)) out.push({ pointer: `${P}/${k}`, message: `Unknown verifiers field "${k}".`, ...(k === 'reference_answers' ? { private: true } : {}) });
  if (v.schema !== VERIFIERS_SCHEMA) out.push({ pointer: `${P}/schema`, message: `schema must be "${VERIFIERS_SCHEMA}".` });
  const from = v.expected_values_from;
  if (from !== 'case_reference' && from !== 'sme') out.push({ pointer: `${P}/expected_values_from`, message: 'expected_values_from must be "case_reference" or "sme".' });
  const taxonomy = Array.isArray(v.failure_taxonomy) ? v.failure_taxonomy.map(String) : [];
  if (!Array.isArray(v.failure_taxonomy) || !taxonomy.length) out.push({ pointer: `${P}/failure_taxonomy`, message: 'failure_taxonomy must list at least one failure code.' });
  const slots = v.slots ?? [];
  const checks = v.allowed_checks ?? [];
  if (!Array.isArray(slots)) out.push({ pointer: `${P}/slots`, message: 'slots must be an array.' });
  if (!Array.isArray(checks)) out.push({ pointer: `${P}/allowed_checks`, message: 'allowed_checks must be an array.' });
  if (from === 'case_reference' && ((Array.isArray(slots) && slots.length) || (Array.isArray(checks) && checks.length))) out.push({ pointer: `${P}/slots`, message: 'With expected_values_from "case_reference", slots and allowed_checks must be empty: SMEs fill nothing.' });
  const slotIds = new Set<string>();
  if (Array.isArray(slots))
    slots.forEach((s, i) => {
      const p = `${P}/slots/${i}`;
      if (!isObj(s)) return out.push({ pointer: p, message: 'A slot must be an object.' });
      if (typeof s.id !== 'string' || !SLOT_ID.test(s.id)) out.push({ pointer: `${p}/id`, message: 'Slot id is required: lowercase letters, digits and underscores.' });
      else if (slotIds.has(s.id)) out.push({ pointer: `${p}/id`, message: `Duplicate slot id "${s.id}".` });
      else slotIds.add(s.id);
      if (!['enum', 'text', 'number', 'choice'].includes(str(s.type))) out.push({ pointer: `${p}/type`, message: 'Slot type must be enum, text or number.' });
      if (s.choices !== undefined && (!Array.isArray(s.choices) || !s.choices.length || s.choices.some((c) => typeof c !== 'string'))) out.push({ pointer: `${p}/choices`, message: 'choices must be a non-empty list of values.' });
      if ((s.type === 'enum' || s.type === 'choice') && !Array.isArray(s.choices)) out.push({ pointer: `${p}/choices`, message: 'An enum slot needs choices.' });
    });
  if (Array.isArray(checks))
    checks.forEach((c, i) => {
      const p = `${P}/allowed_checks/${i}`;
      if (!isObj(c) || typeof c.table !== 'string' || !c.table) return out.push({ pointer: p, message: 'An allowed check needs a table.' });
      if (c.row !== 'case' && c.row !== 'any') out.push({ pointer: `${p}/row`, message: 'row must be "case" or "any".' });
      if (!isObj(c.fields) || !Object.keys(c.fields).length) out.push({ pointer: `${p}/fields`, message: 'fields must name at least one field.' });
      else for (const [f, t] of Object.entries(c.fields)) if (!(t === 'string' || t === 'number' || (Array.isArray(t) && t.length && t.every((x) => typeof x === 'string')))) out.push({ pointer: `${p}/fields/${f}`, message: 'A field is a list of values, "string" or "number".' });
      if (!Array.isArray(c.ops) || !c.ops.length || c.ops.some((o) => !(CHECK_OPS as readonly string[]).includes(String(o)))) out.push({ pointer: `${p}/ops`, message: `ops must be from ${CHECK_OPS.join(', ')}.` });
    });
  if (!Array.isArray(v.blocks)) out.push({ pointer: `${P}/blocks`, message: 'blocks is required (it may be empty).' });
  else
    v.blocks.forEach((b, i) => {
      const p = `${P}/blocks/${i}`;
      if (!isObj(b)) return out.push({ pointer: p, message: 'A block must be an object.' });
      if (typeof b.id !== 'string' || !b.id) out.push({ pointer: `${p}/id`, message: 'Block id is required.' });
      if (!['state', 'process', 'rubric'].includes(str(b.kind))) out.push({ pointer: `${p}/kind`, message: 'kind must be state, process or rubric.' });
      if (taxonomy.length && !taxonomy.includes(str(b.on_fail))) out.push({ pointer: `${p}/on_fail`, message: 'on_fail must be one of failure_taxonomy.' });
      const val = b.value;
      if (isObj(val)) {
        if ('case_reference' in val) out.push({ pointer: `${p}/value`, private: true, message: 'Case-reference values are private grading data and are not sent to Authoring.' });
        if (isObj(val) && typeof val.slot === 'string' && !slotIds.has(val.slot)) out.push({ pointer: `${p}/value/slot`, message: `Block names slot "${val.slot}", which is not in slots.` });
      }
    });
  return out;
}

const blockView = (b: Record<string, unknown>, criterionId: string): VerifierBlockView => {
  const val = isObj(b.value) ? b.value : null;
  const slot = val ? (typeof val.slot === 'string' ? val.slot : isObj(val.slot) ? str(val.slot.id) : null) : null;
  const valueSource = !val ? null : 'fixed' in val ? 'fixed' : slot ? 'slot' : 'case_reference' in val ? 'case_reference' : null;
  const table = str(b.table) || null;
  const column = str(b.column) || null;
  const op = str(b.op) || null;
  const generated = b.kind === 'state' && table ? `SELECT ${column ?? '*'} FROM ${table}${b.row === 'case' ? ' WHERE application_id = :case_id' : ''}   -- ${op ?? 'check'} ${slot ? `:${slot}` : valueSource === 'fixed' ? JSON.stringify(val!.fixed) : ':expected'}` : null;
  return {
    id: str(b.id),
    criterionId: str(b.criterion_id) || criterionId,
    kind: (['state', 'process', 'rubric'].includes(str(b.kind)) ? b.kind : 'state') as VerifierBlockView['kind'],
    name: str(b.name) || str(b.id),
    onFail: str(b.on_fail),
    queryPreview: b.kind === 'state' ? str(b.query_preview) || generated : null,
    table,
    column,
    op,
    valueSource,
    fixedValue: valueSource === 'fixed' ? val!.fixed : null,
    slotId: slot,
    mustCall: str(b.must_call) || null,
    before: str(b.before) || null,
    after: str(b.after) || null,
    rubricId: str(b.rubric_id) || null,
    sharePercent: typeof b.share_percent === 'number' ? b.share_percent : null,
  };
};

const slotView = (s: Record<string, unknown>, criterionId: string | null): VerifierSlot => {
  const choices = Array.isArray(s.choices) ? s.choices.map(String) : [];
  const t = str(s.type);
  return { id: str(s.id), criterionId: str(s.criterion_id) || criterionId, label: str(s.label) || str(s.id), type: t === 'number' ? 'number' : choices.length || t === 'enum' || t === 'choice' ? 'enum' : 'text', choices, required: s.required === undefined ? true : s.required === true };
};

/**
 * The verifiers of a template version, from either place Studio may put them: `authoring.verifiers` (spec 2.2, the
 * place Authoring asks for) or `execution.verifier_blocks` (adi.verifier-blocks.v1 per criterion, what Studio's
 * proposal builder sends today). Null when the template has none. Case-reference paths are never kept in the view.
 */
export function templateVerifiers(anvilSpec: unknown): TemplateVerifiers | null {
  if (!isObj(anvilSpec)) return null;
  const authoring = isObj(anvilSpec.authoring) ? anvilSpec.authoring : {};
  const execution = isObj(anvilSpec.execution) ? anvilSpec.execution : {};
  const v = authoring.verifiers;
  if (isObj(v)) {
    return {
      expectedValuesFrom: v.expected_values_from === 'sme' ? 'sme' : 'case_reference',
      failureTaxonomy: Array.isArray(v.failure_taxonomy) ? v.failure_taxonomy.map(String) : [],
      slots: (Array.isArray(v.slots) ? v.slots : []).filter(isObj).map((s) => slotView(s, null)),
      allowedChecks: (Array.isArray(v.allowed_checks) ? v.allowed_checks : []).filter(isObj).map((c) => ({ table: str(c.table), row: c.row === 'case' ? 'case' : 'any', fields: (isObj(c.fields) ? c.fields : {}) as AllowedCheck['fields'], ops: Array.isArray(c.ops) ? c.ops.map(String) : [] })),
      blocks: (Array.isArray(v.blocks) ? v.blocks : []).filter(isObj).map((b) => blockView(b, '')),
    };
  }
  const vb = execution.verifier_blocks;
  if (isObj(vb) && Array.isArray(vb.criteria)) {
    const slots = new Map<string, VerifierSlot>();
    const blocks: VerifierBlockView[] = [];
    for (const c of vb.criteria.filter(isObj)) {
      const cid = str(c.criterion_id);
      for (const b of (Array.isArray(c.blocks) ? c.blocks : []).filter(isObj)) {
        blocks.push(blockView(b, cid));
        const val = isObj(b.value) ? b.value : null;
        if (val && isObj(val.slot) && typeof val.slot.id === 'string' && !slots.has(val.slot.id)) slots.set(val.slot.id, slotView(val.slot, cid));
      }
    }
    const sme = vb.expected_values_from === 'sme';
    return { expectedValuesFrom: sme ? 'sme' : 'case_reference', failureTaxonomy: Array.isArray(vb.failure_taxonomy) ? vb.failure_taxonomy.map(String) : [], slots: sme ? [...slots.values()] : [], allowedChecks: [], blocks };
  }
  return null;
}

/** S1 slice-tag pick lists (spec 1.2): the template's `complexity` and `archetype` options, never hard-coded. */
export function sliceLists(profile: unknown): { complexity: string[]; archetype: string[] } {
  const out = { complexity: [] as string[], archetype: [] as string[] };
  const s1 = isObj(profile) && Array.isArray(profile.sections) ? profile.sections.filter(isObj).find((s) => s.key === 'S1') : undefined;
  for (const f of (s1 && Array.isArray(s1.fields) ? s1.fields : []).filter(isObj))
    if (f.key === 'complexity' || f.key === 'archetype') out[f.key] = (Array.isArray(f.options) ? f.options : []).map((o) => (isObj(o) ? str(o.value) : str(o))).filter(Boolean);
  return out;
}

/** What the SME fills for a task (stored server-side on the task; copied into the package's private part). */
export const ExtraStateCheck = z.object({ table: z.string().min(1).max(80), row: z.enum(['case', 'any']), column: z.string().min(1).max(80), op: z.enum(CHECK_OPS), value: z.union([z.string().max(500), z.number()]) }).strict();
export type ExtraStateCheck = z.infer<typeof ExtraStateCheck>;
/**
 * E-001 §6b (owner, 24 Nov 2026): the task's focus on an edge-case family: every variant that counts ("all", including
 * variants added later) or the ones the SME chose. Stored beside `edgeCase`, never in place of it.
 */
export const FamilyFocus = z
  .object({
    familyId: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,99}$/),
    variants: z.union([z.literal('all'), z.array(z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,99}$/)).min(1).max(100)]),
  })
  .strict();
export type FamilyFocus = z.infer<typeof FamilyFocus>;

export const TaskBenchmarkInput = z
  .object({
    /** The template edge case this task focuses on (at most one; spec 5 question 2, proposed). */
    edgeCase: z.string().regex(TAG).nullable().default(null),
    /** E-001 §6b: the family focus, when the SME chose one (additive: older tasks keep only `edgeCase`). */
    familyFocus: FamilyFocus.nullable().optional(),
    slots: z.record(z.string().regex(SLOT_ID), z.union([z.string().max(2000), z.number()])).default({}),
    extraStateChecks: z.array(ExtraStateCheck).max(10).default([]),
  })
  .strict();
export type TaskBenchmarkInput = z.infer<typeof TaskBenchmarkInput>;
export const SaveTaskBenchmarkRequest = TaskBenchmarkInput.extend({ expectedVersion: z.number().int().min(0) }).strict();

/** Problems with a task's benchmark input against its template. `forApproval` also requires every required slot. */
export function benchmarkInputProblems(input: TaskBenchmarkInput, t: { edgeCases: EdgeCase[]; verifiers: TemplateVerifiers | null }, opts: { forApproval?: boolean } = {}): string[] {
  const out: string[] = [];
  if (input.edgeCase && !t.edgeCases.some((e) => e.tag === input.edgeCase)) out.push(`Edge case "${input.edgeCase}" is not one of this template's edge cases.`);
  const sme = t.verifiers?.expectedValuesFrom === 'sme';
  const slots = sme ? t.verifiers!.slots : [];
  for (const id of Object.keys(input.slots)) if (!slots.some((s) => s.id === id)) out.push(`"${id}" is not an expected-result field of this template.`);
  for (const s of slots) {
    const v = input.slots[s.id];
    const blank = v === undefined || (typeof v === 'string' && !v.trim());
    if (blank) {
      if (opts.forApproval && s.required) out.push(`Expected result "${s.label}" is required.`);
      continue;
    }
    if (s.choices.length && !s.choices.includes(String(v))) out.push(`"${s.label}" must be one of ${s.choices.join(', ')}.`);
    if (s.type === 'number' && typeof v !== 'number') out.push(`"${s.label}" must be a number.`);
  }
  if (input.extraStateChecks.length && !sme) out.push('This template does not take state checks from SMEs.');
  else
    input.extraStateChecks.forEach((c, i) => {
      const allowed = t.verifiers!.allowedChecks.find((a) => a.table === c.table && a.row === c.row);
      const n = `State check ${i + 1}`;
      if (!allowed) return out.push(`${n}: table "${c.table}" (row ${c.row}) is not allowed.`);
      const field = allowed.fields[c.column];
      if (field === undefined) return out.push(`${n}: field "${c.column}" is not allowed on ${c.table}.`);
      if (!allowed.ops.includes(c.op)) out.push(`${n}: operator "${c.op}" is not allowed on ${c.table}.`);
      if (Array.isArray(field) && !field.includes(String(c.value))) out.push(`${n}: "${String(c.value)}" is not one of ${field.join(', ')}.`);
      if (field === 'number' && typeof c.value !== 'number') out.push(`${n}: the value must be a number.`);
    });
  return out;
}

/** SME needs (spec 1.4-1.5; F-11). */
export const NEED_KINDS = ['new_case_kind', 'more_data'] as const;
export const NEED_STATES = ['open', 'merged', 'sent', 'rejected'] as const;
export const RaiseNeedRequest = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new_case_kind'),
    context: z.string().trim().min(10).max(2000),
    twist: z.string().trim().min(10).max(2000),
    expectedOutcome: z.string().trim().min(5).max(2000),
    complexity: z.string().trim().min(1).max(64),
    archetype: z.string().trim().min(1).max(64),
  }).strict(),
  z.object({ kind: z.literal('more_data'), edgeCase: z.string().regex(TAG), howMany: z.number().int().min(1).max(1000), why: z.string().trim().min(5).max(2000) }).strict(),
]);
export type RaiseNeedRequest = z.infer<typeof RaiseNeedRequest>;
