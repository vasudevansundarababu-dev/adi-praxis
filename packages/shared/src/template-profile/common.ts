import { TEMPLATE_INSTRUCTIONS } from '../template-instructions';
import { PROFILE_SCHEMA_VERSION, PROFILE_SECTIONS, type PickOption, type TemplateProfileField, type TemplateProfile } from './schema';

/**
 * Shared building blocks for the non-KYC (sections-stored) profiles: the common eight-section fields of handover
 * ch. 04, with the template-specific parts supplied by each profile file from its `templates/<slug>/task.md` draft.
 * Field contracts outside KYC are marked `requires_confirmation` (AUTHORING-V2.1-PLAN §6).
 */

export const options = (...values: string[]): PickOption[] => values.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

/** Section help from the versioned per-template instructions (`template-instructions.ts`). */
export function sectionHelp(slug: string): string[] {
  const t = TEMPLATE_INSTRUCTIONS.find((x) => x.slug === slug);
  if (!t) throw new Error(`No template instructions for ${slug}`);
  return t.fields.map((f) => f.text);
}

export interface SectionsProfileSpec {
  profileId: string;
  templateId: string;
  catalogWorkflowName: string;
  handoverName?: string;
  slug: string;
  /** S1: what "trigger" means for this template, with a structural example. */
  trigger: { help: string; example: string };
  /** S1: the subject the case is about (customer, entity, alert, asset or product). */
  subject: { label: string; help: string; example: string };
  /** S2: the input kinds the draft lists, used as the evidence-type pick list. */
  evidenceTypes: string[];
  evidenceExample: string;
  /** S2: template-specific agent-visible inputs (e.g. KYB parties and ownership). */
  extraEvidence?: TemplateProfileField[];
  /** S5: template-specific deliverable fields. */
  deliverables: TemplateProfileField[];
  /** S5: extra item fields on each finding (e.g. a finding status pick list). */
  findingFields?: TemplateProfileField[];
  /** S6: the template's outcome pick lists, each mapped to an output.json field. */
  outcomes: TemplateProfileField[];
  /** S5: the draft lists the business hand-off as part of the expected deliverable, so it is required. */
  handoffRequired?: boolean;
}

const t = (key: string, label: string, help: string, extra: Partial<TemplateProfileField> = {}): TemplateProfileField => ({ key, type: 'text', label, help, ...extra });
const lt = (key: string, label: string, help: string, extra: Partial<TemplateProfileField> = {}): TemplateProfileField => ({ key, type: 'long_text', label, help, ...extra });
const refs = (key: string, label: string, help: string, extra: Partial<TemplateProfileField> = {}): TemplateProfileField => ({ key, type: 'multi_select', label, help, allowCustom: true, ...extra });

export const field = { t, lt, refs };

