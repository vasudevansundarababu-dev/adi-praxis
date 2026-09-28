import { z } from 'zod';
import type { SmeTier } from './supply';

/**
 * M10b certification rules shared by the API and the apps (docs/SME-SUPPLY.md section 7). The correct answer of every
 * generated question is derived from its variables by the family's `answerRule` — a small, declarative rule language
 * executed here, never by a model.
 */

// ── Tier defaults (section 7.2; editable per blueprint before approval) ──

export const OBJECTIVE_TYPES = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'LABEL', 'ORDERING', 'SEVERITY', 'TRAJECTORY_REVIEW'] as const;
export const WRITTEN_TYPES = ['JUSTIFICATION', 'CRITIQUE', 'AUTHORING'] as const;
export const ITEM_TYPES = [...OBJECTIVE_TYPES, ...WRITTEN_TYPES] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const isWritten = (t: string) => (WRITTEN_TYPES as readonly string[]).includes(t);

export const PassRules = z.object({
  /** Minimum overall score, in percent (objective items, plus confirmed written scores where the tier counts them). */
  overallPct: z.number().min(0).max(100),
  /** Reviewer tier: share of planted errors found across trajectory reviews. */
  plantedErrorsPct: z.number().min(0).max(100).nullable().default(null),
  noCriticalMiss: z.boolean().default(true),
  /** A written answer passes at or above this confirmed score (0–1). */
  writtenPassScore: z.number().min(0).max(1).default(0.7),
  /** People who must confirm each written grade (Expert authoring task: 2). */
  confirmationsRequired: z.number().int().min(1).max(3).default(1),
  /** Expert: written items are judged on their own; the overall percentage covers objective items only. */
  objectiveOnlyOverall: z.boolean().default(false),
});
export type PassRules = z.infer<typeof PassRules>;

export interface TierDefaults {
  itemCount: number;
  authoringTask: boolean;
  timeLimitMinutes: number;
  passRules: PassRules;
  itemTypes: ItemType[];
  cognitiveLevels: string[];
  prerequisite: SmeTier | null;
}

export const TIER_DEFAULTS: Record<SmeTier, TierDefaults> = {
  ANNOTATOR: {
    itemCount: 25,
    authoringTask: false,
    timeLimitMinutes: 40,
    passRules: { overallPct: 80, plantedErrorsPct: null, noCriticalMiss: true, writtenPassScore: 0.7, confirmationsRequired: 1, objectiveOnlyOverall: false },
    itemTypes: ['SINGLE_CHOICE', 'MULTI_CHOICE', 'LABEL', 'ORDERING'],
    cognitiveLevels: ['remember', 'apply'],
    prerequisite: null,
  },
  REVIEWER_SME: {
    itemCount: 35,
    authoringTask: false,
    timeLimitMinutes: 60,
    passRules: { overallPct: 85, plantedErrorsPct: 80, noCriticalMiss: true, writtenPassScore: 0.7, confirmationsRequired: 1, objectiveOnlyOverall: false },
    itemTypes: ['TRAJECTORY_REVIEW', 'SEVERITY', 'JUSTIFICATION'],
    cognitiveLevels: ['analyse', 'evaluate'],
    prerequisite: null,
  },
  EXPERT: {
    itemCount: 20,
    authoringTask: true,
    timeLimitMinutes: 120,
    passRules: { overallPct: 85, plantedErrorsPct: null, noCriticalMiss: true, writtenPassScore: 0.7, confirmationsRequired: 2, objectiveOnlyOverall: true },
    itemTypes: ['CRITIQUE', 'SINGLE_CHOICE', 'SEVERITY'],
    cognitiveLevels: ['evaluate', 'create'],
    prerequisite: 'REVIEWER_SME',
  },
};

/** Test retakes: 48 h apart, at most 2 retakes (3 attempts), then human review. Certificates last 12 months. */
export const RETAKE_COOLDOWN_HOURS = 48;
export const MAX_ATTEMPTS = 3;
export const CERTIFICATE_MONTHS = 12;
/** A module's quiz is passed at this share of correct answers; it may be retried at once. */
export const QUIZ_PASS = 0.8;

// ── Variables and answer rules ──

export const VariableSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('int'), min: z.number().int(), max: z.number().int() }),
  z.object({ type: z.literal('choice'), values: z.array(z.string().min(1)).min(1).max(50) }),
  z.object({ type: z.literal('bool') }),
  /** A random subset of the given ids (e.g. which trajectory steps carry a planted error). */
  z.object({ type: z.literal('subset'), of: z.array(z.string().min(1)).min(1).max(30), min: z.number().int().min(0), max: z.number().int().min(0) }),
]);
export type VariableSpec = z.infer<typeof VariableSpec>;
export const VariableSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), VariableSpec);
export type VariableSchema = z.infer<typeof VariableSchema>;

const Op = z.enum(['>=', '>', '<=', '<', '==', '!=']);
const Condition = z.object({ variable: z.string(), op: Op, value: z.union([z.number(), z.string(), z.boolean()]) });

