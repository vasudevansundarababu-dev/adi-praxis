import { z } from 'zod';
import { CoverageDimensions, EdgeCaseCatalog, TASK_MODES } from '../templates';

/**
 * Harbor template blueprint (PRD D-01, Harbor PDF §4.1 and §4.2). Stored on `Template.blueprint`.
 * Drafts may be incomplete: the schema checks shape, `sectionProblems` (validate.ts) checks completeness.
 */

export const BLUEPRINT_SCHEMA_VERSION = 1;

export const EXECUTION_MODES = ['HERMETIC_MCP', 'HERMETIC_GRAPH', 'HERMETIC_SQL'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const HORIZON_TYPES = ['episodic_loop', 'single_pass', 'milestone_graph'] as const;
export const WIDGET_ARCHETYPES = ['diminishing_returns_curve_slider', 'fuzzy_match_threshold_slider'] as const;
export const INVARIANT_OPERATORS = ['GREATER_THAN', 'EQUALS', 'CONTAINS_ANY'] as const;
export const INVARIANT_PENALTIES = ['HARD_FAIL'] as const;
export const VERIFIER_TEMPLATES = ['f1_set_match', 'regex_schema', 'lp_solver_ceiling', 'exact_graph_path', 'llm_judge_checklist'] as const;
export const CUSTOM_FIELD_INPUT_TYPES = ['number_input', 'currency_slider', 'single_select', 'multi_select', 'boolean_toggle', 'text_input'] as const;
export const INJECTION_TARGETS = ['instruction.md', 'task.json', 'mcp_mock.py', 'eval/test_verifiers.py'] as const;
export const DATAPANEL_FORMATS = ['csv', 'json', 'md', 'txt'] as const;

/** Panel 0 plus the five stages, in navigator order (S2-07, D11b). */
export const BLUEPRINT_SECTIONS = ['catalog', 'stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5'] as const;
export type BlueprintSection = (typeof BLUEPRINT_SECTIONS)[number];
export const CUSTOM_FIELD_STAGES = ['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5'] as const;

export const PUBLIC_INPUT_ROOT = '/workspace/inputs/';
export const AGENT_OUTPUT_ROOT = '/workspace/outputs/';
export const HIDDEN_GROUND_TRUTH_ROOT = '/eval/ground_truth/';

const id = z.string().trim().min(1).max(100);
const label = z.string().trim().max(200);
const text = z.string().max(20_000);

export const TemplateMeta = z.object({
  template_id: z.string().trim().max(128).default(''),
  registry_source: z.string().trim().max(200).default('domain_templates.json'),
  label: label.default(''),
  domain_category: label.default(''),
  version: z.number().int().min(1).default(1),
  tpt_minutes: z.number().int().min(1).max(480).nullable().default(null),
  tpt_label: z.string().trim().max(64).default(''),
  modes: z.array(z.enum(EXECUTION_MODES)).max(EXECUTION_MODES.length).default([]),
});

/** Harbor isolation flags. `network_internal` is a PDF mandate and can never be false (S2-02, NFR-01). */
export const HarborContract = z.object({
  atif_v1_2: z.boolean().default(true),
  network_internal: z.literal(true).default(true),
  require_solve_sh: z.boolean().default(true),
  zero_baseline_gate: z.boolean().default(true),
});

export const DomainMeta = z.object({
  title: label.default(''),
  persona_label: label.default(''),
  objective: text.default(''),
  horizon: z
    .object({
      type: z.enum(HORIZON_TYPES).default('episodic_loop'),
      max_turns: z.number().int().min(1).max(10_000).default(1),
      cadence_unit: z.string().trim().max(40).default(''),
    })
    .default({}),
});

export const Dropzone = z.object({
  id,
  label,
  target_path: z.string().trim().max(300),
  format: z.enum(DATAPANEL_FORMATS),
  description: z.string().max(2000).default(''),
  /** Admin-fixed file content (e.g. case exhibits). When set, every task gets exactly this and the SME cannot change it. */
  fixed_content: z.string().max(200_000).nullable().default(null),
});

export const OracleAnnotator = z.object({
  dataset_name: z.string().trim().max(100).default(''),
  target_path: z.string().trim().max(300).default(''),
  columns: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  sme_tag_options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  /** Each row has one cell per column, in column order. Synthetic only (NFR-05). */
  template_preview_rows: z.array(z.array(z.string().max(500)).max(50)).max(200).default([]),
});

export const DataPanels = z.object({
  public_dropzones: z.array(Dropzone).max(30).default([]),
  oracle_annotator: OracleAnnotator.default({}),
});

export const McpParameter = z.object({ name: id, type: z.enum(['string', 'number', 'boolean']), description: z.string().max(500).default('') });

export const McpTool = z.object({
  tool_id: id,
  description: z.string().max(2000).default(''),
  parameters: z.array(McpParameter).max(20).default([]),
});

export const SliderWidget = z.object({
  archetype: z.enum(WIDGET_ARCHETYPES),
  key: id,
  label,
  min: z.number(),
  max: z.number(),
  default: z.number(),
  step: z.number().positive().default(1),
  /** Display formula, e.g. `CTR(s) = CTR_base * (s / (s + K_half))`. Shown to the SME; not executed. */
  formula: z.string().max(300).default(''),
});

export const McpSimulators = z.object({
  tools: z.array(McpTool).max(30).default([]),
  widgets: z.array(SliderWidget).max(20).default([]),
});

export const InvariantRule = z.object({
  id,
  subject: z.string().trim().min(1).max(100),
  operator: z.enum(INVARIANT_OPERATORS),
  /** Number for GREATER_THAN; string or number for EQUALS; list for CONTAINS_ANY. */
  threshold: z.union([z.number(), z.string().max(500), z.array(z.string().max(200)).max(50)]),
  penalty: z.enum(INVARIANT_PENALTIES).default('HARD_FAIL'),
  description: z.string().max(1000).default(''),
});

export const InvariantCatalog = z.object({
  allowed_subjects: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  rules: z.array(InvariantRule).max(50).default([]),
});

export const JudgeCriterion = z.object({
  num: z.number().int().min(1).max(500),
  category: z.string().trim().max(100).default(''),
  text: z.string().trim().min(1).max(2000),
  points: z.number().int().min(1).max(100).default(1),
});

/**
 * Official per-task grading by an LLM judge (owner decision, 7 Nov 2026). Runs in Praxis after commit, outside the
 * hermetic task, within the cost caps. It never decides the deploy gate: `verifier_body` stays the deterministic
 * check that must score 0.00 / 1.00. Contains the answer key, so it is never written to agent-visible paths.
 */
export const JudgeSpec = z.object({
  deliverable_path: z.string().trim().max(300),
  system_prompt: text.default(''),
  criteria: z.array(JudgeCriterion).max(200).default([]),
});

export const RubricMilestone = z.object({
  id,
  label,
  weight: z.number().int().min(0).max(100),
  verifier_template: z.enum(VERIFIER_TEMPLATES),
  /** Verifier body the Admin accepted (Python). Assembled by the generators, never authored by them. */
  verifier_body: text.default(''),
  judge: JudgeSpec.nullable().default(null),
});

export type RubricMilestone = z.infer<typeof RubricMilestone>;
export type JudgeSpec = z.infer<typeof JudgeSpec>;

export const Rubric = z.object({ milestones: z.array(RubricMilestone).max(20).default([]) });

export const CustomFieldValue = z.union([z.number(), z.string().max(2000), z.boolean(), z.array(z.string().max(200)).max(50)]);

export const CustomField = z.object({
  field_id: z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/, 'field_id must be a lowercase slug (a-z, 0-9, _)'),
  label: z.string().trim().min(1).max(200),
  input_type: z.enum(CUSTOM_FIELD_INPUT_TYPES),
  options: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  default_value: CustomFieldValue.nullable().default(null),
  min: z.number().optional(),
  max: z.number().optional(),
  inject_into: z.array(z.enum(INJECTION_TARGETS)).max(INJECTION_TARGETS.length).default([]),
  /** Python expression over `env_state` for `test_custom_<field_id>` (S2-09); required when bound to the verifier. */
  verifier_assertion: z.string().max(2000).default(''),
});
export type CustomField = z.infer<typeof CustomField>;

