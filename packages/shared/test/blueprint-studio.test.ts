import { describe, expect, it } from 'vitest';
import { STUDIO_STEP_IDS, defaultStudioAnswers, studioAnswerProblems, studioSteps, type StudioAnswers, type StudioControl, type StudioStepId } from '../src';
import { generatorFixture } from './blueprint-fixture';

const bp = generatorFixture();
const steps = studioSteps(bp);
const step = (id: StudioStepId) => steps.find((s) => s.id === id)!;
const controlsOf = <K extends StudioControl['kind']>(kind: K) => steps.flatMap((s) => s.controls).filter((c): c is Extract<StudioControl, { kind: K }> => c.kind === kind);

function answers(patch: Partial<StudioAnswers> = {}): StudioAnswers {
  return { ...defaultStudioAnswers(bp), ...patch };
}
const noProblems = Object.fromEntries(STUDIO_STEP_IDS.map((id) => [id, []]));

describe('C2 studioSteps (S4-03 to S4-07)', () => {
  it('returns the 6 steps in STUDIO_STEP_IDS order with sidebar titles', () => {
    expect(steps.map((s) => s.id)).toEqual([...STUDIO_STEP_IDS]);
    expect(steps.map((s) => s.title)).toEqual(['Scenario Setup', 'Data & Oracle Labelling', 'Simulator Curve Tuning', 'Guardrail Thresholds', 'Rubric Weighting', 'Final Confirmation']);
  });

  it('text: scenario title (required, single line) and business instructions (optional, multiline) (S4-04)', () => {
    expect(controlsOf('text')).toEqual([
      { kind: 'text', key: 'title', label: 'Task title / scenario name', multiline: false, required: true },
      { kind: 'text', key: 'instructionNotes', label: 'Business instructions / brand guidelines', multiline: true, required: false },
    ]);
    expect(step('scenario').controls[0]).toMatchObject({ kind: 'text', key: 'title' });
    expect(step('scenario').controls.at(-1)).toMatchObject({ kind: 'text', key: 'instructionNotes' });
  });

  it('custom_field: every custom field appears exactly once, in the step for its stage, with its default (S4-05)', () => {
    const ids = controlsOf('custom_field').map((c) => c.field.field_id);
    expect(ids).toEqual(['locale', 'brand_name', 'channels', 'target_cac_ceiling', 'strict_mode', 'min_weeks']);
    const where = (id: string) => steps.find((s) => s.controls.some((c) => c.kind === 'custom_field' && c.field.field_id === id))!.id;
    expect(['locale', 'brand_name', 'channels', 'target_cac_ceiling', 'strict_mode', 'min_weeks'].map(where)).toEqual(['scenario', 'scenario', 'data_oracle', 'simulator', 'guardrails', 'rubric']);
    expect(controlsOf('custom_field').find((c) => c.field.field_id === 'target_cac_ceiling')!.field).toMatchObject({ input_type: 'currency_slider', default_value: 42, min: 10, max: 100 });
  });

  it('dropzone: one per public dropzone with format and target path', () => {
    expect(controlsOf('dropzone')).toEqual([
      { kind: 'dropzone', dropzoneId: 'queries', label: 'Search queries', format: 'csv', targetPath: '/workspace/inputs/queries.csv' },
      { kind: 'dropzone', dropzoneId: 'brief', label: 'Launch brief', format: 'md', targetPath: '/workspace/inputs/brief.md' },
    ]);
  });

  it('oracle_grid: columns, tag options and preview rows from Stage 2 (S4-06)', () => {
    expect(controlsOf('oracle_grid')).toEqual([
      {
        kind: 'oracle_grid',
        columns: ['keyword', 'intent'],
        tagOptions: ['BUY', 'RESEARCH', 'IGNORE'],
        previewRows: [
          ['quiet phone deal', 'BUY'],
          ['best anc phone review', 'RESEARCH'],
          ['phone case free', 'IGNORE'],
        ],
      },
    ]);
    expect(step('data_oracle').controls.some((c) => c.kind === 'oracle_grid')).toBe(true);
  });

  it('curve_slider: both archetypes with min, max, default, step and formula (S4-07)', () => {
    expect(controlsOf('curve_slider')).toEqual([
      { kind: 'curve_slider', key: 'k_half', label: 'Saturation (K_half)', archetype: 'diminishing_returns_curve_slider', min: 1000, max: 50000, default: 12000, step: 500, formula: 'CTR(s) = CTR_base * (s / (s + K_half))' },
      { kind: 'curve_slider', key: 'match_threshold', label: 'Keyword match threshold', archetype: 'fuzzy_match_threshold_slider', min: 0.5, max: 1, default: 0.85, step: 0.05, formula: '' },
    ]);
  });

  it('invariant_toggle: one per rule, with the description or the generated IF/THEN text', () => {
    expect(controlsOf('invariant_toggle')).toEqual([
      { kind: 'invariant_toggle', ruleId: 'spend_cap', description: 'Never commit more than $5,000 in a week.' },
      { kind: 'invariant_toggle', ruleId: 'no_tv', description: 'IF channel EQUALS tv THEN HARD_FAIL (-1.0)' },
      { kind: 'invariant_toggle', ruleId: 'brand_safety', description: 'IF keyword CONTAINS_ANY [counterfeit, replica] THEN HARD_FAIL (-1.0)' },
    ]);
  });

  it('weight_slider: one per milestone with the default weight', () => {
    expect(controlsOf('weight_slider')).toEqual([
      { kind: 'weight_slider', milestoneId: 'intent_f1', label: 'Keyword intent', default: 60 },
      { kind: 'weight_slider', milestoneId: 'budget', label: 'Budget allocation', default: 40 },
    ]);
  });

  it('summary: the confirmation step', () => {
    expect(step('confirm').controls).toEqual([{ kind: 'summary' }]);
  });

  it('is pure: the blueprint is not shared with or changed by the steps', () => {
    const grid = controlsOf('oracle_grid')[0]!;
    grid.previewRows[0]![0] = 'changed';
    expect(bp.step_2_data_panels.oracle_annotator.template_preview_rows[0]![0]).toBe('quiet phone deal');
    expect(studioSteps(bp)).toEqual(studioSteps(generatorFixture()));
  });
});

