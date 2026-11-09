import { HarborBlueprint, slugify, type HarborBlueprintInput, type TemplateDto } from '@praxis/shared';

/**
 * Synthetic sample stages for the mock Meta-Compiler backend (no real data, NFR-05). Shaped like the Harbor PDF §4.1
 * marketing example. Used only while the Stream 2 routes are mocked (see lib/mc/mode.ts).
 */
export function sampleBlueprintInput(): HarborBlueprintInput {
  return {
    studio_id: 'mktg-noise-cancelling-launch',
    catalog: {
      primary_work: 'Plan a 12-week launch budget for a synthetic noise-cancelling phone.',
      verification_criteria: 'Allocations respect the CAC ceiling and the oracle keyword table.',
      human_gate: 'A Reviewer checks the oracle table before approval.',
      skills: ['Performance marketing'],
      task_modes: ['AUTHORING'],
    },
    template_meta: {
      template_id: 'mktg-launch-ncp',
      label: 'Launch of Noise Cancelling Phone',
      domain_category: 'Digital Marketing',
      tpt_minutes: 45,
      tpt_label: '12 Wks',
      modes: ['HERMETIC_MCP'],
    },
    domain_meta: {
      title: 'Launch of Noise Cancelling Phone',
      persona_label: 'Growth Marketing Lead',
      objective: 'Allocate weekly spend across channels without breaching the CAC ceiling.',
      horizon: { type: 'episodic_loop', max_turns: 12, cadence_unit: 'Wks' },
    },
    step_2_data_panels: {
      public_dropzones: [
        { id: 'queries', label: 'Scraped search queries', target_path: '/workspace/inputs/scraped_queries.csv', format: 'csv', description: 'One synthetic query per row.' },
        { id: 'brand_brief', label: 'Brand brief', target_path: '/workspace/inputs/brand_brief.md', format: 'md' },
      ],
      oracle_annotator: {
        dataset_name: 'keyword_intent',
        target_path: '/eval/ground_truth/keyword_intent.csv',
        columns: ['keyword', 'monthly_volume'],
        sme_tag_options: ['BUY', 'RESEARCH', 'IGNORE'],
        template_preview_rows: [
          ['quiet phone deal', '1200'],
          ['best anc phone review', '5400'],
          ['phone case blue', '800'],
        ],
      },
    },
    step_3_mcp_simulators: {
      tools: [
        { tool_id: 'advance_campaign_week', description: 'Moves the simulation one week forward.', parameters: [{ name: 'spend_usd', type: 'number' }] },
        { tool_id: 'get_channel_metrics', parameters: [{ name: 'channel', type: 'string' }] },
      ],
      widgets: [
        { archetype: 'diminishing_returns_curve_slider', key: 'k_half', label: 'Saturation spend (K_half)', min: 1000, max: 50000, default: 12000, step: 500, formula: 'CTR(s) = CTR_base * (s / (s + K_half))' },
        { archetype: 'diminishing_returns_curve_slider', key: 'ctr_base', label: 'Base CTR (CTR_base)', min: 0.01, max: 0.2, default: 0.06, step: 0.01, formula: 'CTR(s) = CTR_base * (s / (s + K_half))' },
      ],
    },
    step_4_invariant_catalog: {
      allowed_subjects: ['weekly_cac_usd', 'channels', 'creative_fatigue'],
      rules: [
        { id: 'cac_ceiling', subject: 'weekly_cac_usd', operator: 'GREATER_THAN', threshold: 42, description: 'IF weekly CAC > $42 THEN hard fail.' },
        { id: 'no_banned_channels', subject: 'channels', operator: 'CONTAINS_ANY', threshold: ['tabloid_print'], description: 'IF a banned channel is used THEN hard fail.' },
      ],
    },
    step_5_default_rubric: {
      milestones: [
        { id: 'intent_f1', label: 'Keyword intent', weight: 40, verifier_template: 'f1_set_match' },
        { id: 'budget_lp', label: 'Budget allocation', weight: 35, verifier_template: 'lp_solver_ceiling' },
        { id: 'report_schema', label: 'Weekly report schema', weight: 25, verifier_template: 'regex_schema' },
      ],
    },
    custom_fields_by_stage: {
      stage_1: [
        { field_id: 'launch_locales', label: 'Launch locales', input_type: 'multi_select', options: ['en-GB', 'en-US', 'de-DE'], default_value: ['en-GB'], inject_into: ['task.json'] },
      ],
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
    authored_content: {
      instruction_md: 'You are the growth lead for a synthetic phone launch. Allocate spend week by week.',
      solve_sh: '#!/bin/sh\necho "oracle"\n',
    },
  };
}

/** Mock blueprint for a real template: its catalog fields plus the synthetic sample stages. */
export function blueprintForTemplate(t: TemplateDto): HarborBlueprint {
  const base = sampleBlueprintInput();
  const cov = t.coverageDimensions as { dimensions?: unknown[]; cells?: unknown[] } | null;
  const studioId = slugify(t.workflowName).replace(/_/g, '-').slice(0, 60);
  return HarborBlueprint.parse({
    ...base,
    studio_id: studioId.length >= 3 ? studioId : 'workflow',
    catalog: {
      primary_work: t.primaryWork ?? '',
      verification_criteria: t.verificationCriteria ?? '',
      human_gate: t.humanGate ?? '',
      skills: t.skills,
      task_modes: t.taskModes,
      coverage_dimensions: cov && Array.isArray(cov.dimensions) ? cov : { dimensions: [], cells: [] },
      edge_case_catalog: Array.isArray(t.edgeCaseCatalog) ? t.edgeCaseCatalog : [],
      default_distinct_target: t.defaultDistinctTarget,
      default_max_per_expert: t.defaultMaxPerExpert,
    },
    template_meta: {
      ...base.template_meta,
      template_id: t.id,
      label: t.workflowName,
      domain_category: t.domainName,
      version: t.version,
      tpt_minutes: t.defaultTptMinutes ?? 45,
    },
    domain_meta: { ...base.domain_meta, title: t.workflowName },
  });
}
