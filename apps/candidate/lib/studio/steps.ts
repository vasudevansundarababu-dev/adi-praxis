import {
  CUSTOM_FIELD_STAGES,
  STUDIO_STEP_IDS,
  type CustomField,
  type HarborBlueprint,
  type StudioAnswerProblems,
  type StudioAnswers,
  type StudioControl,
  type StudioStep,
  type StudioStepId,
  type StudioSteps,
} from '@praxis/shared';

/**
 * Stand-ins for the C2 studio contract (contract.ts: `StudioSteps`, `StudioAnswerProblems`) until Stream 1 exports
 * `studioSteps` / `studioAnswerProblems` from @praxis/shared. Same behaviour; swap these exports to the shared ones
 * when they land and nothing else in the studio changes.
 */

export const STUDIO_STEP_TITLES: Record<StudioStepId, string> = {
  scenario: 'Scenario Setup',
  data_oracle: 'Data & Oracle Labelling',
  simulator: 'Simulator Curve Tuning',
  guardrails: 'Guardrail Thresholds',
  rubric: 'Rubric Weighting',
  confirm: 'Final Confirmation',
};

const STAGE_STEP: Record<(typeof CUSTOM_FIELD_STAGES)[number], StudioStepId> = {
  stage_1: 'scenario',
  stage_2: 'data_oracle',
  stage_3: 'simulator',
  stage_4: 'guardrails',
  stage_5: 'rubric',
};

/** `answers.fields` key for the task title (the commit route reads the title from there). */
export const TITLE_KEY = 'title';

export const allCustomFields = (bp: HarborBlueprint): CustomField[] => CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s]);
const fieldControls = (fields: CustomField[]): StudioControl[] => fields.map((field) => ({ kind: 'custom_field', field }));

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
      ...bp.step_2_data_panels.public_dropzones.map((z): StudioControl => ({ kind: 'dropzone', dropzoneId: z.id, label: z.label, format: z.format, targetPath: z.target_path })),
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
      ...bp.step_4_invariant_catalog.rules.map(
        (r): StudioControl => ({ kind: 'invariant_toggle', ruleId: r.id, description: r.description.trim() || `IF ${r.subject} ${r.operator} ${JSON.stringify(r.threshold)} THEN ${r.penalty}` }),
      ),
      ...fieldControls(cf.stage_4),
    ],
    rubric: [...bp.step_5_default_rubric.milestones.map((m): StudioControl => ({ kind: 'weight_slider', milestoneId: m.id, label: m.label, default: m.weight })), ...fieldControls(cf.stage_5)],
    confirm: [{ kind: 'summary' }],
  };
  return STUDIO_STEP_IDS.map((id): StudioStep => ({ id, title: STUDIO_STEP_TITLES[id], controls: controls[id] }));
};

/** Answers a new task starts with: blueprint defaults, no oracle rows tagged yet, every guardrail on. */
export function defaultStudioAnswers(bp: HarborBlueprint): StudioAnswers {
  return {
    fields: { [TITLE_KEY]: '', ...Object.fromEntries(allCustomFields(bp).map((f) => [f.field_id, f.default_value])) },
    inputs: Object.fromEntries(bp.step_2_data_panels.public_dropzones.map((z) => [z.id, ''])),
    oracleRows: [],
    sliders: Object.fromEntries(bp.step_3_mcp_simulators.widgets.map((w) => [w.key, w.default])),
    invariantRuleIds: bp.step_4_invariant_catalog.rules.map((r) => r.id),
    milestoneWeights: Object.fromEntries(bp.step_5_default_rubric.milestones.map((m) => [m.id, m.weight])),
    instructionNotes: '',
  };
}

/** Saved answers over the defaults, so every control of the deployed version shows a value (S4-05). */
export function withDefaults(bp: HarborBlueprint, saved: StudioAnswers | null): StudioAnswers {
  const d = defaultStudioAnswers(bp);
  if (!saved) return d;
  return {
    fields: { ...d.fields, ...saved.fields },
    inputs: { ...d.inputs, ...saved.inputs },
    oracleRows: saved.oracleRows,
    sliders: { ...d.sliders, ...saved.sliders },
    invariantRuleIds: saved.invariantRuleIds,
    milestoneWeights: { ...d.milestoneWeights, ...saved.milestoneWeights },
    instructionNotes: saved.instructionNotes,
  };
}

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

