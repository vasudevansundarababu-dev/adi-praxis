import { z } from 'zod';

/**
 * Rubric editor and recommendations (docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md). Everything here is INTERNAL to
 * Authoring: it is stored in its own tables and never placed in a task's output, so the RL Gym export and the approved
 * record hash are unchanged. RL Gym does not receive any of it yet (see RUBRIC_INTERNAL_ONLY).
 */

/** What RL Gym does not receive yet (plan section 9). Shown in the editor and listed in the integration note. */
export const RUBRIC_INTERNAL_ONLY = [
  'What should the agent do?',
  'Derived from (source links and their snapshots)',
  'When does this apply? (kind, condition, exceptions)',
  'Whole-task failure condition text',
  'What evidence should support the score?',
  'Sources used for this task',
  'Suggested additions and recommendation runs',
] as const;

/** Simplified-editor applicability kinds (owner spec §3), plus UNSET (not decided) and UNKNOWN (cannot be decided). */
export const RUBRIC_APPLICABILITY_KINDS = ['REQUIRED', 'REQUIRED_WHEN', 'PERMITTED_OPTION', 'OTHER_ROLE', 'UNSET', 'UNKNOWN'] as const;
export type ApplicabilityKind = (typeof RUBRIC_APPLICABILITY_KINDS)[number];
export const RUBRIC_APPLICABILITY_LABELS: Record<ApplicabilityKind, string> = {
  REQUIRED: 'Required throughout',
  REQUIRED_WHEN: 'Required when a condition applies',
  PERMITTED_OPTION: 'Permitted option',
  OTHER_ROLE: 'Human officer or other role',
  UNSET: 'Undefined',
  UNKNOWN: 'Unknown',
};

/**
 * Whole-task failure (owner spec §5). FAIL_OF_CRITERION is what the current contract supports: a Fail (0) on this
 * criterion fails the whole task (the exported `critical` flag). OTHER_BEHAVIOUR cannot be represented yet: it is kept
 * as a note and flagged "Evaluation setup needed"; it never changes the export.
 */
export const WholeTaskFailure = z.object({ condition: z.string().max(2000), kind: z.enum(['FAIL_OF_CRITERION', 'OTHER_BEHAVIOUR']) }).strict();
export type WholeTaskFailure = z.infer<typeof WholeTaskFailure>;

export const SOURCE_KINDS = ['TASK_FIELD', 'WORKFLOW_STEP', 'WORKFLOW_ROLE', 'POLICY_RULE', 'POLICY_DOCUMENT', 'OUTPUT_FIELD', 'TEMPLATE_REFERENCE'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** A source link with the identifiers and version references behind it, and the snapshot used during derivation. */
export const SourceLink = z
  .object({
    /** Stable key of the target, e.g. `task:S5.steps[1]`, `rule:<ruleVersionId>`, `doc:<documentVersionId>`. */
    target: z.string().min(1).max(300),
    kind: z.enum(SOURCE_KINDS),
    /** Readable label: "S2 · Inputs", "Workflow · Verify identity", "S4 · Policy rules · R-ID-1". */
    label: z.string().min(1).max(200),
    templateId: z.string().optional(),
    templateVersion: z.number().int().optional(),
    taskId: z.string().optional(),
    taskRevision: z.number().int().optional(),
    section: z.string().optional(),
    field: z.string().optional(),
    itemPath: z.string().optional(),
    stepId: z.string().optional(),
    roleId: z.string().optional(),
    ruleKey: z.string().optional(),
    ruleVersionId: z.string().optional(),
    documentVersionId: z.string().optional(),
    locator: z.record(z.unknown()).optional(),
    /** The supporting passage used during derivation (at most 280 characters). */
    excerpt: z.string().max(400),
    /** SHA-256 of the exact value at the target when it was linked. */
    snapshot: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type SourceLink = z.infer<typeof SourceLink>;

/** The author-editable internal fields of a criterion (the simplified editor's fields 2, 4, 6-detail and 7). */
export const EDITABLE_DETAILS = ['assesses', 'applicability', 'wholeTaskFailure', 'evidenceRequired'] as const;
export type EditableDetail = (typeof EDITABLE_DETAILS)[number];

export const RubricApplicability = z.object({ kind: z.enum(RUBRIC_APPLICABILITY_KINDS), condition: z.string().max(2000), exceptions: z.string().max(2000) }).strict();
export type RubricApplicability = z.infer<typeof RubricApplicability>;

export const AnnotationDetails = z
  .object({
    assesses: z.string().max(4000),
    applicability: RubricApplicability,
    wholeTaskFailure: WholeTaskFailure.nullable(),
    evidenceRequired: z.string().max(4000),
    /** Derivation chain parts (read-only to the author). */
    stepLabel: z.string().max(300).nullable(),
    roleLabel: z.string().max(300).nullable(),
    skill: z.string().max(300).nullable(),
    why: z.string().max(1000),
    unresolved: z.array(z.string().max(500)).max(20),
    /** Requirement keys this criterion covers (coverage). */
    covers: z.array(z.string().max(300)).max(100),
  })
  .strict();
export type AnnotationDetails = z.infer<typeof AnnotationDetails>;

/** A task-level source: one checkbox of "Sources used for this task" (owner, "make it simple"). */
export const TaskSourceItem = z
  .object({
    kind: z.enum(['POLICY_DOCUMENT', 'TEMPLATE_REFERENCE']),
    /** documentVersionId for a policy, or a template reference key (`template:<id>:tools` ...). */
    ref: z.string().min(1).max(200),
    label: z.string().min(1).max(300),
    detail: z.string().max(300),
    ticked: z.boolean(),
    origin: z.enum(['DEFAULT', 'ADDED']),
  })
  .strict();
export type TaskSourceItem = z.infer<typeof TaskSourceItem>;

// ── Requests (the API never accepts typed IDs for links: only choices from the lists it offers) ──

export const SaveCriterionRequest = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    assesses: z.string().max(4000).optional(),
    applicability: RubricApplicability.optional(),
    wholeTaskFailure: WholeTaskFailure.nullable().optional(),
    evidenceRequired: z.string().max(4000).optional(),
  })
  .strict();
export type SaveCriterionRequest = z.infer<typeof SaveCriterionRequest>;

export const SaveTaskSourcesRequest = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    /** Tick or untick by ref; add by choosing a ref the API offered in `available`. */
    ticked: z.array(z.string().min(1).max(200)).max(200),
    added: z.array(z.string().min(1).max(200)).max(50),
  })
  .strict();
export type SaveTaskSourcesRequest = z.infer<typeof SaveTaskSourcesRequest>;

export const RunRequest = z.object({ mode: z.enum(['DERIVED', 'AI']) }).strict();
export const AdditionDecision = z.object({ decision: z.enum(['KEEP', 'DISMISS']), expectedVersion: z.number().int().nonnegative() }).strict();
export const RestoreRequest = z.object({ submissionVersion: z.number().int().positive() }).strict();
