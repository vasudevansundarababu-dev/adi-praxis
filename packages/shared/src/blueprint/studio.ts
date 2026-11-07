import type { StudioAnswers } from './api';
import { STUDIO_STEP_IDS, type StudioAnswerProblems, type StudioControl, type StudioStep, type StudioStepId, type StudioSteps } from './contract';
import { resolveAnswers } from './generate/answers';
import { ruleSummary } from './generate/verifiers';
import type { CustomField, HarborBlueprint } from './schema';

/** Step titles in the SME studio sidebar (PDF §6.1, S4-03). */
export const STUDIO_STEP_TITLES: Record<StudioStepId, string> = {
  scenario: 'Scenario Setup',
  data_oracle: 'Data & Oracle Labelling',
  simulator: 'Simulator Curve Tuning',
  guardrails: 'Guardrail Thresholds',
  rubric: 'Rubric Weighting',
  confirm: 'Final Confirmation',
};

/** The studio step where each blueprint stage's custom fields are mounted (S4-05). */
export const STAGE_STEP: Record<keyof HarborBlueprint['custom_fields_by_stage'], StudioStepId> = {
  stage_1: 'scenario',
  stage_2: 'data_oracle',
  stage_3: 'simulator',
  stage_4: 'guardrails',
  stage_5: 'rubric',
};

const fieldControls = (fields: CustomField[]): StudioControl[] => fields.map((field) => ({ kind: 'custom_field', field }));

/** C2: the 6 SME steps and their controls, rendered by the studio from the blueprint alone (S4-03 to S4-07). */
export const studioSteps: StudioSteps = (bp) => {
  const cf = bp.custom_fields_by_stage;
  const o = bp.step_2_data_panels.oracle_annotator;
  const controls: Record<StudioStepId, StudioControl[]> = {
    scenario: [
      { kind: 'text', key: 'title', label: 'Task title / scenario name', multiline: false, required: true },
      ...fieldControls(cf.stage_1),
      { kind: 'text', key: 'instructionNotes', label: 'Business instructions / brand guidelines', multiline: true, required: false },
    ],
    data_oracle: [
      ...bp.step_2_data_panels.public_dropzones.map(
        (z): StudioControl => ({ kind: 'dropzone', dropzoneId: z.id, label: z.label, format: z.format, targetPath: z.target_path }),
      ),
      { kind: 'oracle_grid', columns: [...o.columns], tagOptions: [...o.sme_tag_options], previewRows: o.template_preview_rows.map((r) => [...r]) },
      ...fieldControls(cf.stage_2),
    ],
    simulator: [
      ...bp.step_3_mcp_simulators.widgets.map(
        (w): StudioControl => ({ kind: 'curve_slider', key: w.key, label: w.label, archetype: w.archetype, min: w.min, max: w.max, default: w.default, step: w.step, formula: w.formula }),
      ),
      ...fieldControls(cf.stage_3),
    ],
    guardrails: [
      ...bp.step_4_invariant_catalog.rules.map((r): StudioControl => ({ kind: 'invariant_toggle', ruleId: r.id, description: r.description.trim() || ruleSummary(r) })),
      ...fieldControls(cf.stage_4),
    ],
    rubric: [
      ...bp.step_5_default_rubric.milestones.map((m): StudioControl => ({ kind: 'weight_slider', milestoneId: m.id, label: m.label, default: m.weight })),
      ...fieldControls(cf.stage_5),
    ],
    confirm: [{ kind: 'summary' }],
  };
  return STUDIO_STEP_IDS.map((id): StudioStep => ({ id, title: STUDIO_STEP_TITLES[id], controls: controls[id] }));
};