export const AnswerRule = z.discriminatedUnion('kind', [
  /** One outcome when the condition holds, another when it does not. */
  z.object({ kind: z.literal('threshold'), variable: z.string(), op: Op, value: z.union([z.number(), z.string(), z.boolean()]), then: z.string(), else: z.string() }),
  /** When every condition holds (e.g. owner ≥ 25% AND via a trust). */
  z.object({ kind: z.literal('all_of'), conditions: z.array(Condition).min(1).max(6), then: z.string(), else: z.string() }),
  /** The answer is looked up from a choice variable. */
  z.object({ kind: z.literal('lookup'), variable: z.string(), map: z.record(z.string(), z.string()), default: z.string().optional() }),
  /** Every value of a choice variable that satisfies a condition set (multi-select). */
  z.object({ kind: z.literal('select'), variables: z.array(z.string()).min(1).max(10), when: z.object({ op: Op, value: z.union([z.number(), z.string(), z.boolean()]) }) }),
  /** A fixed correct order of steps (presented shuffled). */
  z.object({ kind: z.literal('order'), steps: z.array(z.string().min(1)).min(2).max(12) }),
  /** The planted errors of a trajectory: the subset variable itself. */
  z.object({ kind: z.literal('planted'), variable: z.string() }),
  /** Written answer: graded against a rubric by the model as a recommendation, confirmed by people. */
  z.object({ kind: z.literal('written'), rubric: z.array(z.object({ criterion: z.string().min(3), weight: z.number().min(1).max(100) })).min(1).max(10) }),
]);
export type AnswerRule = z.infer<typeof AnswerRule>;

export type Variables = Record<string, number | string | boolean | string[]>;
export type Key = string | string[] | null;

/** A seeded pseudo-random generator (mulberry32) so sampling is reproducible from a seed. */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleVariables(schema: VariableSchema, random: () => number): Variables {
  const out: Variables = {};
  for (const [name, spec] of Object.entries(schema)) {
    if (spec.type === 'int') out[name] = spec.min + Math.floor(random() * (spec.max - spec.min + 1));
    else if (spec.type === 'choice') out[name] = spec.values[Math.floor(random() * spec.values.length)]!;
    else if (spec.type === 'bool') out[name] = random() < 0.5;
    else {
      const n = spec.min + Math.floor(random() * (Math.min(spec.max, spec.of.length) - spec.min + 1));
      out[name] = [...spec.of].sort(() => random() - 0.5).slice(0, n).sort();
    }
  }
  return out;
}

function test(left: unknown, op: z.infer<typeof Op>, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return op === '>=' ? left >= right : op === '>' ? left > right : op === '<=' ? left <= right : op === '<' ? left < right : op === '==' ? left === right : left !== right;
  const eq = String(left) === String(right);
  if (op === '==') return eq;
  if (op === '!=') return !eq;
  return false;
}

/** The correct answer, computed from the variables. Throws if the rule refers to a missing variable. */
export function deriveKey(rule: AnswerRule, vars: Variables): Key {
  const v = (name: string) => {
    if (!(name in vars)) throw new Error(`Answer rule refers to unknown variable "${name}"`);
    return vars[name];
  };
  switch (rule.kind) {
    case 'threshold':
      return test(v(rule.variable), rule.op, rule.value) ? rule.then : rule.else;
    case 'all_of':
      return rule.conditions.every((c) => test(v(c.variable), c.op, c.value)) ? rule.then : rule.else;
    case 'lookup':
      return rule.map[String(v(rule.variable))] ?? rule.default ?? null;
    case 'select':
      return rule.variables.filter((n) => test(v(n), rule.when.op, rule.when.value)).sort();
    case 'order':
      return [...rule.steps];
    case 'planted': {
      const x = v(rule.variable);
      return Array.isArray(x) ? [...x].sort() : null;
    }
    case 'written':
      return null;
  }
}

/** Every outcome a choice rule can produce must be one of the family's options. */
export function ruleProblems(rule: AnswerRule, schema: VariableSchema, options: string[]): string[] {
  const p: string[] = [];
  const need = (n: string) => !(n in schema) && p.push(`Unknown variable "${n}"`);
  if (rule.kind === 'threshold') {
    need(rule.variable);
    for (const o of [rule.then, rule.else]) if (!options.includes(o)) p.push(`Outcome "${o}" is not an option`);
  } else if (rule.kind === 'all_of') {
    rule.conditions.forEach((c) => need(c.variable));
    for (const o of [rule.then, rule.else]) if (!options.includes(o)) p.push(`Outcome "${o}" is not an option`);
  } else if (rule.kind === 'lookup') {
    need(rule.variable);
    for (const o of Object.values(rule.map)) if (!options.includes(o)) p.push(`Outcome "${o}" is not an option`);
  } else if (rule.kind === 'select') rule.variables.forEach(need);
  else if (rule.kind === 'planted') {
    need(rule.variable);
    if (schema[rule.variable] && schema[rule.variable]!.type !== 'subset') p.push('A planted-error rule needs a subset variable');
  }
  return p;
}

const same = (a: Key, b: unknown) => {
  if (Array.isArray(a)) return Array.isArray(b) && [...b].map(String).sort().join('|') === [...a].sort().join('|');
  return typeof b === 'string' && b === a;
};
/** Ordering keeps its order; other multi-answers are compared as sets. */
export function isCorrect(type: string, key: Key, answer: unknown): boolean {
  if (type === 'ORDERING') return Array.isArray(answer) && Array.isArray(key) && answer.join('|') === key.join('|');
  return same(key, answer);
}

/** Reviewer tier: planted errors found (true positives) and flagged in total. */
export function plantedScore(key: string[], answer: unknown) {
  const picked = Array.isArray(answer) ? answer.map(String) : [];
  const found = key.filter((k) => picked.includes(k)).length;
  return { found, planted: key.length, falsePositives: picked.filter((x) => !key.includes(x)).length };
}

/** Fills {variable} placeholders in a stem pattern (the mock and a fallback; the model writes the real wording). */
export const fillPattern = (pattern: string, vars: Variables) => pattern.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (m, n) => (n in vars ? (Array.isArray(vars[n]) ? (vars[n] as string[]).join(', ') : String(vars[n])) : m));

export const canonicalVariables = (vars: Variables) => JSON.stringify(Object.keys(vars).sort().map((k) => [k, Array.isArray(vars[k]) ? [...(vars[k] as string[])].sort() : vars[k]]));
