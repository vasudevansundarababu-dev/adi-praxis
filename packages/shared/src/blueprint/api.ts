import { z } from 'zod';
import { TEMPLATE_STATUSES } from '../templates';
import { BLUEPRINT_SECTIONS, CustomField, EXECUTION_MODES, HarborBlueprint } from './schema';

/** Request and response contracts for the Meta-Compiler routes (architecture §5). */

const uuid = z.string().uuid();
const isoDate = z.string();
const usd = z.number().nonnegative();

export const SectionProblemsDto = z.object(
  Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s, z.array(z.string())])) as Record<(typeof BLUEPRINT_SECTIONS)[number], z.ZodArray<z.ZodString>>,
);

// Screen 1: directory

export const DEPLOYMENT_STATUSES = ['ACTIVE', 'STOPPED', 'FAILED'] as const;
export const DIRECTORY_STATUSES = ['DRAFT', 'PUBLISHED', 'GENERATING', 'VERIFIED', 'ACTIVE', 'RETIRED'] as const;

export const DirectoryDeploymentDto = z.object({
  id: uuid,
  projectId: uuid,
  projectName: z.string(),
  status: z.enum(DEPLOYMENT_STATUSES),
  /** Admin view only (S1-10, NFR-05). */
  smeEmail: z.string().nullable(),
  studioUrl: z.string().nullable(),
});

export const DirectoryRowDto = z.object({
  templateId: uuid,
  lineageId: uuid,
  version: z.number().int(),
  workflowName: z.string(),
  templateStatus: z.enum(TEMPLATE_STATUSES),
  status: z.enum(DIRECTORY_STATUSES),
  tptMinutes: z.number().int().nullable(),
  tptLabel: z.string(),
  modes: z.array(z.enum(EXECUTION_MODES)),
  validSections: z.number().int().min(0).max(BLUEPRINT_SECTIONS.length),
  hasBlueprint: z.boolean(),
  /** Execution is defined by Anvil (`anvilSpec` set): the "n/6 valid" counter does not apply. */
  definedByAnvil: z.boolean(),
  variantOfId: uuid.nullable(),
  projectCount: z.number().int(),
  authoredTaskCount: z.number().int(),
  deployments: z.array(DirectoryDeploymentDto),
  updatedAt: isoDate,
});
export type DirectoryRowDto = z.infer<typeof DirectoryRowDto>;

export const DirectoryDomainDto = z.object({ domainId: uuid, domainName: z.string(), rows: z.array(DirectoryRowDto) });

export const TemplateDirectoryResponse = z.object({
  view: z.enum(['ADMIN', 'PM']),
  summary: z.object({
    totalTemplates: z.number().int(),
    activeStudios: z.number().int(),
    attachedProjects: z.number().int(),
    attachedSmes: z.number().int(),
    authoredTasks: z.number().int(),
  }),
  domains: z.array(DirectoryDomainDto),
});
export type TemplateDirectoryResponse = z.infer<typeof TemplateDirectoryResponse>;

// Screen 2: blueprint editing

export const BlueprintResponse = z.object({
  templateId: uuid,
  lineageId: uuid,
  version: z.number().int(),
  templateStatus: z.enum(TEMPLATE_STATUSES),
  editable: z.boolean(),
  blueprint: HarborBlueprint,
  blueprintRevision: z.number().int(),
  problems: SectionProblemsDto,
  validSections: z.number().int(),
  variantOfId: uuid.nullable(),
});
export type BlueprintResponse = z.infer<typeof BlueprintResponse>;

export const SaveBlueprintRequest = z.object({ blueprint: HarborBlueprint, expectedRevision: z.number().int().min(0) });
export type SaveBlueprintRequest = z.infer<typeof SaveBlueprintRequest>;

export const SaveVariantRequest = z.object({ label: z.string().trim().min(1).max(200) });
export type SaveVariantRequest = z.infer<typeof SaveVariantRequest>;
export const SaveVariantResponse = z.object({ templateId: uuid, lineageId: uuid, version: z.literal(1), variantOfId: uuid });

export const ElicitationPresetDto = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(200),
  field: CustomField,
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type ElicitationPresetDto = z.infer<typeof ElicitationPresetDto>;
export const SavePresetsRequest = z.object({
  presets: z.array(ElicitationPresetDto.omit({ id: true }).extend({ id: uuid.optional() })).max(100),
});

export const ProposeFieldRequest = z.object({
  stage: z.enum(['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5']),
  prompt: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1).max(100).optional(),
});
export const ProposeFieldResponse = z.object({
  /** Never saved by this call (D7): the Admin accepts, edits or discards it. */
  proposal: CustomField.nullable(),
  problems: z.array(z.string()),
  provider: z.enum(['claude', 'gemini', 'mock']),
  model: z.string(),
  costUsd: usd,
  /** Set when AI is off or over its cap; the Admin can still add the field by hand. */
  unavailableReason: z.string().nullable(),
});

// Screen 3: generate, verify, deploy

export const GENERATION_MODES = ['BLUEPRINT', 'FULL_CODE'] as const;
export const DRAFTER_PROVIDERS = ['claude', 'gemini', 'mock'] as const;
export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CAPPED'] as const;
export const VERIFICATION_CHECK_IDS = ['01_bundle_layout', '02_hidden_paths', '03_network_internal', '04_zero_baseline', '05_oracle_solve'] as const;

