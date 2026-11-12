import { z } from 'zod';

/**
 * TemplateProfile v1 (handover v2.1 ch. 05 "One template-driven platform", ch. 16 "Required reusable profile").
 * A versioned, declarative description of one workflow template's authoring form: the eight common sections
 * (ch. 04), each built from shared field primitives. One profile drives the Classic renderer, the section progress,
 * the submission checks and the agent projection. A profile is data; it never contains code.
 */

export const PROFILE_SCHEMA_VERSION = 'praxis.template_profile.v1' as const;

/** The shared field primitives (ch. 05). Anything else is an unsupported field type and blocks registration. */
export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'pick_list',
  'multi_select',
  'evidence_record',
  'repeated_array',
  'policy_citation',
  'tool_call',
  'criterion',
  'graph_binding',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Who may see a field's value. Every `private_*` field is removed from the agent projection. */
export const FIELD_VISIBILITY = ['author_and_agent', 'private_reference', 'private_rubric'] as const;
export type FieldVisibility = (typeof FIELD_VISIBILITY)[number];

/** The eight common sections (ch. 04), always in this order. */
export const PROFILE_SECTIONS = [
  { key: 'S1', title: 'Assignment and brief' },
  { key: 'S2', title: 'Evidence and parties' },
  { key: 'S3', title: 'Environment and recorded tools' },
  { key: 'S4', title: 'Applicable project policies' },
  { key: 'S5', title: 'Expected work and process' },
  { key: 'S6', title: 'Allowed outcomes and values' },
  { key: 'S7', title: 'Rubric' },
  { key: 'S8', title: 'Check and submit' },
] as const;
export const SECTION_KEYS = PROFILE_SECTIONS.map((s) => s.key) as unknown as readonly ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
export type SectionKey = (typeof PROFILE_SECTIONS)[number]['key'];

/**
 * A condition on another field's value. `field` is `S6.disposition` for a section field, or a bare key for a sibling
 * inside the same repeated item. Exactly one of `equals`, `in` or `filled` is given.
 */
export const ProfileCondition = z
  .object({
    field: z.string().min(1),
    equals: z.string().optional(),
    in: z.array(z.string()).min(1).optional(),
    filled: z.boolean().optional(),
  })
  .strict()
  .refine((c) => [c.equals !== undefined, c.in !== undefined, c.filled !== undefined].filter(Boolean).length === 1, { message: 'A condition needs exactly one of equals, in or filled' });
export type ProfileCondition = z.infer<typeof ProfileCondition>;

/** `true`/`false`, or conditional: required when any `anyOf` condition holds, unless any `unless` condition holds. */
export const RequiredRule = z.union([z.boolean(), z.object({ anyOf: z.array(ProfileCondition).min(1), unless: z.array(ProfileCondition).optional() }).strict()]);
export type RequiredRule = z.infer<typeof RequiredRule>;

export const PickOption = z.object({ value: z.string().min(1), label: z.string().min(1) }).strict();
export type PickOption = z.infer<typeof PickOption>;

export interface TemplateProfileField {
  key: string;
  type: FieldType;
  label: string;
  /** Field help shown under the label. */
  help: string;
  /** Collapsed in the UI. Teaches the structure; never the assigned case's answer. */
  example?: string;
  required?: RequiredRule;
  visibility?: FieldVisibility;
  /** pick_list / multi_select values; tool_call: the allowed tools; evidence_record: the evidence types. */
  options?: PickOption[];
  /** multi_select / tool_call / evidence_record: free entries are allowed (catalogue not yet confirmed). */
  allowCustom?: boolean;
  /** number: inclusive bounds. */
  min?: number;
  max?: number;
  /** Array fields: minimum items when required (default 1). */
  minItems?: number;
  /** Array fields: maximum items. */
  maxItems?: number;
  /** repeated_array: the fields of each item. */
  itemFields?: TemplateProfileField[];
  /** Singular noun for one item ("evidence item"), used by Add/Remove. */
  itemLabel?: string;
  /** Prefix for suggested item IDs (E -> E1, E2). */
  idPrefix?: string;
  /** Canonical-storage profiles only: dotted path of the value in the existing output (e.g. `scenario.trigger`). */
  path?: string;
  /** S6 outcome fields: the `output.json` field this value is the reference for (pick_list -> string, number -> number). */
  outputField?: string;
  /** criterion: the weights of all criteria must total this. */
  weightTotal?: number;
  /** criterion: at least one criterion must be marked critical. */
  requireCritical?: boolean;
  /**
   * criterion: the scoring scale. `five_two_zero` (default): full 5, partial 2, fail 0. `zero_to_four`: levels 0-4,
   * each criterion scoring weight x level / 4 (Marketing Task2 rubric, owner decision 12 Nov 2026).
   */
  scale?: CriterionScale;
  /** criterion: weighted groups; each criterion names one, and the criteria of a group total its weight. */
  groups?: CriterionGroup[];
}

export const CRITERION_SCALES = ['five_two_zero', 'zero_to_four'] as const;
export type CriterionScale = (typeof CRITERION_SCALES)[number];
/** A rubric group (e.g. "B Adaptation", weight 20). `minimum`: a pass needs at least this many of its points. */
export interface CriterionGroup {
  id: string;
  label: string;
  weight: number;
  minimum?: number;
}
const CriterionGroupSchema = z
  .object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), label: z.string().min(1), weight: z.number().positive(), minimum: z.number().nonnegative().optional() })
  .strict();

