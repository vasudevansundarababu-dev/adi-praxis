import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_SECTIONS,
  HarborBlueprint,
  emptyBlueprint,
  isBlueprintComplete,
  isPathUnder,
  normaliseWeights,
  sectionProblems,
  slugify,
  validSectionCount,
  type HarborBlueprintInput,
} from '../src';

/** Synthetic example shaped like the Harbor PDF §4.1 marketing template (no real data). */
export function exampleBlueprint(): HarborBlueprintInput {
  return {
    studio_id: 'mktg-noise-cancelling-launch',
    catalog: {
      primary_work: 'Plan a 12-week launch budget for a synthetic noise-cancelling phone.',
      verification_criteria: 'Allocations respect the CAC ceiling and the oracle keyword table.',
      human_gate: 'A Reviewer checks the oracle table before approval.',
      skills: ['Performance marketing'],
      task_modes: ['AUTHORING'],
    },
    template_meta: { template_id: 'mktg-launch-ncp', label: 'Launch of Noise Cancelling Phone', domain_category: 'Digital Marketing', tpt_minutes: 45, tpt_label: '45m (12 Wks)', modes: ['HERMETIC_MCP'] },
    domain_meta: { title: 'Launch of Noise Cancelling Phone', persona_label: 'Growth Marketing Lead', horizon: { type: 'episodic_loop', max_turns: 12, cadence_unit: 'week' } },
    step_2_data_panels: {
      public_dropzones: [{ id: 'queries', label: 'Scraped queries', target_path: '/workspace/inputs/scraped_queries.csv', format: 'csv' }],
      oracle_annotator: {
        dataset_name: 'keyword_intent',
        target_path: '/eval/ground_truth/keyword_intent.csv',
        columns: ['keyword', 'intent'],
        sme_tag_options: ['BUY', 'RESEARCH', 'IGNORE'],
        template_preview_rows: [['quiet phone deal', 'BUY']],
      },
    },
    step_3_mcp_simulators: {
      tools: [{ tool_id: 'advance_campaign_week', parameters: [{ name: 'spend_usd', type: 'number' }] }],
      widgets: [{ archetype: 'diminishing_returns_curve_slider', key: 'k_half', label: 'Saturation (K_half)', min: 1000, max: 50000, default: 12000, step: 500 }],
    },
    step_4_invariant_catalog: {
      allowed_subjects: ['weekly_cac_usd', 'channels'],
      rules: [{ id: 'cac_ceiling', subject: 'weekly_cac_usd', operator: 'GREATER_THAN', threshold: 42 }],
    },
    step_5_default_rubric: {
      milestones: [
        { id: 'intent_f1', label: 'Keyword intent', weight: 60, verifier_template: 'f1_set_match' },
        { id: 'budget_lp', label: 'Budget allocation', weight: 40, verifier_template: 'lp_solver_ceiling' },
      ],
    },
    custom_fields_by_stage: {
      stage_3: [
        {
          field_id: 'target_cac_ceiling',
          label: 'Target CAC ceiling',
          input_type: 'currency_slider',
          min: 10,
          max: 100,
          default_value: 42,
          inject_into: ['instruction.md', 'eval/test_verifiers.py'],
          verifier_assertion: "env_state['weekly_cac_usd'] <= 42",
        },
      ],
    },
  };
}

const problems = (input: HarborBlueprintInput) => sectionProblems(HarborBlueprint.parse(input));

describe('Harbor blueprint schema (D-01)', () => {
  it('an empty object parses to a full blueprint with safe defaults', () => {
    const bp = emptyBlueprint();
    expect(bp.harbor_contract).toEqual({ atif_v1_2: true, network_internal: true, require_solve_sh: true, zero_baseline_gate: true });
    expect(bp.custom_fields_by_stage.stage_1).toEqual([]);
    expect(validSectionCount(sectionProblems(bp))).toBe(0);
  });

  it('round-trips through JSON without change', () => {
    const bp = HarborBlueprint.parse(exampleBlueprint());
    expect(HarborBlueprint.parse(JSON.parse(JSON.stringify(bp)))).toEqual(bp);
  });

  it('--network=internal cannot be switched off (S2-02, NFR-01)', () => {
    expect(HarborBlueprint.safeParse({ harbor_contract: { network_internal: false } }).success).toBe(false);
  });

  it('rejects unknown enum values and bad field ids', () => {
    expect(HarborBlueprint.safeParse({ domain_meta: { horizon: { type: 'forever' } } }).success).toBe(false);
    const bad = exampleBlueprint();
    bad.custom_fields_by_stage!.stage_3![0]!.field_id = 'Bad Id';
    expect(HarborBlueprint.safeParse(bad).success).toBe(false);
  });
});

