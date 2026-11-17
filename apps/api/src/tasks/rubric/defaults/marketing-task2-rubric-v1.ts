import { GOLDEN_MARKETING_EXAMPLE, MARKETING_T2_CRITICAL_LABELS, MARKETING_T2_PROFILE_IDS, type CriterionDefault } from '@praxis/shared';

/**
 * D22 (QA, 16 Nov 2026; D8 'template default, SME edits'): default criteria for the Marketing Task2 rubric evaluator,
 * kept in Authoring only (template data unchanged). Source: the reviewed 0-4 rubric of the Golden Task2 example
 * (`GOLDEN_MARKETING_EXAMPLE`, S7): name, group, weight, Level 4, Level 2 and Level 0 text, and its critical flags.
 *
 * D28 (QA, 17 Nov 2026): criteria arrive complete, so the SME only reviews.
 * - Every level of the 0-4 scale has text. The example writes Levels 4, 2 and 0; Levels 3 and 1 are the scale's
 *   in-between levels and say exactly that, quoting the neighbouring levels' own text (nothing new is assessed).
 * - When it applies: required throughout the workflow (one reusable task; every criterion is scored on every run).
 * - Derived from: the template rubric criterion.
 * - E3 Readiness is critical, as in the example, with its whole-task failure condition from critical rule CR-05.
 *   (The example also marks G2 critical; the owner asked for E3 only, so G2 stays as before.)
 * - `earlier`: what the D22 defaults filled in. A criterion still exactly so takes these defaults on open; anything an
 *   author changed is kept.
 */
const golden = (GOLDEN_MARKETING_EXAMPLE.sections as { S7: { criteria: Record<string, unknown>[] } }).S7.criteria;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const quote = (s: string | undefined) => (s ?? '').trim().replace(/\.$/, '');
const between = (higher: string, upper: string | undefined, lower: string, under: string | undefined) => `Between ${higher} and ${lower}: better than “${quote(under)}”, but short of “${quote(upper)}”.`;

/** D28: the critical criteria and the critical rule each one fails the whole task by. */
const CRITICAL: Record<string, keyof typeof MARKETING_T2_CRITICAL_LABELS> = { E3: 'CR-05' };
const CRITICAL_CONDITION: Partial<Record<keyof typeof MARKETING_T2_CRITICAL_LABELS, string>> = {
  'CR-05': 'Critical rule CR-05, submission despite an unresolved blocker: the agent requests readiness or submits while a mandatory blocker is still unresolved. This fails the whole task, whatever the other scores.',
};

export const MARKETING_TASK2_RUBRIC_V1_DEFAULTS = {
  evaluator: { id: 'marketing-task2-evidence-v1', version: '1' },
  /** The forms these defaults belong to (v1 and v2): they also apply when the template maps another evaluator. */
  profileIds: MARKETING_T2_PROFILE_IDS,
  scale: 'zero_to_four' as const,
  criteria: golden.map((c): CriterionDefault => {
    const id = String(c.id);
    const name = str(c.name);
    const passCondition = str(c.passCondition);
    const level2 = str(c.level2);
    const failCondition = str(c.failCondition);
    const rule = CRITICAL[id];
    const d22 = { name, group: str(c.group), weight: typeof c.weight === 'number' ? c.weight : undefined, passCondition, level2, failCondition, critical: false };
    return {
      id,
      ...d22,
      level3: between('Level 4', passCondition, 'Level 2', level2),
      level1: between('Level 2', level2, 'Level 0', failCondition),
      critical: !!rule,
      ...(rule ? { criticalCondition: CRITICAL_CONDITION[rule] } : {}),
      applicability: { kind: 'REQUIRED', condition: 'Required throughout this workflow.' },
      source: `${id} ${name ?? ''}`.trim(),
      earlier: [d22],
    };
  }),
};
