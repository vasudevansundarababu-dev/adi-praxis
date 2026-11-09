import {
  AGENT_OUTPUT_ROOT,
  BLUEPRINT_SECTIONS,
  CUSTOM_FIELD_STAGES,
  HIDDEN_GROUND_TRUTH_ROOT,
  PUBLIC_INPUT_ROOT,
  type BlueprintSection,
  type CustomField,
  type HarborBlueprint,
  type RubricMilestone,
} from './schema';

export type SectionProblems = Record<BlueprintSection, string[]>;

const SAFE_PATH_CHARS = /^[A-Za-z0-9._\-/]+$/;

/** True when `path` is a plain relative file path under `root` (no `..`, no empty segments, no other root). */
export function isPathUnder(root: string, path: string): boolean {
  if (!path.startsWith(root) || !SAFE_PATH_CHARS.test(path)) return false;
  const rest = path.slice(root.length);
  if (!rest) return false;
  return rest.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

function checkRange(problems: string[], what: string, min: number | undefined, def: unknown, max: number | undefined) {
  if (min !== undefined && max !== undefined && min > max) problems.push(`${what}: minimum must not be above maximum`);
  if (typeof def === 'number') {
    if (min !== undefined && def < min) problems.push(`${what}: default must not be below the minimum`);
    if (max !== undefined && def > max) problems.push(`${what}: default must not be above the maximum`);
  }
}

function customFieldProblems(f: CustomField): string[] {
  const p: string[] = [];
  const what = `Custom field "${f.field_id}"`;
  if (f.inject_into.length === 0) p.push(`${what}: choose at least one target (inject_into)`);
  if (duplicates(f.inject_into).length) p.push(`${what}: a target is listed twice`);
  const select = f.input_type === 'single_select' || f.input_type === 'multi_select';
  if (select && f.options.length === 0) p.push(`${what}: add at least one option`);
  if (duplicates(f.options).length) p.push(`${what}: options must be unique`);
  const d = f.default_value;
  if (d !== null) {
    switch (f.input_type) {
      case 'number_input':
      case 'currency_slider':
        if (typeof d !== 'number') p.push(`${what}: default must be a number`);
        break;
      case 'boolean_toggle':
        if (typeof d !== 'boolean') p.push(`${what}: default must be true or false`);
        break;
      case 'text_input':
        if (typeof d !== 'string') p.push(`${what}: default must be text`);
        break;
      case 'single_select':
        if (typeof d !== 'string' || !f.options.includes(d)) p.push(`${what}: default must be one of the options`);
        break;
      case 'multi_select':
        if (!Array.isArray(d) || d.some((v) => !f.options.includes(v))) p.push(`${what}: default must be a list of options`);
        break;
    }
  }
  if (f.input_type === 'number_input' || f.input_type === 'currency_slider') checkRange(p, what, f.min, d, f.max);
  if (f.input_type === 'currency_slider' && (f.min === undefined || f.max === undefined)) p.push(`${what}: a slider needs a minimum and a maximum`);
  if (f.inject_into.includes('eval/test_verifiers.py') && !f.verifier_assertion.trim()) {
    p.push(`${what}: a field bound to eval/test_verifiers.py needs a verifier assertion`);
  }
  return p;
}

/**
 * Problems per navigator section (panel 0 + 5 stages). Same code runs in the browser and on the server (D-03).
 * An empty list means the section is valid; "n/6 Valid" counts the empty lists (S2-07).
 */
export function sectionProblems(bp: HarborBlueprint): SectionProblems {
  const out = Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s, [] as string[]])) as SectionProblems;

  const c = bp.catalog;
  if (!c.primary_work.trim()) out.catalog.push('Primary work is required');
  if (!c.verification_criteria.trim()) out.catalog.push('Verification criteria are required');
  if (!c.human_gate.trim()) out.catalog.push('Human gate is required');
  if (c.skills.length === 0) out.catalog.push('At least one skill is required');
  if (c.task_modes.length === 0) out.catalog.push('At least one task mode is required');

  const s1 = out.stage_1;
  if (!/^[a-z0-9][a-z0-9_-]{2,99}$/.test(bp.studio_id)) s1.push('Studio Blueprint ID is required (lowercase letters, digits, - or _; at least 3 characters)');
  if (!bp.domain_meta.title.trim()) s1.push('Display title is required');
  if (!bp.domain_meta.persona_label.trim()) s1.push('SME role persona is required');
  if (!bp.domain_meta.horizon.cadence_unit.trim()) s1.push('Cadence unit is required');
  if (bp.template_meta.tpt_minutes === null) s1.push('TPT (minutes) is required');
  if (bp.template_meta.modes.length === 0) s1.push('Choose at least one execution mode');
  if (bp.domain_meta.horizon.type === 'single_pass' && bp.domain_meta.horizon.max_turns !== 1) s1.push('A single-pass topology has exactly 1 turn');

  const s2 = out.stage_2;
  const dz = bp.step_2_data_panels.public_dropzones;
  if (dz.length === 0) s2.push('Add at least one public dropzone');
  for (const d of duplicates(dz.map((z) => z.id))) s2.push(`Dropzone id "${d}" is used more than once`);
  for (const d of duplicates(dz.map((z) => z.target_path))) s2.push(`Two dropzones write to ${d}`);
  for (const z of dz) {
    if (!isPathUnder(PUBLIC_INPUT_ROOT, z.target_path)) s2.push(`Dropzone "${z.id}": path must be a file under ${PUBLIC_INPUT_ROOT}`);
    if (!z.label.trim()) s2.push(`Dropzone "${z.id}": label is required`);
  }
  const o = bp.step_2_data_panels.oracle_annotator;
  if (!o.dataset_name.trim()) s2.push('Oracle dataset name is required');
  if (!isPathUnder(HIDDEN_GROUND_TRUTH_ROOT, o.target_path)) s2.push(`Oracle table path must be a file under ${HIDDEN_GROUND_TRUTH_ROOT}`);
  if (o.columns.length === 0) s2.push('Oracle table needs at least one column');
  for (const d of duplicates(o.columns)) s2.push(`Oracle column "${d}" is used more than once`);
  if (o.sme_tag_options.length === 0) s2.push('Oracle table needs at least one SME tag option');
  o.template_preview_rows.forEach((r, i) => {
    if (r.length !== o.columns.length) s2.push(`Oracle preview row ${i + 1} must have ${o.columns.length} cells`);
  });

  const s3 = out.stage_3;
  const sim = bp.step_3_mcp_simulators;
  if (sim.tools.length === 0) s3.push('Add at least one MCP tool');
  for (const d of duplicates(sim.tools.map((t) => t.tool_id))) s3.push(`MCP tool "${d}" is defined more than once`);
  for (const t of sim.tools) for (const d of duplicates(t.parameters.map((p) => p.name))) s3.push(`MCP tool "${t.tool_id}": parameter "${d}" is defined more than once`);
  for (const d of duplicates(sim.widgets.map((w) => w.key))) s3.push(`Slider key "${d}" is used more than once`);
  for (const w of sim.widgets) {
    if (w.min >= w.max) s3.push(`Slider "${w.key}": minimum must be below maximum`);
    checkRange(s3, `Slider "${w.key}"`, w.min, w.default, w.max);
  }

  const s4 = out.stage_4;
  const inv = bp.step_4_invariant_catalog;
  if (inv.allowed_subjects.length === 0) s4.push('Add at least one allowed subject');
  if (inv.rules.length === 0) s4.push('Add at least one guardrail rule');
  for (const d of duplicates(inv.rules.map((r) => r.id))) s4.push(`Rule id "${d}" is used more than once`);
  for (const r of inv.rules) {
    if (!inv.allowed_subjects.includes(r.subject)) s4.push(`Rule "${r.id}": subject "${r.subject}" is not in the allowed list`);
    if (r.operator === 'GREATER_THAN' && typeof r.threshold !== 'number') s4.push(`Rule "${r.id}": GREATER_THAN needs a number`);
    if (r.operator === 'CONTAINS_ANY' && (!Array.isArray(r.threshold) || r.threshold.length === 0)) s4.push(`Rule "${r.id}": CONTAINS_ANY needs at least one value`);
    if (r.operator === 'EQUALS' && Array.isArray(r.threshold)) s4.push(`Rule "${r.id}": EQUALS needs a single value`);
  }

  const s5 = out.stage_5;
  const ms = bp.step_5_default_rubric.milestones;
  if (ms.length === 0) s5.push('Add at least one rubric milestone');
  for (const d of duplicates(ms.map((m) => m.id))) s5.push(`Milestone id "${d}" is used more than once`);
  const total = ms.reduce((sum, m) => sum + m.weight, 0);
  if (ms.length > 0 && total !== 100) s5.push(`Milestone weights must add up to 100 (now ${total})`);
  for (const m of ms) s5.push(...judgeProblems(m));

  const allFields = CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s]);
  const dupIds = new Set(duplicates(allFields.map((f) => f.field_id)));
  for (const stage of CUSTOM_FIELD_STAGES) {
    for (const f of bp.custom_fields_by_stage[stage]) {
      if (dupIds.has(f.field_id)) out[stage].push(`Custom field id "${f.field_id}" is used more than once in this template`);
      out[stage].push(...customFieldProblems(f));
    }
  }
  return out;
}

