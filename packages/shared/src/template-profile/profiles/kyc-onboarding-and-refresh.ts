import { KYC_DISPOSITIONS, KYC_PARTY_ROLES, KYC_RESPONSE_KINDS, KYC_RISK, KYC_SEVERITY, KYC_TOOLS, KYC_TRIGGERS } from '../../kyc';
import { sectionHelp } from '../common';
import { PROFILE_SCHEMA_VERSION, PROFILE_SECTIONS, type PickOption, type TemplateProfileField, type TemplateProfile } from '../schema';

/**
 * BK14 KYC onboarding and refresh. Mirrors the existing typed contract (`kyc.ts`, handover ch. 15) field by field:
 * every field carries its canonical `path`, nothing is renamed, and requiredness follows `kycChecks`. The KYC
 * workbench stays the editor (`domainPlugin: 'kyc-workbench'`); this profile drives section progress, checks and the
 * agent projection. Its Anvil compiler is `compileKycContract` (contract.ts).
 */

const o = (values: readonly string[]): PickOption[] => values.map((v) => ({ value: v, label: v.replace(/_/g, ' ').toLowerCase() }));
const TOOLS: PickOption[] = KYC_TOOLS.map((t) => ({ value: t.key, label: t.label }));
const t = (key: string, path: string, label: string, help: string, extra: Partial<TemplateProfileField> = {}): TemplateProfileField => ({ key, path, type: 'text', label, help, ...extra });
const lt = (key: string, path: string, label: string, help: string, extra: Partial<TemplateProfileField> = {}): TemplateProfileField => ({ key, path, type: 'long_text', label, help, ...extra });
const it = (key: string, label: string, help: string, extra: Partial<TemplateProfileField> = {}): TemplateProfileField => ({ key, type: 'text', label, help, ...extra });

