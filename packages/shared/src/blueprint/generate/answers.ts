import type { StudioAnswers } from '../api';
import { CUSTOM_FIELD_STAGES, type CustomField, type HarborBlueprint } from '../schema';

export type FieldValue = StudioAnswers['fields'][string];

/** Every custom field of the blueprint, in stage order. */
export function allCustomFields(bp: HarborBlueprint): CustomField[] {
  return CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s]);
}

/** Tag for a preview row when the SME has not tagged it: the rightmost cell that is a tag option, else blank. */
function defaultTag(cells: string[], tagOptions: string[]): string {
  for (let i = cells.length - 1; i >= 0; i--) if (tagOptions.includes(cells[i]!)) return cells[i]!;
  return '';
}

/**
 * The answers a studio starts with, built only from the blueprint's defaults. Generators use them for
 * `answers: null` (template preview) and the verification run uses them as its synthetic payload.
 */
export function defaultStudioAnswers(bp: HarborBlueprint): StudioAnswers {
  const o = bp.step_2_data_panels.oracle_annotator;
  return {
    fields: Object.fromEntries(allCustomFields(bp).map((f) => [f.field_id, f.default_value])),
    inputs: {},
    oracleRows: o.template_preview_rows.map((cells) => ({ cells: [...cells], tag: defaultTag(cells, o.sme_tag_options) })),
    sliders: Object.fromEntries(bp.step_3_mcp_simulators.widgets.map((w) => [w.key, w.default])),
    invariantRuleIds: bp.step_4_invariant_catalog.rules.map((r) => r.id),
    milestoneWeights: Object.fromEntries(bp.step_5_default_rubric.milestones.map((m) => [m.id, m.weight])),
    instructionNotes: '',
  };
}

/** Answers with every blueprint key filled: SME values win, blueprint defaults fill the gaps, unknown keys drop. */
export interface ResolvedAnswers {
  fields: Record<string, FieldValue>;
  inputs: Record<string, string>;
  oracleRows: { cells: string[]; tag: string }[];
  sliders: Record<string, number>;
  enabledRuleIds: string[];
  milestoneWeights: Record<string, number>;
  instructionNotes: string;
}

export function resolveAnswers(bp: HarborBlueprint, answers: StudioAnswers | null): ResolvedAnswers {
  const d = defaultStudioAnswers(bp);
  const a = answers ?? d;
  const pick = <T>(own: Record<string, T>, key: string, fallback: T): T => (Object.hasOwn(own, key) && own[key] !== undefined ? own[key]! : fallback);
  const rules = new Set(a.invariantRuleIds);
  return {
    fields: Object.fromEntries(allCustomFields(bp).map((f) => [f.field_id, pick(a.fields, f.field_id, f.default_value) ?? f.default_value])),
    inputs: Object.fromEntries(bp.step_2_data_panels.public_dropzones.map((z) => [z.id, z.fixed_content ?? pick(a.inputs, z.id, '')])),
    oracleRows: a.oracleRows.map((r) => ({ cells: [...r.cells], tag: r.tag })),
    sliders: Object.fromEntries(bp.step_3_mcp_simulators.widgets.map((w) => [w.key, pick(a.sliders, w.key, w.default)])),
    enabledRuleIds: bp.step_4_invariant_catalog.rules.filter((r) => rules.has(r.id)).map((r) => r.id),
    milestoneWeights: Object.fromEntries(bp.step_5_default_rubric.milestones.map((m) => [m.id, pick(a.milestoneWeights, m.id, m.weight)])),
    instructionNotes: a.instructionNotes,
  };
}

/** Values of the fields bound to one injection target, keyed by field id. */
export function fieldsFor(bp: HarborBlueprint, r: ResolvedAnswers, target: CustomField['inject_into'][number]): Record<string, FieldValue> {
  return Object.fromEntries(allCustomFields(bp).filter((f) => f.inject_into.includes(target)).map((f) => [f.field_id, r.fields[f.field_id] ?? null]));
}