export function validSectionCount(problems: SectionProblems): number {
  return BLUEPRINT_SECTIONS.filter((s) => problems[s].length === 0).length;
}

export function isBlueprintComplete(bp: HarborBlueprint): boolean {
  return validSectionCount(sectionProblems(bp)) === BLUEPRINT_SECTIONS.length;
}

/** Rebalance weights to sum to exactly 100, keeping proportions (Mock S2 "auto-normalise"). */
export function normaliseWeights(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const raw = total === 0 ? weights.map(() => 100 / weights.length) : weights.map((w) => (Math.max(0, w) * 100) / total);
  const floored = raw.map(Math.floor);
  let rest = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest-- <= 0) break;
    floored[i]! += 1;
  }
  return floored;
}

function judgeProblems(m: RubricMilestone): string[] {
  const out: string[] = [];
  if (m.verifier_template !== 'llm_judge_checklist') {
    if (m.judge) out.push(`Milestone "${m.id}": a judge checklist needs the llm_judge_checklist verifier`);
    return out;
  }
  if (!m.verifier_body.trim()) out.push(`Milestone "${m.id}": add the deterministic gate check (verifier body) used for the 0.00 / 1.00 test`);
  if (!m.judge) return [...out, `Milestone "${m.id}": add the judge checklist`];
  if (!isPathUnder(AGENT_OUTPUT_ROOT, m.judge.deliverable_path)) out.push(`Milestone "${m.id}": deliverable must be a file under ${AGENT_OUTPUT_ROOT}`);
  if (!m.judge.system_prompt.trim()) out.push(`Milestone "${m.id}": judge instructions are required`);
  if (m.judge.criteria.length === 0) out.push(`Milestone "${m.id}": add at least one judge criterion`);
  for (const d of duplicates(m.judge.criteria.map((c) => String(c.num)))) out.push(`Milestone "${m.id}": criterion ${d} is listed more than once`);
  return out;
}