export const studioAnswerProblems: StudioAnswerProblems = (bp, a) => {
  const out = Object.fromEntries(STUDIO_STEP_IDS.map((id) => [id, [] as string[]])) as Record<StudioStepId, string[]>;
  const title = a.fields[TITLE_KEY];
  if (typeof title !== 'string' || !title.trim()) out.scenario.push('Task title is required');
  for (const stage of CUSTOM_FIELD_STAGES) for (const f of bp.custom_fields_by_stage[stage]) out[STAGE_STEP[stage]].push(...fieldValueProblems(f, a.fields[f.field_id]));

  const o = bp.step_2_data_panels.oracle_annotator;
  const d = out.data_oracle;
  if (o.columns.length > 0 && a.oracleRows.length === 0) d.push('Tag at least one oracle row');
  a.oracleRows.forEach((row, i) => {
    if (row.cells.length !== o.columns.length) d.push(`Oracle row ${i + 1} must have ${o.columns.length} cells`);
    if (!row.tag) d.push(`Oracle row ${i + 1} needs a tag`);
    else if (!o.sme_tag_options.includes(row.tag)) d.push(`Oracle row ${i + 1}: tag "${row.tag}" is not one of ${o.sme_tag_options.join(', ')}`);
  });

  for (const w of bp.step_3_mcp_simulators.widgets) {
    const v = a.sliders[w.key] ?? w.default;
    if (!Number.isFinite(v) || v < w.min || v > w.max) out.simulator.push(`"${w.label}" must be between ${w.min} and ${w.max}`);
  }

  const ms = bp.step_5_default_rubric.milestones;
  const total = ms.reduce((sum, m) => sum + (a.milestoneWeights[m.id] ?? m.weight), 0);
  if (ms.length > 0 && total !== 100) out.rubric.push(`Milestone weights must add up to 100 (now ${total})`);

  for (const id of STUDIO_STEP_IDS) if (id !== 'confirm') out.confirm.push(...out[id].map((p) => `${STUDIO_STEP_TITLES[id]}: ${p}`));
  return out;
};

/** CTR(s) = CTR_base × s / (s + K_half) (PDF §6.1, S4-07). */
export function ctr(spend: number, ctrBase: number, kHalf: number): number {
  return spend <= 0 || spend + kHalf <= 0 ? 0 : (ctrBase * spend) / (spend + kHalf);
}

/** Curve parameters from the diminishing-returns sliders: the `ctr`/`base` key and the `half`/`sat` key. */
export function curveParams(bp: HarborBlueprint, sliders: Record<string, number>): { ctrBase: number; kHalf: number; maxSpend: number } | null {
  const ws = bp.step_3_mcp_simulators.widgets.filter((w) => w.archetype === 'diminishing_returns_curve_slider');
  if (ws.length === 0) return null;
  const base = ws.find((w) => /ctr|base/i.test(w.key));
  const half = ws.find((w) => w !== base && /half|sat|k_/i.test(w.key)) ?? ws.find((w) => w !== base);
  const kHalf = half ? (sliders[half.key] ?? half.default) : 1;
  return { ctrBase: base ? (sliders[base.key] ?? base.default) : 1, kHalf, maxSpend: Math.max(1, (half?.max ?? kHalf) * 2) };
}

/** JSON with sorted keys and a trailing newline: the same answers always give the same text. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/**
 * Agent-facing task.json preview for the SME's answers. Stand-in for the C1 generator
 * (`generateArtifacts(bp, answers)['task.json']`); after Save & Commit the studio shows the stored JSON instead.
 */
export function taskJsonPreview(bp: HarborBlueprint, a: StudioAnswers): string {
  const custom = Object.fromEntries(allCustomFields(bp).filter((f) => f.inject_into.includes('task.json')).map((f) => [f.field_id, a.fields[f.field_id] ?? null]));
  const title = a.fields[TITLE_KEY];
  return stableJson({
    schema: 'praxis.harbor.task.v1',
    studio_id: bp.studio_id,
    title: typeof title === 'string' && title.trim() ? title.trim() : bp.domain_meta.title,
    persona: bp.domain_meta.persona_label,
    execution_mode: bp.template_meta.modes[0] ?? null,
    horizon: bp.domain_meta.horizon,
    harbor: { network: 'internal', require_solve_sh: bp.harbor_contract.require_solve_sh, zero_baseline_gate: bp.harbor_contract.zero_baseline_gate },
    inputs: bp.step_2_data_panels.public_dropzones.map((z) => ({ id: z.id, path: z.target_path, format: z.format })),
    custom_fields: custom,
    simulator: a.sliders,
    guardrails: a.invariantRuleIds,
    rubric: a.milestoneWeights,
  });
}

export type OracleRow = StudioAnswers['oracleRows'][number];
const rowKey = (cells: string[]) => JSON.stringify(cells);

/** Grid rows: the template preview rows in order, then any saved rows that are not preview rows; tags from the answers. */
export function oracleGridRows(previewRows: string[][], tagged: OracleRow[]): OracleRow[] {
  const tags = new Map(tagged.map((r) => [rowKey(r.cells), r.tag]));
  const preview = new Set(previewRows.map(rowKey));
  return [...previewRows.map((cells) => ({ cells, tag: tags.get(rowKey(cells)) ?? '' })), ...tagged.filter((r) => !preview.has(rowKey(r.cells)))];
}

/** Sets one grid row's tag; untagged rows are left out of the ground truth. Tags outside `tagOptions` are refused. */
export function setOracleTag(grid: OracleRow[], index: number, tag: string, tagOptions: string[]): OracleRow[] {
  if (tag && !tagOptions.includes(tag)) return grid.filter((r) => r.tag);
  return grid.map((r, i) => (i === index ? { cells: [...r.cells], tag } : r)).filter((r) => r.tag);
}
