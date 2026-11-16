import { GOLDEN_MARKETING_EXAMPLE, MARKETING_T2_PROFILE_ID, type CriterionDefault } from '@praxis/shared';

/**
 * D22 (QA, 16 Nov 2026; D8 'template default, SME edits'): default criteria for the Marketing Task2 rubric evaluator,
 * kept in Authoring only (never exported; template data unchanged). Source: the reviewed 0-4 rubric of the Golden
 * Task2 example (`GOLDEN_MARKETING_EXAMPLE`, S7): name, group, weight, Level 4, Level 2 and Level 0 text.
 * A criterion level never fails the whole task on this template (its critical rules CR-01 to CR-06 do), so no default
 * marks a criterion as a whole-task failure.
 */
const golden = (GOLDEN_MARKETING_EXAMPLE.sections as { S7: { criteria: Record<string, unknown>[] } }).S7.criteria;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export const MARKETING_TASK2_RUBRIC_V1_DEFAULTS = {
  evaluator: { id: 'marketing-task2-evidence-v1', version: '1' },
  /** The form these defaults belong to: they also apply when its template maps the criteria to another evaluator. */
  profileId: MARKETING_T2_PROFILE_ID,
  scale: 'zero_to_four' as const,
  criteria: golden.map(
    (c): CriterionDefault => ({
      id: String(c.id),
      name: str(c.name),
      group: str(c.group),
      weight: typeof c.weight === 'number' ? c.weight : undefined,
      passCondition: str(c.passCondition),
      level2: str(c.level2),
      failCondition: str(c.failCondition),
      critical: false,
    }),
  ),
};