describe('C2 studioAnswerProblems (S4-03)', () => {
  it('the default answers can be committed', () => {
    expect(studioAnswerProblems(bp, answers())).toEqual(noProblems);
  });

  it('oracle tags are limited to sme_tag_options, every row is tagged and has one cell per column (S4-06)', () => {
    const p = studioAnswerProblems(bp, answers({ oracleRows: [{ cells: ['a', 'BUY'], tag: 'MAYBE' }, { cells: ['b', 'BUY'], tag: '' }, { cells: ['c'], tag: 'BUY' }] }));
    expect(p.data_oracle).toEqual([
      'Oracle row 1: tag "MAYBE" is not one of BUY, RESEARCH, IGNORE',
      'Oracle row 2 needs a tag',
      'Oracle row 3 must have 2 cells',
    ]);
    expect(studioAnswerProblems(bp, answers({ oracleRows: [] })).data_oracle).toEqual(['Tag at least one oracle row']);
    expect(studioAnswerProblems(bp, answers({ inputs: { nope: 'x' } })).data_oracle).toEqual(['Unknown dropzone "nope"']);
  });

  it('slider values stay within min and max (S4-07)', () => {
    expect(studioAnswerProblems(bp, answers({ sliders: { k_half: 999, match_threshold: 1.01 } })).simulator).toEqual([
      '"Saturation (K_half)" must be between 1000 and 50000',
      '"Keyword match threshold" must be between 0.5 and 1',
    ]);
    expect(studioAnswerProblems(bp, answers({ sliders: { k_half: 50000 } })).simulator).toEqual([]);
    expect(studioAnswerProblems(bp, answers({ sliders: { other: 1 } })).simulator).toEqual(['Unknown slider "other"']);
  });

  it('milestone weights must sum to 100; missing weights use the defaults', () => {
    expect(studioAnswerProblems(bp, answers({ milestoneWeights: { intent_f1: 70, budget: 20 } })).rubric).toEqual(['Milestone weights must add up to 100 (now 90)']);
    expect(studioAnswerProblems(bp, answers({ milestoneWeights: { intent_f1: 50, budget: 50 } })).rubric).toEqual([]);
    expect(studioAnswerProblems(bp, answers({ milestoneWeights: { intent_f1: 70 } })).rubric).toEqual(['Milestone weights must add up to 100 (now 110)']);
    expect(studioAnswerProblems(bp, answers({ milestoneWeights: { intent_f1: 60, budget: 40, x: 0 } })).rubric).toEqual(['Unknown milestone "x"']);
  });

  it('required custom fields are present and typed; problems land on the step for the field stage (S4-04, S4-05)', () => {
    const p = studioAnswerProblems(bp, answers({ fields: { locale: 'fr-FR', brand_name: '  ', channels: ['search', 'tv'], target_cac_ceiling: 101, strict_mode: 'yes', min_weeks: null } }));
    expect(p.scenario).toEqual(['"Launch locale" must be one of: en-GB, de-DE', '"Brand name" is required']);
    expect(p.data_oracle).toEqual(['"Channels" must only use: search, social, video']);
    expect(p.simulator).toEqual(['"Target CAC ceiling" must be at most 100']);
    expect(p.guardrails).toEqual(['"Strict brand safety" must be yes or no']);
    expect(p.rubric).toEqual([]); // null means "not set": the default (4) is used
    expect(studioAnswerProblems(bp, answers({ fields: {} })).scenario).toEqual([]);
    expect(studioAnswerProblems(bp, answers({ fields: { ...defaultStudioAnswers(bp).fields, extra: 1 } })).scenario).toEqual(['Unknown field "extra"']);
  });

  it('a field without a default must be answered', () => {
    const b = generatorFixture();
    b.custom_fields_by_stage.stage_1[1]!.default_value = null;
    expect(studioAnswerProblems(b, defaultStudioAnswers(b)).scenario).toEqual(['"Brand name" is required']);
    expect(studioAnswerProblems(b, { ...defaultStudioAnswers(b), fields: { brand_name: 'Quietline' } }).scenario).toEqual([]);
  });

  it('guardrail toggles must name rules of the template', () => {
    expect(studioAnswerProblems(bp, answers({ invariantRuleIds: ['spend_cap', 'ghost'] })).guardrails).toEqual(['Unknown guardrail "ghost"']);
    expect(studioAnswerProblems(bp, answers({ invariantRuleIds: [] })).guardrails).toEqual([]);
  });

  it('confirmation lists every blocking problem with its step', () => {
    const p = studioAnswerProblems(bp, answers({ sliders: { k_half: 1 }, milestoneWeights: { intent_f1: 1, budget: 1 } }));
    expect(p.confirm).toEqual(['Simulator Curve Tuning: "Saturation (K_half)" must be between 1000 and 50000', 'Rubric Weighting: Milestone weights must add up to 100 (now 2)']);
  });
});