describe('sectionProblems (D-03, S2-03 to S2-08)', () => {
  it('the example is 6/6 valid', () => {
    const p = problems(exampleBlueprint());
    expect(p).toEqual(Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s, []])));
    expect(isBlueprintComplete(HarborBlueprint.parse(exampleBlueprint()))).toBe(true);
  });

  it('public paths stay under /workspace/inputs/ and hidden paths under /eval/ground_truth/', () => {
    for (const path of ['/workspace/inputs/../secrets.csv', '/etc/passwd', 'workspace/inputs/a.csv', '/workspace/inputs/', '/workspace/inputs//a.csv', '/workspace/inputs/a b.csv']) {
      const bp = exampleBlueprint();
      bp.step_2_data_panels!.public_dropzones![0]!.target_path = path;
      expect(problems(bp).stage_2.join()).toContain('path must be a file under /workspace/inputs/');
    }
    const bp = exampleBlueprint();
    bp.step_2_data_panels!.oracle_annotator!.target_path = '/workspace/inputs/answers.csv';
    expect(problems(bp).stage_2.join()).toContain('/eval/ground_truth/');
    expect(isPathUnder('/workspace/inputs/', '/workspace/inputs/sub/a.csv')).toBe(true);
  });

  it('slider min <= default <= max and unique tool ids (S2-04)', () => {
    const bp = exampleBlueprint();
    bp.step_3_mcp_simulators!.widgets![0]!.default = 60000;
    bp.step_3_mcp_simulators!.tools!.push({ tool_id: 'advance_campaign_week' });
    const p = problems(bp).stage_3.join('\n');
    expect(p).toContain('default must not be above the maximum');
    expect(p).toContain('defined more than once');
  });

  it('rule subjects must be in the allowed list (S2-05)', () => {
    const bp = exampleBlueprint();
    bp.step_4_invariant_catalog!.rules![0]!.subject = 'unknown_subject';
    expect(problems(bp).stage_4.join()).toContain('is not in the allowed list');
  });

  it('weights must sum to exactly 100 (S2-06)', () => {
    const bp = exampleBlueprint();
    bp.step_5_default_rubric!.milestones![1]!.weight = 39;
    expect(problems(bp).stage_5).toEqual(['Milestone weights must add up to 100 (now 99)']);
  });

  it('custom fields need a target, options for selects, a typed default and a verifier assertion when bound (S2-08, S2-09)', () => {
    const bp = exampleBlueprint();
    bp.custom_fields_by_stage!.stage_2 = [
      { field_id: 'no_target', label: 'No target', input_type: 'text_input', inject_into: [] },
      { field_id: 'empty_select', label: 'Empty select', input_type: 'single_select', inject_into: ['task.json'] },
      { field_id: 'wrong_default', label: 'Wrong default', input_type: 'boolean_toggle', default_value: 'yes', inject_into: ['task.json'] },
      { field_id: 'bound', label: 'Bound', input_type: 'number_input', inject_into: ['eval/test_verifiers.py'] },
      { field_id: 'target_cac_ceiling', label: 'Duplicate id', input_type: 'text_input', inject_into: ['task.json'] },
    ];
    const p = problems(bp).stage_2.join('\n');
    expect(p).toContain('"no_target": choose at least one target');
    expect(p).toContain('"empty_select": add at least one option');
    expect(p).toContain('"wrong_default": default must be true or false');
    expect(p).toContain('"bound": a field bound to eval/test_verifiers.py needs a verifier assertion');
    expect(p).toContain('"target_cac_ceiling" is used more than once');
    expect(problems(bp).stage_3.join()).toContain('"target_cac_ceiling" is used more than once');
  });

  it('panel 0 needs today\'s publish fields (S2-18)', () => {
    const bp = exampleBlueprint();
    bp.catalog!.skills = [];
    expect(problems(bp).catalog).toEqual(['At least one skill is required']);
  });
});

describe('helpers', () => {
  it('normaliseWeights always sums to 100 and keeps order of size', () => {
    for (const w of [[1, 1, 1], [60, 50], [0, 0], [10, 20, 30, 40], [33, 33, 33]]) {
      const n = normaliseWeights(w);
      expect(n.reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(normaliseWeights([60, 40])).toEqual([60, 40]);
    expect(normaliseWeights([])).toEqual([]);
  });

  it('slugify produces valid field ids', () => {
    expect(slugify('Target CAC ceiling ($)')).toBe('target_cac_ceiling');
    expect(slugify('42 hops')).toBe('f_42_hops');
  });
});

describe('JSON Schema export (F2)', () => {
  it('describes the blueprint with every top-level key and the network mandate', async () => {
    const { blueprintJsonSchema } = await import('../src');
    const s = blueprintJsonSchema() as { definitions: { HarborBlueprint: { properties: Record<string, { properties?: Record<string, { const?: unknown }> }> } } };
    const props = s.definitions.HarborBlueprint.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['studio_id', 'template_meta', 'harbor_contract', 'domain_meta', 'step_2_data_panels', 'step_3_mcp_simulators', 'step_4_invariant_catalog', 'step_5_default_rubric', 'custom_fields_by_stage', 'catalog']));
    expect(props.harbor_contract!.properties!.network_internal!.const).toBe(true);
  });
});