export const CustomFieldsByStage = z.object({
  stage_1: z.array(CustomField).max(30).default([]),
  stage_2: z.array(CustomField).max(30).default([]),
  stage_3: z.array(CustomField).max(30).default([]),
  stage_4: z.array(CustomField).max(30).default([]),
  stage_5: z.array(CustomField).max(30).default([]),
});

/** Panel 0 "Catalog & Staffing" (D11b): today's template fields that the mockup does not show. */
export const CatalogPanel = z.object({
  primary_work: z.string().max(10_000).default(''),
  verification_criteria: z.string().max(10_000).default(''),
  human_gate: z.string().max(10_000).default(''),
  skills: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  default_jd_id: z.string().uuid().nullable().default(null),
  task_modes: z.array(z.enum(TASK_MODES)).max(2).default([]),
  coverage_dimensions: CoverageDimensions.default({ dimensions: [], cells: [] }),
  edge_case_catalog: EdgeCaseCatalog.default([]),
  default_distinct_target: z.number().int().min(1).max(100_000).default(50),
  default_max_per_expert: z.number().int().min(1).max(1000).default(4),
});

/** Domain content the Admin accepted (instruction prose, oracle script, mock data). Generators only assemble it. */
export const AuthoredContent = z.object({
  instruction_md: text.default(''),
  solve_sh: text.default(''),
  mcp_mock_seed_rows: z.array(z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))).max(500).default([]),
});

export const HarborBlueprint = z.object({
  schema_version: z.literal(BLUEPRINT_SCHEMA_VERSION).default(BLUEPRINT_SCHEMA_VERSION),
  studio_id: z.string().trim().max(100).default(''),
  catalog: CatalogPanel.default({}),
  template_meta: TemplateMeta.default({}),
  harbor_contract: HarborContract.default({}),
  domain_meta: DomainMeta.default({}),
  step_2_data_panels: DataPanels.default({}),
  step_3_mcp_simulators: McpSimulators.default({}),
  step_4_invariant_catalog: InvariantCatalog.default({}),
  step_5_default_rubric: Rubric.default({}),
  custom_fields_by_stage: CustomFieldsByStage.default({}),
  authored_content: AuthoredContent.default({}),
});
export type HarborBlueprint = z.infer<typeof HarborBlueprint>;
export type HarborBlueprintInput = z.input<typeof HarborBlueprint>;

export function emptyBlueprint(): HarborBlueprint {
  return HarborBlueprint.parse({});
}

/** Slug used for `field_id` and studio ids (S2-08: auto-slugged). */
export function slugify(label: string): string {
  const s = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
  return /^[a-z]/.test(s) ? s : `f_${s}`.slice(0, 63);
}