const fields: TemplateProfileField[][] = [
  // S1 (W01/W02 header and scenario)
  [
    t('title', 'header.title', 'Title', 'Case title: the work the agent must do.', { required: true, example: 'Resolve inconsistent applicant identity evidence' }),
    { key: 'difficulty', path: 'header.difficulty', type: 'number', label: 'Difficulty (1-5)', help: 'Complexity of the case.', required: true, min: 1, max: 5, visibility: 'private_reference' },
    t('jurisdiction', 'header.jurisdiction', 'Jurisdiction', 'Supplied scope; not inferred from an identifier name.', { required: true, example: 'GB' }),
    t('language', 'header.language', 'Language', 'Task language.', { required: true, example: 'en' }),
    { key: 'estimatedSteps', path: 'header.estimatedSteps', type: 'number', label: 'Estimated steps', help: 'Expected work count.', min: 1, visibility: 'private_reference' },
    { key: 'trigger', path: 'scenario.trigger', type: 'pick_list', label: 'Trigger', help: 'The event that starts the work.', required: true, options: o(KYC_TRIGGERS) },
    t('customerType', 'scenario.customerType', 'Customer type', 'Customer category.', { required: true, example: 'individual' }),
    t('product', 'scenario.product', 'Product', 'Relevant service.'),
    t('channel', 'scenario.channel', 'Channel', 'Submission channel.'),
    lt('businessContext', 'scenario.businessContext', 'Business context', 'Agent-visible brief. No private solution; no invented case fact.', { required: true }),
  ],
  // S2 (W02/W03 customer file and evidence)
  [
    {
      key: 'parties',
      path: 'customerFile.parties',
      type: 'repeated_array',
      label: 'Parties',
      help: 'Each party with a stable ID, role and authorised test identity.',
      required: true,
      itemLabel: 'party',
      idPrefix: 'P',
      itemFields: [
        it('id', 'Party ID', 'Stable party ID.', { required: true }),
        { key: 'role', type: 'pick_list', label: 'Role', help: 'Catalogue party role.', required: true, options: o(KYC_PARTY_ROLES) },
        { key: 'kind', type: 'pick_list', label: 'Kind', help: 'Person or entity.', options: o(['PERSON', 'ENTITY']) },
        it('name', 'Name', 'Authorised test identity.', { required: true }),
        { key: 'dateOfBirth', type: 'date', label: 'Date of birth', help: 'Persons only.' },
        { key: 'incorporationDate', type: 'date', label: 'Incorporation date', help: 'Entities only.' },
        it('nationality', 'Nationality', 'Supplied attribute; implies no requirement on its own.'),
        it('incorporationCountry', 'Incorporation country', 'Supplied attribute.'),
        { key: 'addresses', type: 'multi_select', label: 'Addresses', help: 'Supplied addresses.', allowCustom: true },
        { key: 'identifiers', type: 'repeated_array', label: 'Identifiers', help: 'Missing stays missing; synthetic formats only.', itemLabel: 'identifier', itemFields: [it('type', 'Type', 'Identifier type.', { required: true }), it('value', 'Value', 'Synthetic value.', { required: true })] },
      ],
    },
    {
      key: 'ownership',
      path: 'customerFile.ownership',
      type: 'repeated_array',
      label: 'Ownership',
      help: 'Ownership links between listed parties.',
      itemLabel: 'ownership link',
      itemFields: [it('ownerId', 'Owner', 'Owning party ID.', { required: true }), it('ownedId', 'Owned', 'Owned party ID.', { required: true }), { key: 'percent', type: 'number', label: 'Percent', help: 'Between 0 and 100.', min: 0, max: 100, required: true }],
    },
    lt('statedPurpose', 'customerFile.statedPurpose', 'Stated purpose', "The customer's stated purpose."),
    lt('expectedActivity', 'customerFile.expectedActivity', 'Expected activity', "The customer's stated expected activity."),
    {
      key: 'documents',
      path: 'evidence.documents',
      type: 'repeated_array',
      label: 'Documents',
      help: 'Evidence records with ID, type and issuer.',
      required: true,
      itemLabel: 'document',
      idPrefix: 'D',
      itemFields: [
        it('id', 'Document ID', 'Unique document ID.', { required: true }),
        it('type', 'Type', 'Document kind.', { required: true }),
        it('issuer', 'Issuer', 'Missing issuer stays unknown.'),
        it('partyId', 'Party', 'Existing party ID.'),
        { key: 'issueDate', type: 'date', label: 'Issue date', help: 'YYYY-MM-DD.' },
        { key: 'expiryDate', type: 'date', label: 'Expiry date', help: 'YYYY-MM-DD.' },
        { key: 'fields', type: 'repeated_array', label: 'Extracted fields', help: 'Faithful authorised content.', itemLabel: 'field', itemFields: [it('name', 'Name', 'Field name.', { required: true }), it('value', 'Value', 'Field value.', { required: true })] },
        { key: 'defects', type: 'multi_select', label: 'Defects (private)', help: 'Evaluator-facing defects; never in the agent view.', allowCustom: true, visibility: 'private_reference' },
      ],
    },
  ],
  // S3 (W03 environment)
  [
    { key: 'tools', path: 'environment.tools', type: 'multi_select', label: 'Available tools', help: 'Allowed catalogue tools.', required: true, options: TOOLS },
    {
      key: 'responses',
      path: 'environment.responses',
      type: 'repeated_array',
      label: 'Recorded responses',
      help: 'Recorded calls; supplied to the agent only on a matching call.',
      visibility: 'private_reference',
      itemLabel: 'recorded response',
      idPrefix: 'R',
      itemFields: [
        it('id', 'Response ID', 'Stable response ID.', { required: true }),
        { key: 'tool', type: 'pick_list', label: 'Tool', help: 'Declared allowed tool.', required: true, options: TOOLS },
        it('input', 'Input summary', 'Human-readable argument summary.'),
        { key: 'kind', type: 'pick_list', label: 'Kind', help: 'Recorded result kind.', options: o(KYC_RESPONSE_KINDS) },
        { key: 'response', type: 'long_text', label: 'Response', help: 'What the environment returns.', required: true },
      ],
    },
  ],
  // S4 (task policy rules)
  [
    {
      key: 'policyRules',
      path: 'policy.rules',
      type: 'repeated_array',
      label: 'Task policy rules',
      help: 'Existing free-text rule representation. Published rule links use the policy service.',
      itemLabel: 'rule',
      idPrefix: 'PR',
      itemFields: [it('id', 'Rule ID', 'Rule ID.', { required: true }), { key: 'text', type: 'long_text', label: 'Rule text', help: 'The rule.', required: true }],
    },
  ],
  // S5 (W04 reference trajectory)
  [
    {
      key: 'steps',
      path: 'solution.steps',
      type: 'repeated_array',
      label: 'Reference steps',
      help: 'Expected steps, TOOL or REASONING.',
      required: true,
      visibility: 'private_reference',
      itemLabel: 'step',
      idPrefix: 'S',
      itemFields: [
        it('id', 'Step ID', 'Unique step ID.', { required: true }),
        { key: 'action', type: 'pick_list', label: 'Action', help: 'TOOL or REASONING.', required: true, options: o(['TOOL', 'REASONING']) },
        { key: 'tool', type: 'pick_list', label: 'Tool', help: 'For a TOOL step.', options: TOOLS, required: { anyOf: [{ field: 'action', equals: 'TOOL' }] } },
        it('responseId', 'Recorded response', 'The matching recorded call.', { required: { anyOf: [{ field: 'action', equals: 'TOOL' }] } }),
        it('input', 'Input', 'Call input summary.'),
        { key: 'expectedResult', type: 'long_text', label: 'Expected result', help: 'Expected output.', required: true },
        { key: 'why', type: 'long_text', label: 'Why', help: 'Rationale.', required: true },
        { key: 'dependsOn', type: 'multi_select', label: 'Depends on', help: 'Earlier step IDs.', allowCustom: true },
      ],
    },
    {
      key: 'findings',
      path: 'solution.findings',
      type: 'repeated_array',
      label: 'Findings',
      help: 'Supported conclusions citing documents or responses.',
      required: true,
      visibility: 'private_reference',
      itemLabel: 'finding',
      idPrefix: 'F',
      itemFields: [
        it('id', 'Finding ID', 'Stable ID.', { required: true }),
        { key: 'description', type: 'long_text', label: 'Finding', help: 'The conclusion.', required: true },
        { key: 'evidenceRefs', type: 'multi_select', label: 'Evidence', help: 'Document or response IDs.', allowCustom: true, required: true },
        { key: 'severity', type: 'pick_list', label: 'Severity', help: 'LOW, MEDIUM or HIGH.', options: o(KYC_SEVERITY) },
      ],
    },
    lt('rationale', 'solution.rationale', 'Rationale', 'Evidence-grounded explanation.', { required: true, visibility: 'private_reference' }),
    lt('humanHandoff', 'solution.humanHandoff', 'Human hand-off', 'Required for approve, reject or high risk unless the case is escalated.', {
      visibility: 'private_reference',
      required: { anyOf: [{ field: 'S6.disposition', in: ['RECOMMEND_APPROVE', 'RECOMMEND_REJECT'] }, { field: 'S6.riskRating', equals: 'HIGH' }], unless: [{ field: 'S6.disposition', equals: 'ESCALATE' }] },
    }),
  ],
  // S6 (outcome)
  [
    { key: 'disposition', path: 'solution.disposition', type: 'pick_list', label: 'Disposition', help: 'A recommendation or routing decision, not an account action.', required: true, options: o(KYC_DISPOSITIONS), visibility: 'private_reference', outputField: 'disposition' },
    { key: 'riskRating', path: 'solution.riskRating', type: 'pick_list', label: 'Risk rating', help: 'Supported risk classification.', required: true, options: o(KYC_RISK), visibility: 'private_reference', outputField: 'risk_rating' },
    { key: 'riskFactors', path: 'solution.riskFactors', type: 'multi_select', label: 'Risk factors', help: 'Reasons for the rating.', allowCustom: true, visibility: 'private_reference' },
    { key: 'requestsToCustomer', path: 'solution.requestsToCustomer', type: 'multi_select', label: 'Requests to customer', help: 'Expected information requests.', allowCustom: true, visibility: 'private_reference' },
  ],
  // S7 (W05 rubric)
  [
    { key: 'criteria', path: 'rubric.criteria', type: 'criterion', label: 'Criteria', help: 'Observable criteria; weights total 100; at least one critical.', required: true, visibility: 'private_rubric', weightTotal: 100, requireCritical: true, itemLabel: 'criterion', idPrefix: 'C' },
    {
      key: 'commonErrors',
      path: 'rubric.commonErrors',
      type: 'repeated_array',
      label: 'Common errors',
      help: 'Plausible wrong paths, each caught by a criterion.',
      required: true,
      visibility: 'private_rubric',
      itemLabel: 'common error',
      itemFields: [{ key: 'description', type: 'long_text', label: 'Error', help: 'The mistake.', required: true }, it('caughtBy', 'Caught by', 'Criterion ID.', { required: true })],
    },
    { key: 'acceptableVariations', path: 'rubric.acceptableVariations', type: 'multi_select', label: 'Acceptable variations', help: 'Other valid approaches.', allowCustom: true, visibility: 'private_rubric' },
  ],
  // S8 (W06 check and submit): checks only
  [],
];

const help = sectionHelp('kyc-onboarding-and-refresh');

export const KYC_PROFILE: TemplateProfile = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  profileId: 'kyc-onboarding-and-refresh',
  version: 1,
  catalogWorkflowName: 'KYC onboarding and refresh',
  templateId: 'BK14',
  handoverName: 'KYC Onboarding and Refresh',
  agentMode: 'SINGLE',
  storage: 'canonical',
  domainPlugin: 'kyc-workbench',
  exportCapabilities: { formats: ['praxis.anvil.export.v1', 'praxis.anvil.task.v1'], executable: true, blockers: [] },
  contractStatus: 'confirmed',
  titleField: 'title',
  contract: null,
  sections: PROFILE_SECTIONS.map((s, i) => ({ key: s.key, title: s.title, help: help[i], ...(s.key === 'S8' ? { checksOnly: true } : {}), fields: fields[i]! })),
};