describe('LLM judge milestones (owner decision 7 Nov 2026)', () => {
  const judged = (judge: unknown, body = 'assert True') =>
    ({ id: 'bl002', label: 'PR strategy', weight: 100, verifier_template: 'llm_judge_checklist', verifier_body: body, judge });
  const spec = { deliverable_path: '/workspace/outputs/memo.md', system_prompt: 'Grade strictly.', criteria: [{ num: 1, text: 'Recommends a code of conduct' }] };
  const stage5 = async (m: unknown) => {
    const { HarborBlueprint, sectionProblems } = await import('../src');
    return sectionProblems(HarborBlueprint.parse({ step_5_default_rubric: { milestones: [m] } })).stage_5;
  };

  it('accepts a complete judge milestone and defaults judge to null elsewhere', async () => {
    expect(await stage5(judged(spec))).toEqual([]);
    const { RubricMilestone } = await import('../src');
    expect(RubricMilestone.parse({ id: 'a', label: 'A', weight: 1, verifier_template: 'f1_set_match' }).judge).toBeNull();
  });

  it('still requires the deterministic gate check', async () => {
    expect((await stage5(judged(spec, ' '))).join()).toMatch(/deterministic gate check/);
  });

  it('keeps the deliverable under /workspace/outputs/ and needs criteria and instructions', async () => {
    const p = await stage5(judged({ ...spec, deliverable_path: '/eval/x.md', system_prompt: '', criteria: [] }));
    expect(p.join('\n')).toMatch(/deliverable must be a file under \/workspace\/outputs\//);
    expect(p.join('\n')).toMatch(/judge instructions are required/);
    expect(p.join('\n')).toMatch(/at least one judge criterion/);
  });

  it('rejects duplicate criteria and a judge on a non-judge verifier', async () => {
    expect((await stage5(judged({ ...spec, criteria: [spec.criteria[0], spec.criteria[0]] }))).join()).toMatch(/criterion 1 is listed more than once/);
    expect((await stage5({ ...judged(spec), verifier_template: 'f1_set_match' })).join()).toMatch(/needs the llm_judge_checklist verifier/);
  });
});

describe('Admin-fixed dropzone content', () => {
  const bpWith = async (fixed: string | null) => {
    const { HarborBlueprint } = await import('../src');
    return HarborBlueprint.parse({
      step_2_data_panels: { public_dropzones: [{ id: 'exhibits', label: 'Case exhibits', target_path: '/workspace/inputs/exhibits.md', format: 'md', fixed_content: fixed }] },
    });
  };
  const answers = (inputs: Record<string, string>) => ({ fields: {}, inputs, oracleRows: [], sliders: {}, invariantRuleIds: [], milestoneWeights: {}, instructionNotes: '' });

  it('defaults to null and leaves SME-supplied inputs unchanged', async () => {
    const { resolveAnswers } = await import('../src');
    const bp = await bpWith(null);
    expect(bp.step_2_data_panels.public_dropzones[0]!.fixed_content).toBeNull();
    expect(resolveAnswers(bp, answers({ exhibits: 'sme text' })).inputs.exhibits).toBe('sme text');
  });

  it('always resolves to the fixed content, even with no SME answer', async () => {
    const { resolveAnswers } = await import('../src');
    const bp = await bpWith('# Exhibit 10');
    expect(resolveAnswers(bp, null).inputs.exhibits).toBe('# Exhibit 10');
    expect(resolveAnswers(bp, answers({})).inputs.exhibits).toBe('# Exhibit 10');
  });

  it('refuses an SME answer that changes fixed content', async () => {
    const { studioAnswerProblems } = await import('../src');
    const bp = await bpWith('# Exhibit 10');
    expect(studioAnswerProblems(bp, answers({ exhibits: 'edited' })).data_oracle.join()).toMatch(/fixed by the template/);
    expect(studioAnswerProblems(bp, answers({ exhibits: '# Exhibit 10' })).data_oracle.join()).not.toMatch(/fixed by the template/);
  });
});