export const ModelOptionDto = z.object({ provider: z.enum(DRAFTER_PROVIDERS), model: z.string(), label: z.string(), available: z.boolean() });

export const StartGenerationRequest = z.object({
  provider: z.enum(DRAFTER_PROVIDERS),
  model: z.string().trim().min(1).max(100),
  mode: z.enum(GENERATION_MODES).default('BLUEPRINT'),
});

export const GenerationRunDto = z.object({
  id: uuid,
  templateId: uuid,
  templateVersion: z.number().int(),
  mode: z.enum(GENERATION_MODES),
  provider: z.enum(DRAFTER_PROVIDERS),
  model: z.string(),
  status: z.enum(RUN_STATUSES),
  progress: z.object({ ui: z.number().min(0).max(100), backend: z.number().min(0).max(100), message: z.string() }),
  estimatedCostUsd: usd.nullable(),
  actualCostUsd: usd.nullable(),
  outputSha256: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoDate,
  finishedAt: isoDate.nullable(),
});
export type GenerationRunDto = z.infer<typeof GenerationRunDto>;

export const VerificationCheckDto = z.object({
  id: z.enum(VERIFICATION_CHECK_IDS),
  passed: z.boolean().nullable(),
  value: z.string().nullable(),
  evidence: z.string().nullable(),
});

export const VerificationRunDto = z.object({
  id: uuid,
  generationRunId: uuid,
  status: z.enum(RUN_STATUSES),
  checks: z.array(VerificationCheckDto),
  zeroBaselineScore: z.number().nullable(),
  oracleScore: z.number().nullable(),
  bundleSha256: z.string().nullable(),
  /** Redacted runner log tail (S3-08). */
  logTail: z.string(),
  createdAt: isoDate,
  finishedAt: isoDate.nullable(),
});
export type VerificationRunDto = z.infer<typeof VerificationRunDto>;

export const CreateDeploymentRequest = z.object({ verificationRunId: uuid, projectId: uuid, smeCandidateId: uuid });
export const StudioDeploymentDto = z.object({
  id: uuid,
  templateId: uuid,
  templateVersion: z.number().int(),
  projectId: uuid,
  smeCandidateId: uuid,
  studioKey: z.string(),
  studioUrl: z.string(),
  status: z.enum(DEPLOYMENT_STATUSES),
  runtime: z.enum(['SHARED', 'ISOLATED']),
  createdAt: isoDate,
});
export type StudioDeploymentDto = z.infer<typeof StudioDeploymentDto>;

// Screen 4: SME studio and task store

export const DATA_CLASSIFICATIONS = ['SYNTHETIC', 'REAL_PUBLIC'] as const;

export const StudioAnswers = z.object({
  /** Custom field values keyed by field_id. */
  fields: z.record(z.string(), z.union([z.number(), z.string().max(5000), z.boolean(), z.array(z.string().max(200)).max(50), z.null()])),
  /** Public dropzone contents keyed by dropzone id (synthetic text; NFR-05). */
  inputs: z.record(z.string(), z.string().max(200_000)),
  /** Oracle grid: one row per preview row, one cell per column, plus the SME tag. */
  oracleRows: z.array(z.object({ cells: z.array(z.string().max(500)).max(50), tag: z.string().max(100) })).max(500),
  /** Slider values keyed by widget key. */
  sliders: z.record(z.string(), z.number()),
  invariantRuleIds: z.array(z.string().max(100)).max(50),
  milestoneWeights: z.record(z.string(), z.number().int().min(0).max(100)),
  instructionNotes: z.string().max(20_000),
});
export type StudioAnswers = z.infer<typeof StudioAnswers>;

export const StudioConfigResponse = z.object({
  studioKey: z.string(),
  deploymentStatus: z.enum(DEPLOYMENT_STATUSES),
  workflowName: z.string(),
  templateVersion: z.number().int(),
  projectName: z.string(),
  taskInstanceId: uuid,
  revision: z.number().int(),
  answers: StudioAnswers.nullable(),
  /** Agent-facing blueprint view: hidden paths (/eval, /solution) removed (D-21). */
  blueprint: HarborBlueprint,
  realDataEnabled: z.boolean(),
});

export const SaveStudioDraftRequest = z.object({ answers: StudioAnswers, expectedRevision: z.number().int().min(0) });
export const CommitStudioTaskRequest = z.object({ expectedRevision: z.number().int().min(0), dataClassification: z.enum(DATA_CLASSIFICATIONS) });

export const SmeAuthoredTaskDto = z.object({
  id: uuid,
  externalTaskId: z.string(),
  taskInstanceId: uuid,
  submissionVersion: z.number().int(),
  templateId: uuid,
  templateVersion: z.number().int(),
  workflowName: z.string(),
  projectId: uuid,
  projectName: z.string(),
  /** Admin view only. */
  authoredBy: z.string().nullable(),
  title: z.string(),
  executionMode: z.enum(EXECUTION_MODES),
  bundleSha256: z.string(),
  zeroBaselineScore: z.number().nullable(),
  oracleScore: z.number().nullable(),
  dataClassification: z.enum(DATA_CLASSIFICATIONS),
  reviewStatus: z.string(),
  createdAt: isoDate,
});
export type SmeAuthoredTaskDto = z.infer<typeof SmeAuthoredTaskDto>;
