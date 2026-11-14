import { z } from 'zod';

/**
 * What the template page shows for a template version whose execution Anvil defines (`Template.anvilSpec` set).
 * Execution, tools, rubric and environment come from Anvil's execution part, not from the Harbor blueprint, so the
 * Meta-Compiler's "n/6 Valid" counter does not apply (DECISIONS.md, 13 Nov 2026). Read-only: Praxis never edits
 * Anvil-owned parts; this only summarises them.
 */
export const AnvilDefinitionDto = z.object({
  anvilTemplateKey: z.string().nullable(),
  /** `execution.schema_version`, e.g. `anvil.template-execution.v3`; null for an older spec without one. */
  executionSchemaVersion: z.string().nullable(),
  rubricSummary: z.string(),
  /** Role ids of the version's starting workflow graph (one for single-agent, several for multi-agent). */
  roleIds: z.array(z.string()),
});
export type AnvilDefinitionDto = z.infer<typeof AnvilDefinitionDto>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One line describing the rubric Anvil's execution part declares. */
export function anvilRubricSummary(execution: unknown): string {
  if (!isObj(execution)) return 'No rubric in the execution part';
  const r = execution.rubric;
  const evaluators = Array.isArray(execution.evaluators) ? execution.evaluators.length : 0;
  const criteria = `${evaluators} ${evaluators === 1 ? 'criterion' : 'criteria'} mapped to evaluators`;
  if (isObj(r) && r.scale === 'zero_to_four') {
    const groups = isObj(r.groups) ? Object.keys(r.groups).length : 0;
    const min = isObj(r.minimum) && typeof r.minimum.total === 'number' ? `, minimum ${r.minimum.total}` : '';
    return `0–4 scale, ${groups} groups${min}; ${criteria}`;
  }
  const kinds = Array.isArray(execution.evaluatorKinds) ? execution.evaluatorKinds.filter((k): k is string => typeof k === 'string') : [];
  if (!evaluators && kinds.length) return `Evaluator kinds: ${kinds.join(', ')}; 5/2/0 per criterion`;
  return `5/2/0 per criterion; ${criteria}`;
}

/** Summary of an `anvilSpec`; null when the version has none (a Harbor/Meta-Compiler template). */
export function anvilDefinition(anvilSpec: unknown, roleIds: readonly string[]): AnvilDefinitionDto | null {
  if (!isObj(anvilSpec)) return null;
  const execution = anvilSpec.execution;
  const version = isObj(execution) && typeof execution.schema_version === 'string' ? execution.schema_version : null;
  return {
    anvilTemplateKey: typeof anvilSpec.anvil_template_key === 'string' ? anvilSpec.anvil_template_key : null,
    executionSchemaVersion: version,
    rubricSummary: anvilRubricSummary(execution),
    roleIds: [...roleIds],
  };
}
