import { HarborBlueprint, type HarborBlueprint as Blueprint, type HarborBlueprintInput } from '../src';

/** Synthetic generator fixture: every control type, every injection target and every invariant operator. */
export function generatorFixtureInput(): HarborBlueprintInput {
  return {
    studio_id: 'mktg-golden-fixture',
    catalog: {
      primary_work: 'Plan a 4-week synthetic launch budget.',
      verification_criteria: 'Spend stays under the CAC ceiling; keyword intents match the oracle table.',
      human_gate: 'A Reviewer checks the oracle table.',
      skills: ['Performance marketing'],
      task_modes: ['AUTHORING'],
    },
    template_meta: {
      template_id: 'mktg-golden',
      label: 'Golden fixture',
      domain_category: 'Digital Marketing',
      tpt_minutes: 30,
      tpt_label: '30m (4 Wks)',
      modes: ['HERMETIC_MCP'],
    },
    domain_meta: {
      title: 'Golden fixture launch',
      persona_label: 'Growth Marketing Lead',
      objective: 'Allocate weekly spend and label keyword intent.',
      horizon: { type: 'episodic_loop', max_turns: 4, cadence_unit: 'week' },
    },
    step_2_data_panels: {
      public_dropzones: [
        { id: 'queries', label: 'Search queries', target_path: '/workspace/inputs/queries.csv', format: 'csv', description: 'One query per row.' },
        { id: 'brief', label: 'Launch brief', target_path: '/workspace/inputs/brief.md', format: 'md' },
      ],
      oracle_annotator: {
        dataset_name: 'keyword_intent',
        target_path: '/eval/ground_truth/keyword_intent.csv',
        columns: ['keyword', 'intent'],
        sme_tag_options: ['BUY', 'RESEARCH', 'IGNORE'],
        template_preview_rows: [
          ['quiet phone deal', 'BUY'],
          ['best anc phone review', 'RESEARCH'],
          ['phone case free', 'IGNORE'],
        ],
      },
    },
    step_3_mcp_simulators: {
      tools: [
        { tool_id: 'lookup_keyword', description: 'Monthly volume for a keyword.', parameters: [{ name: 'keyword', type: 'string' }] },
        { tool_id: 'set_week_budget', description: 'Commit spend for one week.', parameters: [{ name: 'week', type: 'number' }, { name: 'spend_usd', type: 'number' }] },
      ],
      widgets: [
        { archetype: 'diminishing_returns_curve_slider', key: 'k_half', label: 'Saturation (K_half)', min: 1000, max: 50000, default: 12000, step: 500, formula: 'CTR(s) = CTR_base * (s / (s + K_half))' },
        { archetype: 'fuzzy_match_threshold_slider', key: 'match_threshold', label: 'Keyword match threshold', min: 0.5, max: 1, default: 0.85, step: 0.05 },
      ],
    },
    step_4_invariant_catalog: {
      allowed_subjects: ['spend_usd', 'channel', 'keyword'],
      rules: [
        { id: 'spend_cap', subject: 'spend_usd', operator: 'GREATER_THAN', threshold: 5000, description: 'Never commit more than $5,000 in a week.' },
        { id: 'no_tv', subject: 'channel', operator: 'EQUALS', threshold: 'tv' },
        { id: 'brand_safety', subject: 'keyword', operator: 'CONTAINS_ANY', threshold: ['counterfeit', 'replica'] },
      ],
    },
    step_5_default_rubric: {
      milestones: [
        {
          id: 'intent_f1',
          label: 'Keyword intent',
          weight: 60,
          verifier_template: 'f1_set_match',
          verifier_body: [
            "plan = env_state['outputs'].get('intent.csv') or []",
            "predicted = [r['keyword'] for r in plan if r.get('intent') == 'BUY']",
            "expected = tagged(ground_truth['keyword_intent.csv'], 'BUY', key='keyword')",
            'assert f1_set_match(predicted, expected) >= 0.99',
          ].join('\n'),
        },
        {
          id: 'budget',
          label: 'Budget allocation',
          weight: 40,
          verifier_template: 'lp_solver_ceiling',
          verifier_body: "weeks = [c for c in env_state['calls'] if c['tool'] == 'set_week_budget']\nassert len(weeks) == 4",
        },
      ],
    },
    custom_fields_by_stage: {
      stage_1: [
        { field_id: 'locale', label: 'Launch locale', input_type: 'single_select', options: ['en-GB', 'de-DE'], default_value: 'en-GB', inject_into: ['instruction.md', 'task.json'] },
        { field_id: 'brand_name', label: 'Brand name', input_type: 'text_input', default_value: 'Quietline', inject_into: ['instruction.md'] },
      ],
      stage_2: [{ field_id: 'channels', label: 'Channels', input_type: 'multi_select', options: ['search', 'social', 'video'], default_value: ['search'], inject_into: ['task.json', 'mcp_mock.py'] }],
      stage_3: [
        {
          field_id: 'target_cac_ceiling',
          label: 'Target CAC ceiling',
          input_type: 'currency_slider',
          min: 10,
          max: 100,
          default_value: 42,
          inject_into: ['instruction.md', 'eval/test_verifiers.py'],
          verifier_assertion: "all(float(r.get('cac_usd', 0)) <= value for r in env_state['outputs'].get('plan.csv') or [{'cac_usd': 999}])",
        },
      ],
      stage_4: [{ field_id: 'strict_mode', label: 'Strict brand safety', input_type: 'boolean_toggle', default_value: true, inject_into: ['mcp_mock.py'] }],
      stage_5: [{ field_id: 'min_weeks', label: 'Minimum weeks', input_type: 'number_input', min: 1, max: 12, default_value: 4, inject_into: ['eval/test_verifiers.py'], verifier_assertion: "len(env_state['calls']) >= value" }],
    },
    authored_content: {
      instruction_md: 'Plan the launch week by week.\n\nWrite `intent.csv` and `plan.csv` to `/workspace/outputs/`.',
      solve_sh: '#!/usr/bin/env bash\nset -euo pipefail\necho solved\n',
      mcp_mock_seed_rows: [
        { keyword: 'quiet phone deal', monthly_volume: 1200, cpc_usd: 1.4 },
        { keyword: 'best anc phone review', monthly_volume: 900, cpc_usd: 0.9 },
      ],
    },
  };
}

export function generatorFixture(): Blueprint {
  return HarborBlueprint.parse(generatorFixtureInput());
}
