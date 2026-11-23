import { z } from 'zod';

/**
 * E-002 §4.1 (owner decisions 23 Nov 2026): a policy clause's condition is a structured predicate over logical facts
 * (Studio's draft contracts clause-condition.v1 and fact-catalog.v1, commit d27063d), never over template fields, and it
 * is shown in plain language. The project scope declares the facts used for suggestions; the template maps them to the
 * environment's facts at runtime. null means the clause applies wherever the project's approved scope applies.
 */

export const FACT_ID = /^[a-z][a-z0-9_]{0,63}$/;
export const CLAUSE_OPS = ['eq', 'ne', 'in', 'not_in', 'lt', 'lte', 'gt', 'gte', 'between', 'present', 'absent'] as const;
export type ConditionOp = (typeof CLAUSE_OPS)[number];

const Scalar = z.union([z.string().max(200), z.number(), z.boolean()]);

export interface ConditionCompare {
  fact: string;
  op: ConditionOp;
  value?: string | number | boolean | (string | number | boolean)[];
  label?: string;
}
export type ConditionPredicate = ConditionCompare | { all: ConditionPredicate[] } | { any: ConditionPredicate[] } | { not: ConditionPredicate };

export const ConditionCompare: z.ZodType<ConditionCompare> = z
  .object({ fact: z.string().regex(FACT_ID), op: z.enum(CLAUSE_OPS), value: z.union([Scalar, z.array(Scalar).max(50)]).optional(), label: z.string().max(300).optional() })
  .strict();
export const ConditionPredicate: z.ZodType<ConditionPredicate> = z.lazy(() =>
  z.union([ConditionCompare, z.object({ all: z.array(ConditionPredicate).min(1).max(20) }).strict(), z.object({ any: z.array(ConditionPredicate).min(1).max(20) }).strict(), z.object({ not: ConditionPredicate }).strict()]),
);
/** clause-condition.v1: null (applies across the approved scope) or a predicate. */
export const ClauseCondition = ConditionPredicate.nullable();
export type ClauseCondition = ConditionPredicate | null;

export const FactDef = z
  .object({
    id: z.string().regex(FACT_ID),
    label: z.string().max(200).optional(),
    type: z.enum(['string', 'number', 'boolean', 'date', 'enum']),
    unit: z.string().max(40).optional(),
    allowed_values: z.array(Scalar).max(500).optional(),
    operators: z.array(z.enum(CLAUSE_OPS)).optional(),
    availability: z.string().min(1).max(60),
    source: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type FactDef = z.infer<typeof FactDef>;

/** fact-catalog.v1. */
export const FactCatalog = z
  .object({
    schema_version: z.literal('adi.utility.fact-catalog.v1'),
    catalog_id: z.string().regex(/^[a-z][a-z0-9_.:-]{1,199}$/),
    version: z.number().int().min(1),
    owner: z.object({ kind: z.enum(['project_scope', 'environment_version']), id: z.string().min(1) }).strict(),
    facts: z.array(FactDef).max(500),
  })
  .strict();
export type FactCatalog = z.infer<typeof FactCatalog>;

const DEFAULT_OPS: Record<FactDef['type'], ConditionOp[]> = {
  string: ['eq', 'ne', 'in', 'not_in', 'present', 'absent'],
  enum: ['eq', 'ne', 'in', 'not_in', 'present', 'absent'],
  boolean: ['eq', 'ne', 'present', 'absent'],
  number: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'between', 'present', 'absent'],
  date: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'between', 'present', 'absent'],
};
export const opsFor = (f: FactDef): ConditionOp[] => f.operators ?? DEFAULT_OPS[f.type];

const isCompare = (p: ConditionPredicate): p is ConditionCompare => 'fact' in p;
const valueOk = (f: FactDef, v: unknown) => {
  if (f.allowed_values?.length) return f.allowed_values.includes(v as never);
  if (f.type === 'number') return typeof v === 'number';
  if (f.type === 'boolean') return typeof v === 'boolean';
  if (f.type === 'date') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
  return typeof v === 'string' && v.length > 0;
};

/**
 * Problems with a condition against the project's fact catalog: unknown facts, operators the fact does not allow,
 * and values of the wrong kind or outside the allowed values. An empty list means it can be approved.
 */
