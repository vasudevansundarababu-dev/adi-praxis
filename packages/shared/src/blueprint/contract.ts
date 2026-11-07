import type { CustomField, ExecutionMode, HarborBlueprint } from './schema';
import type { StudioAnswers } from './api';

/**
 * Frozen interfaces between the streams (plan §1): Stream 1 implements them, Stream 2 calls them, Stream 3 renders
 * them. Changing a type here needs the lead's agreement.
 */

// C1 generators (packages/shared/src/blueprint/generate/). Pure and deterministic: same input, byte-identical output.

export const GENERATED_ARTIFACTS = ['UISpec.json', 'meta_prompt.md', 'instruction.md', 'task.json', 'environment/mcp_mock.py', 'eval/test_verifiers.py'] as const;
export type GeneratedArtifactName = (typeof GENERATED_ARTIFACTS)[number];
export type GeneratedArtifacts = Record<GeneratedArtifactName, string>;

/** Template-level preview (Screen 2 inspector) uses `answers: null`, filling defaults; a studio task passes the SME's answers. */
export type GenerateArtifacts = (bp: HarborBlueprint, answers: StudioAnswers | null) => GeneratedArtifacts;

// C2 studio steps (packages/shared/src/blueprint/studio.ts), rendered by the candidate StudioWorkbench (U5).

export const STUDIO_STEP_IDS = ['scenario', 'data_oracle', 'simulator', 'guardrails', 'rubric', 'confirm'] as const;
export type StudioStepId = (typeof STUDIO_STEP_IDS)[number];

export type StudioControl =
  | { kind: 'text'; key: 'title' | 'instructionNotes'; label: string; multiline: boolean; required: boolean }
  | { kind: 'custom_field'; field: CustomField }
  | { kind: 'dropzone'; dropzoneId: string; label: string; format: string; targetPath: string }
  | { kind: 'oracle_grid'; columns: string[]; tagOptions: string[]; previewRows: string[][] }
  | { kind: 'curve_slider'; key: string; label: string; archetype: 'diminishing_returns_curve_slider' | 'fuzzy_match_threshold_slider'; min: number; max: number; default: number; step: number; formula: string }
  | { kind: 'invariant_toggle'; ruleId: string; description: string }
  | { kind: 'weight_slider'; milestoneId: string; label: string; default: number }
  | { kind: 'summary' };

export interface StudioStep {
  id: StudioStepId;
  title: string;
  controls: StudioControl[];
}

export type StudioSteps = (bp: HarborBlueprint) => StudioStep[];

/** Blocking problems per step for the SME's answers (S4-03); empty lists mean the task can be committed. */
export type StudioAnswerProblems = (bp: HarborBlueprint, answers: StudioAnswers) => Record<StudioStepId, string[]>;

// C3 bundle builder (apps/api/src/harbor/bundle.ts). Layout per PRD §6.3; deterministic tar.gz (D-20).

export interface BundleTaskMeta {
  externalTaskId: string;
  title: string;
  templateId: string;
  templateVersion: number;
  executionMode: ExecutionMode;
  dataClassification: 'SYNTHETIC' | 'REAL_PUBLIC';
}

export interface BundleManifestEntry {
  path: string;
  size: number;
  sha256: string;
  /** True for `eval/*` and `solution/*`: never shown to the agent or in the SME's agent-facing preview (D-21). */
  hidden: boolean;
}

export interface HarborBundle {
  bytes: Uint8Array;
  sha256: string;
  manifest: BundleManifestEntry[];
}

export type BuildBundle = (bp: HarborBlueprint, answers: StudioAnswers, meta: BundleTaskMeta) => HarborBundle;

// A6 verification runner (apps/api/src/harbor/runner.ts).

export type RunnerMode = 'null-agent' | 'oracle';
export interface RunnerResult {
  score: number;
  log: string;
  runnerRef: string;
}

// Post-commit LLM judge (owner decision, 7 Nov 2026). apps/api/src/meta-compiler/judge.ts; mock in tests and CI.

export interface JudgeCriterionResult {
  num: number;
  passed: boolean;
  evidence: string;
}

export interface JudgeMilestoneResult {
  milestoneId: string;
  pointsEarned: number;
  pointsPossible: number;
  criteria: JudgeCriterionResult[];
}

export interface JudgeResult {
  model: string;
  /** Weighted 0..1 across milestones, using the rubric weights. */
  score: number;
  milestones: JudgeMilestoneResult[];
  costUsd: number;
}