export function sectionsProfile(spec: SectionsProfileSpec): TemplateProfile {
  const help = sectionHelp(spec.slug);
  const sectionFields: TemplateProfileField[][] = [
    // S1 Assignment and brief
    [
      t('title', 'Title', 'Name the work the benchmark agent must do.', { required: true, example: 'Resolve inconsistent evidence before a recommendation' }),
      t('trigger', 'Trigger', spec.trigger.help, { required: true, example: spec.trigger.example }),
      lt('businessContext', 'Business context', 'Explain the situation and the assignment without giving the answer. This is the agent brief.', { required: true, example: 'Two records about the same subject disagree. Work out what can be supported and what needs a person.' }),
      lt('deliverable', 'Requested deliverable', 'The decision or deliverable the agent must produce. Do not include your answer.', { required: true, example: 'A recommendation with the findings that support it and any open gaps.' }),
      t('subject', spec.subject.label, spec.subject.help, { example: spec.subject.example }),
      t('productChannel', 'Product / channel', 'Relevant service and submission or publication channel, if supplied.', { example: 'Online application' }),
      t('scope', 'Jurisdiction, market or locale', 'The task boundaries. Do not let anyone infer a country from an identifier label.', { required: true, example: 'GB' }),
      t('language', 'Language', 'Language of the task material.', { required: true, example: 'en' }),
      { key: 'asOfDate', type: 'date', label: 'As-of date', help: 'The date that governs the evidence (YYYY-MM-DD).', required: true, example: '2026-06-30' },
      { key: 'difficulty', type: 'number', label: 'Difficulty (1-5)', help: 'Template-supported complexity. Not an execution receipt.', min: 1, max: 5, example: '3' },
      { key: 'estimatedSteps', type: 'number', label: 'Estimated steps', help: 'Expected size of the work.', min: 1, max: 50, visibility: 'private_reference', example: '6' },
    ],
    // S2 Evidence and parties
    [
      {
        key: 'evidence',
        type: 'evidence_record',
        label: 'Case inputs and evidence',
        help: 'Every input the agent can inspect, each with a stable ID, source and relevant date. Use authorised test data only.',
        example: spec.evidenceExample,
        required: true,
        options: options(...spec.evidenceTypes),
        itemLabel: 'evidence item',
        idPrefix: 'E',
      },
      ...(spec.extraEvidence ?? []),
      lt('knownGaps', 'Missing or inconsistent evidence (private)', 'Describe absences and contradictions explicitly. Kept out of the agent view so it does not give the answer away.', { visibility: 'private_reference', example: 'Record E2 has no issuer; the dates in E1 and E3 disagree.' }),
    ],
    // S3 Environment and recorded tools
    [
      { key: 'environment', type: 'pick_list', label: 'Environment', help: 'Choose none for a pure structured decision. Recorded tools need an executable binding later.', required: true, options: [{ value: 'none', label: 'No tools (structured decision)' }, { value: 'recorded_tools', label: 'Recorded tool responses' }] },
      refs('tools', 'Available tools', 'The allowed actions. The tool catalogue for this template is not confirmed yet; name each tool exactly.', { required: { anyOf: [{ field: 'S3.environment', equals: 'recorded_tools' }] }, example: 'registry_lookup' }),
      {
        key: 'recordedResponses',
        type: 'tool_call',
        label: 'Recorded responses',
        help: 'Each allowed call, its arguments and what the environment returns. This is not a claim that a live check occurred.',
        allowCustom: true,
        visibility: 'private_reference',
        required: { anyOf: [{ field: 'S3.environment', equals: 'recorded_tools' }] },
        itemLabel: 'recorded response',
        idPrefix: 'R',
        example: 'R1 · registry_lookup · arguments: the entity ID from E1 · response: the registry entry as of the as-of date.',
      },
      lt('failureBehaviour', 'Reset and failure behaviour', 'What happens when a tool is unavailable or errors. A missing outcome stays unassessed.', { visibility: 'private_reference', example: 'If the lookup errors, the agent records the gap and requests the record.' }),
    ],
    // S4 Applicable project policies
    [
      {
        key: 'policies',
        type: 'policy_citation',
        label: 'Applicable rules',
        help: 'The approved project rule, its version and source locator; which step it governs, why it applies and any exception.',
        required: true,
        itemLabel: 'rule',
        idPrefix: 'PR',
        example: 'PR1 · v1 · section 3.2 · "Quote the rule faithfully." · applies to the assessment step because …',
      },
      lt('proposedPolicy', 'Additional policy to propose', 'A further bank, customer or client document for authorised review. It has no authority until reviewed and published.', { visibility: 'private_reference' }),
    ],
    // S5 Expected work and process
    [
      {
        key: 'steps',
        type: 'repeated_array',
        label: 'Expected steps',
        help: 'The work the agent should do, in order. A dependency means another step must supply its output first.',
        required: true,
        visibility: 'private_reference',
        itemLabel: 'step',
        idPrefix: 'S',
        example: 'S1 · compare the two records · expected result: the discrepancy is named · why: it decides the outcome.',
        itemFields: [
          t('id', 'Step ID', 'Stable step ID.', { required: true }),
          lt('instruction', 'What the agent does', 'The work in this step.', { required: true }),
          lt('expectedResult', 'Expected result', 'What a correct step produces.', { required: true }),
          lt('why', 'Why it matters', 'The reason for the step.'),
          refs('evidenceRefs', 'Evidence used', 'Evidence IDs the step relies on.'),
          refs('dependsOn', 'Depends on', 'Earlier step IDs whose output this step needs.'),
          { key: 'graphNode', type: 'graph_binding', label: 'Workflow graph node', help: 'The graph node this step is bound to (set from the workflow graph).' },
        ],
      },
      {
        key: 'findings',
        type: 'repeated_array',
        label: 'Findings',
        help: 'Supported conclusions, each citing its evidence. Distinguish facts, reasonable inferences and unresolved gaps.',
        required: true,
        visibility: 'private_reference',
        itemLabel: 'finding',
        idPrefix: 'F',
        example: 'F1 · the two records disagree on the date · evidence: E1, E2',
        itemFields: [t('id', 'Finding ID', 'Stable finding ID.', { required: true }), lt('description', 'Finding', 'The supported conclusion.', { required: true }), refs('evidenceRefs', 'Evidence', 'Evidence or response IDs that support it.', { required: true }), ...(spec.findingFields ?? [])],
      },
      ...spec.deliverables.map((f) => ({ visibility: 'private_reference' as const, ...f })),
      lt('rationale', 'Rationale', 'Why the outcome follows from the evidence and the applicable rules.', { required: true, visibility: 'private_reference' }),
      lt('unresolvedIssues', 'Unresolved issues', 'What remains open and why.', { visibility: 'private_reference' }),
      lt('humanHandoff', 'Business hand-off', 'What an authorised person must decide or do next. This is a case interaction, not the Praxis review.', { visibility: 'private_reference', ...(spec.handoffRequired ? { required: true } : {}) }),
    ],
    // S6 Allowed outcomes and values
    [
      ...spec.outcomes.map((f) => ({ visibility: 'private_reference' as const, ...f })),
      {
        key: 'decisionFields',
        type: 'repeated_array',
        label: 'Further output fields',
        help: 'Other values the agent must write to output.json, with their type and your reference value. The agent sees the name, type and allowed values; never the reference.',
        itemLabel: 'output field',
        example: 'name: evidence_gap_count · type: number · reference: 2',
        itemFields: [
          t('name', 'Field name', 'Letters, digits and underscores (e.g. gap_count).', { required: true }),
          { key: 'valueType', type: 'pick_list', label: 'Type', help: 'string, number or boolean.', required: true, options: options('string', 'number', 'boolean') },
          refs('allowedValues', 'Allowed values', 'For a string field: the only values allowed. Leave empty for free text.'),
          lt('description', 'Description', 'What the value means.', { required: true }),
          t('referenceValue', 'Reference value', 'Your answer for this case (true/false for a boolean).', { required: true, visibility: 'private_reference' }),
        ],
      },
      lt('unsupportedSelection', 'No option fits', 'If no allowed value fits the case, explain it here for review. Do not invent a new value.', { visibility: 'private_reference' }),
    ],
    // S7 Rubric
    [
      {
        key: 'criteria',
        type: 'criterion',
        label: 'Criteria',
        help: 'For each criterion: what is assessed, an observable pass condition, its weight, and the output field it checks. Weights total 100.',
        required: true,
        visibility: 'private_rubric',
        weightTotal: 100,
        requireCritical: true,
        itemLabel: 'criterion',
        idPrefix: 'C',
        example: 'C1 · names the discrepancy · weight 40 · critical · checks the recommendation field equals the expected value',
      },
      {
        key: 'commonErrors',
        type: 'repeated_array',
        label: 'Common errors',
        help: 'A plausible wrong path and the criterion that catches it.',
        visibility: 'private_rubric',
        itemLabel: 'common error',
        itemFields: [lt('description', 'Error', 'The plausible mistake.', { required: true }), t('caughtBy', 'Caught by criterion', 'The criterion ID that catches it.', { required: true })],
      },
      refs('acceptableVariations', 'Acceptable variations', 'Other valid approaches. Do not require identical wording.', { visibility: 'private_rubric' }),
    ],
    // S8 Check and submit
    [lt('sourcesUsed', 'Authorised sources used', 'List the authorised sources you used to write this case, or write "none".', { required: true, visibility: 'private_reference' }), lt('reviewerNotes', 'Notes for the reviewer', 'Anything the reviewer should know.', { visibility: 'private_reference' })],
  ];

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileId: spec.profileId,
    version: 1,
    catalogWorkflowName: spec.catalogWorkflowName,
    templateId: spec.templateId,
    ...(spec.handoverName ? { handoverName: spec.handoverName } : {}),
    agentMode: 'SINGLE',
    storage: 'sections',
    domainPlugin: null,
    exportCapabilities: { formats: ['praxis.anvil.export.v1', 'praxis.anvil.task.v1'], executable: true, blockers: [] },
    contractStatus: 'requires_confirmation',
    titleField: 'title',
    contract: {
      objective: ['S1.businessContext', 'S1.deliverable'],
      actorEvidence: ['S2.evidence', ...(spec.extraEvidence ?? []).filter((f) => (f.visibility ?? 'author_and_agent') === 'author_and_agent').map((f) => `S2.${f.key}`)],
      privateEvidence: ['S2.knownGaps', 'S5.rationale', 'S5.unresolvedIssues'],
      policies: 'S4.policies',
      decisionFields: 'S6.decisionFields',
      criteria: 'S7.criteria',
    },
    sections: PROFILE_SECTIONS.map((s, i) => ({ key: s.key, title: s.title, help: help[i], fields: sectionFields[i]! })),
  };
}