export const TemplateProfileFieldSchema: z.ZodType<TemplateProfileField> = z.lazy(() =>
  z
    .object({
      key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Field keys are letters, digits and underscores'),
      type: z.enum(FIELD_TYPES),
      label: z.string().min(1),
      help: z.string().min(1),
      example: z.string().optional(),
      required: RequiredRule.optional(),
      visibility: z.enum(FIELD_VISIBILITY).optional(),
      options: z.array(PickOption).optional(),
      allowCustom: z.boolean().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minItems: z.number().int().min(0).optional(),
      maxItems: z.number().int().positive().optional(),
      itemFields: z.array(TemplateProfileFieldSchema).optional(),
      itemLabel: z.string().optional(),
      idPrefix: z.string().regex(/^[A-Z]{1,4}$/).optional(),
      path: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/).optional(),
      outputField: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).optional(),
      weightTotal: z.number().positive().optional(),
      requireCritical: z.boolean().optional(),
      scale: z.enum(CRITERION_SCALES).optional(),
      groups: z.array(CriterionGroupSchema).min(1).max(20).optional(),
    })
    .strict(),
);

export const ProfileSection = z
  .object({
    key: z.enum(SECTION_KEYS as unknown as [SectionKey, ...SectionKey[]]),
    title: z.string().min(1),
    /** Section help (from template-instructions where it exists). */
    help: z.string().optional(),
    /** Only S8 may be checks-only (no fields): it shows the checks and submission. */
    checksOnly: z.boolean().optional(),
    fields: z.array(TemplateProfileFieldSchema),
  })
  .strict();
export type ProfileSection = z.infer<typeof ProfileSection>;

export const ExportCapabilities = z
  .object({
    /** Export formats this template's approved records are emitted in. */
    formats: z.array(z.string().min(1)),
    /** Whether executable Anvil export is qualified for this template. */
    executable: z.boolean(),
    /** Explicit reasons executable export is blocked. */
    blockers: z.array(z.string().min(1)),
  })
  .strict();

/** `S2.evidence`: a section field reference. */
const FieldRef = z.string().regex(/^S[1-8]\.[A-Za-z][A-Za-z0-9_]*$/);

/**
 * How a sections profile compiles to `praxis.anvil.task.v1` (see contract.ts). Every reference names a field of this
 * profile; registration rejects unknown references.
 */
export const ContractMapping = z
  .object({
    /** S1 fields joined into the contract objective, in order. */
    objective: z.array(FieldRef).min(1),
    /** Fields given to the agent as actor evidence (evidence_record items one by one; other fields as one item each). */
    actorEvidence: z.array(FieldRef).min(1),
    /** Reference notes kept as private evidence (never actor material). */
    privateEvidence: z.array(FieldRef),
    /** policy_citation field: cited rules with a binding become constraints; others become actor evidence. */
    policies: FieldRef.nullable(),
    /** repeated_array of author-declared output fields (name, valueType, allowedValues, description, referenceValue). */
    decisionFields: FieldRef.nullable(),
    /** criterion field: the rubric. */
    criteria: FieldRef,
    /**
     * Reusable tasks over a case dataset (KYC five-state contract, 12 Nov 2026): the final answer is the template's
     * shared `execution.output_schema`, and each case's expected answer is private dataset material. The form then
     * declares no per-task output field and no expected answer. Without this, a sections form needs an output field.
     */
    outputsFrom: z.literal('template_execution').optional(),
    /**
     * Owner, 12 Nov (Q4 paid search): one output.json field per item of a repeated S5 field, e.g. q01_intent. Graded
     * fields get generated json_equals criteria sharing `weightShare` % of the score; the author's criteria share the
     * rest. Anvil's task v1 has no list type and at most 50 criteria, hence `maxItems`.
     */
    perItemOutputs: z
      .object({
        from: FieldRef,
        maxItems: z.number().int().positive().max(25),
        prefix: z.string().regex(/^[a-z]{1,4}$/),
        /** Item field shown to the agent to say which item a field is about (e.g. the query text). */
        labelKey: z.string(),
        fields: z.array(z.object({ key: z.string(), name: z.string().regex(/^[a-z_]{1,20}$/), label: z.string(), graded: z.boolean(), fallback: z.string().optional() }).strict()).min(1),
        weightShare: z.number().int().min(1).max(99),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ContractMapping = z.infer<typeof ContractMapping>;

export const TemplateProfileSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
    profileId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    version: z.number().int().positive(),
    /** Exact workflow name in the catalogue (`apps/api/prisma/catalog/index.ts`); matched case-insensitively. */
    catalogWorkflowName: z.string().min(1),
    /** Handover template ID (BK14, DM03, ...). */
    templateId: z.string().min(1),
    /** Handover name, when it differs from the catalogue's. */
    handoverName: z.string().optional(),
    agentMode: z.enum(['SINGLE', 'MULTI']),
    /** `sections`: values live in `output.sections.S1..S8`. `canonical`: each field's `path` into an existing contract. */
    storage: z.enum(['sections', 'canonical']),
    /** A specialised editor that replaces the Classic renderer (same save, check and projection APIs). */
    domainPlugin: z.string().nullable(),
    exportCapabilities: ExportCapabilities,
    contractStatus: z.enum(['confirmed', 'requires_confirmation']),
    /** S1 field mirrored into `output.header.title`. */
    titleField: z.string().min(1),
    /** Compilation to the Anvil task contract; null for a canonical profile with its own compiler (KYC). */
    contract: ContractMapping.nullable(),
    sections: z.array(ProfileSection).length(8),
  })
  .strict();
export type TemplateProfile = z.infer<typeof TemplateProfileSchema>;

/** Every profile-driven output stores which profile and version it was authored against. */
export interface ProfileRef {
  id: string;
  version: number;
}

export interface ProfileOutput extends Record<string, unknown> {
  profile: ProfileRef;
  header: { title?: string; coverageTags?: Record<string, string>; edgeCase?: string } & Record<string, unknown>;
  sections: Partial<Record<SectionKey, Record<string, unknown>>>;
}