export function conditionProblems(cond: ClauseCondition, catalog: Pick<FactCatalog, 'facts'> | null, path = 'condition'): string[] {
  if (cond === null) return [];
  if (!isCompare(cond)) {
    if ('all' in cond) return cond.all.flatMap((p, i) => conditionProblems(p, catalog, `${path}.all[${i}]`));
    if ('any' in cond) return cond.any.flatMap((p, i) => conditionProblems(p, catalog, `${path}.any[${i}]`));
    return conditionProblems(cond.not, catalog, `${path}.not`);
  }
  if (!catalog) return [`${path}: the project has no fact catalog yet, so conditions cannot be checked (setup needed).`];
  const f = catalog.facts.find((x) => x.id === cond.fact);
  if (!f) return [`${path}: "${cond.fact}" is not a fact in the project's fact catalog.`];
  const out: string[] = [];
  if (!opsFor(f).includes(cond.op)) out.push(`${path}: ${f.label ?? f.id} does not allow the operator "${cond.op}".`);
  const v = cond.value;
  if (cond.op === 'present' || cond.op === 'absent') {
    if (v !== undefined) out.push(`${path}: "${cond.op}" takes no value.`);
  } else if (cond.op === 'in' || cond.op === 'not_in') {
    if (!Array.isArray(v) || !v.length) out.push(`${path}: "${cond.op}" needs a list of values.`);
    else for (const x of v) if (!valueOk(f, x)) out.push(`${path}: ${JSON.stringify(x)} is not a valid value for ${f.label ?? f.id}.`);
  } else if (cond.op === 'between') {
    if (!Array.isArray(v) || v.length !== 2) out.push(`${path}: "between" needs [low, high].`);
    else for (const x of v) if (!valueOk(f, x)) out.push(`${path}: ${JSON.stringify(x)} is not a valid value for ${f.label ?? f.id}.`);
  } else if (v === undefined || Array.isArray(v)) out.push(`${path}: "${cond.op}" needs one value.`);
  else if (!valueOk(f, v)) out.push(`${path}: ${JSON.stringify(v)} is not a valid value for ${f.label ?? f.id}.`);
  return out;
}

const OP_WORDS: Record<ConditionOp, string> = { eq: 'is', ne: 'is not', in: 'is one of', not_in: 'is none of', lt: 'is before / less than', lte: 'is on or before / at most', gt: 'is after / more than', gte: 'is on or after / at least', between: 'is between', present: 'is known', absent: 'is not known' };
const val = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : String(v));

/** The plain-language form of a condition ("Governing state is CA, and Product is one of individual, adult_joint"). */
export function conditionLabel(cond: ClauseCondition, catalog: Pick<FactCatalog, 'facts'> | null = null): string {
  if (cond === null) return 'Applies wherever the project’s approved scope applies.';
  if (!isCompare(cond)) {
    if ('all' in cond) return cond.all.map((p) => conditionLabel(p, catalog)).join(', and ');
    if ('any' in cond) return `any of: ${cond.any.map((p) => conditionLabel(p, catalog)).join('; or ')}`;
    return `not (${conditionLabel(cond.not, catalog)})`;
  }
  if (cond.label) return cond.label;
  const f = catalog?.facts.find((x) => x.id === cond.fact);
  const name = f?.label ?? cond.fact;
  const words = cond.op === 'between' && Array.isArray(cond.value) ? `is between ${cond.value[0]} and ${cond.value[1]}` : `${OP_WORDS[cond.op]}${cond.value === undefined ? '' : ` ${val(cond.value)}`}`;
  return `${name} ${words}`;
}

/** The logical facts a condition uses (for the S4 picker: is every one bound by the template?). */
export function conditionFacts(cond: ClauseCondition): string[] {
  if (cond === null) return [];
  if (isCompare(cond)) return [cond.fact];
  if ('all' in cond) return [...new Set(cond.all.flatMap(conditionFacts))];
  if ('any' in cond) return [...new Set(cond.any.flatMap(conditionFacts))];
  return conditionFacts(cond.not);
}

/** coverage-check.v1 (Studio's answer to Validate). */
export const CoverageGap = z.object({ kind: z.enum(['tool', 'fact', 'field', 'allowed_value', 'document_kind', 'evidence', 'cases']), ref: z.string(), message: z.string() }).strict();
export const CoverageStatus = z.enum(['supported', 'needs_data', 'needs_environment_change']);
export const CoverageCheck = z
  .object({
    schema_version: z.literal('adi.utility.coverage-check.v1'),
    environment_version_id: z.string(),
    template: z.object({ template_id: z.string().optional(), version: z.number().int().min(1).optional() }).strict().optional(),
    checked_at: z.string(),
    edge_cases: z.array(z.object({ tag: z.string(), status: CoverageStatus, have: z.record(z.string(), z.number().int()).optional(), minimum_per_product: z.number().int().optional(), gaps: z.array(CoverageGap) }).passthrough()),
    clauses: z.array(z.object({ clause_id: z.string(), version: z.number().int(), status: CoverageStatus, gaps: z.array(CoverageGap) }).passthrough()),
  })
  .strict();
export type CoverageCheck = z.infer<typeof CoverageCheck>;

/** What Validate shows for a status, in plain words. */
export const COVERAGE_WORDS: Record<z.infer<typeof CoverageStatus>, string> = {
  supported: 'Supported: the environment can run this.',
  needs_data: 'Needs data: the tools and facts exist, but there are fewer cases than the minimum. A person generates more in Studio.',
  needs_environment_change: 'Needs an environment change: a tool, fact, field or value is missing. The run is blocked until Studio fixes it.',
};