function fieldValueProblems(f: CustomField, v: StudioAnswers['fields'][string] | undefined): string[] {
  const what = `"${f.label}"`;
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return [`${what} is required`];
  switch (f.input_type) {
    case 'number_input':
    case 'currency_slider': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return [`${what} must be a number`];
      const p: string[] = [];
      if (f.min !== undefined && v < f.min) p.push(`${what} must be at least ${f.min}`);
      if (f.max !== undefined && v > f.max) p.push(`${what} must be at most ${f.max}`);
      return p;
    }
    case 'boolean_toggle':
      return typeof v === 'boolean' ? [] : [`${what} must be yes or no`];
    case 'text_input':
      return typeof v === 'string' ? [] : [`${what} must be text`];
    case 'single_select':
      return typeof v === 'string' && f.options.includes(v) ? [] : [`${what} must be one of: ${f.options.join(', ')}`];
    case 'multi_select':
      if (!Array.isArray(v) || v.some((x) => !f.options.includes(x))) return [`${what} must only use: ${f.options.join(', ')}`];
      return new Set(v).size === v.length ? [] : [`${what} lists an option twice`];
  }
}

/** C2: blocking problems per studio step for the SME's answers (S4-03); `confirm` repeats them all. */
export const studioAnswerProblems: StudioAnswerProblems = (bp, answers) => {
  const out = Object.fromEntries(STUDIO_STEP_IDS.map((id) => [id, [] as string[]])) as Record<StudioStepId, string[]>;
  const r = resolveAnswers(bp, answers);

  for (const [stage, step] of Object.entries(STAGE_STEP) as [keyof typeof STAGE_STEP, StudioStepId][]) {
    for (const f of bp.custom_fields_by_stage[stage]) out[step].push(...fieldValueProblems(f, r.fields[f.field_id]));
  }
  const known = (ids: string[]) => new Set(ids);
  const fieldIds = known(Object.keys(r.fields));
  for (const id of Object.keys(answers.fields)) if (!fieldIds.has(id)) out.scenario.push(`Unknown field "${id}"`);

  const d = out.data_oracle;
  const zones = known(bp.step_2_data_panels.public_dropzones.map((z) => z.id));
  for (const id of Object.keys(answers.inputs)) if (!zones.has(id)) d.push(`Unknown dropzone "${id}"`);
  const o = bp.step_2_data_panels.oracle_annotator;
  if (answers.oracleRows.length === 0) d.push('Tag at least one oracle row');
  answers.oracleRows.forEach((row, i) => {
    if (row.cells.length !== o.columns.length) d.push(`Oracle row ${i + 1} must have ${o.columns.length} cells`);
    if (!row.tag) d.push(`Oracle row ${i + 1} needs a tag`);
    else if (!o.sme_tag_options.includes(row.tag)) d.push(`Oracle row ${i + 1}: tag "${row.tag}" is not one of ${o.sme_tag_options.join(', ')}`);
  });

  const widgets = new Map(bp.step_3_mcp_simulators.widgets.map((w) => [w.key, w]));
  for (const [key, value] of Object.entries(answers.sliders)) {
    const w = widgets.get(key);
    if (!w) out.simulator.push(`Unknown slider "${key}"`);
    else if (!Number.isFinite(value) || value < w.min || value > w.max) out.simulator.push(`"${w.label}" must be between ${w.min} and ${w.max}`);
  }

  const rules = known(bp.step_4_invariant_catalog.rules.map((x) => x.id));
  for (const id of answers.invariantRuleIds) if (!rules.has(id)) out.guardrails.push(`Unknown guardrail "${id}"`);

  const milestones = known(bp.step_5_default_rubric.milestones.map((m) => m.id));
  for (const id of Object.keys(answers.milestoneWeights)) if (!milestones.has(id)) out.rubric.push(`Unknown milestone "${id}"`);
  const total = Object.values(r.milestoneWeights).reduce((a, b) => a + b, 0);
  if (milestones.size > 0 && total !== 100) out.rubric.push(`Milestone weights must add up to 100 (now ${total})`);

  for (const id of STUDIO_STEP_IDS) if (id !== 'confirm') out.confirm.push(...out[id].map((p) => `${STUDIO_STEP_TITLES[id]}: ${p}`));
  return out;
};
