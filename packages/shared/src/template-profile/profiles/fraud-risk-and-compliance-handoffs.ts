import { field, options, sectionsProfile } from '../common';

/**
 * BK11 Fraud-risk and compliance handoffs (templates/fraud-risk-and-compliance-handoffs/task.md). The catalogue name
 * is "Fraud-risk/compliance handoffs"; matched by catalogue name. Agent mode SINGLE until the domain owner publishes
 * one. Deliverable: facts, fraud indicators, compliance concerns, handoff package, recommendation and rationale. Pick
 * lists are the draft's proposed labels (handoff, recommendation).
 */
/** Owner-approved lists (12 Nov 2026). */
export const FRAUD_INDICATORS = options('account_takeover', 'money_mule', 'synthetic_identity', 'first_party_fraud', 'authorised_push_payment_scam', 'card_fraud', 'insider_fraud', 'other');
export const COMPLIANCE_CONCERNS = options('suspicious_activity_report', 'sanctions', 'customer_due_diligence', 'data_protection', 'conduct_risk', 'other');

export const FRAUD_HANDOFF_PROFILE = sectionsProfile({
  profileId: 'fraud-risk-and-compliance-handoffs',
  templateId: 'BK11',
  catalogWorkflowName: 'Fraud-risk/compliance handoffs',
  handoverName: 'Fraud-Risk and Compliance Handoffs',
  slug: 'fraud-risk-and-compliance-handoffs',
  trigger: { help: 'The fraud alert or event that started the case.', example: 'Fraud alert raised on the as-of date' },
  subject: { label: 'Customer type', help: 'The category of customer the case concerns.', example: 'Retail customer' },
  evidenceTypes: ['fraud_alert', 'transaction_records', 'case_timeline', 'roles', 'escalation_policy', 'other'],
  evidenceExample: 'E1 · fraud_alert · fraud monitoring system · 2026-05-01 · the alert reason and the transactions it names (authorised test data).',
  deliverables: [
    field.lt('facts', 'Established facts', 'The facts the agent should establish from the records and timeline, kept apart from suspicions.', { required: true }),
    // Owner, 12 Nov: indicators and concerns come from fixed lists; "other" is described like every entry.
    {
      key: 'fraudIndicators',
      type: 'repeated_array',
      label: 'Fraud indicators',
      help: 'Each fraud indicator the evidence supports. Describe what in the evidence shows it; for "other", say what the indicator is.',
      required: true,
      itemLabel: 'fraud indicator',
      idPrefix: 'FI',
      example: 'FI1 · money_mule · funds arrive from several unrelated payers and leave the same day · evidence E2, E3',
      itemFields: [
        field.t('id', 'Indicator ID', 'Stable indicator ID.', { required: true }),
        { key: 'indicator', type: 'pick_list', label: 'Indicator', help: 'The type of fraud the evidence points to.', required: true, options: FRAUD_INDICATORS },
        field.lt('description', 'What the evidence shows', 'The specific facts behind this indicator.', { required: true }),
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs that support it.', { required: true }),
      ],
    },
    {
      key: 'complianceConcerns',
      type: 'repeated_array',
      label: 'Compliance concerns',
      help: 'Each compliance concern the case raises, with the applicable rule. For "other", say what the concern is.',
      required: true,
      itemLabel: 'compliance concern',
      idPrefix: 'CC',
      example: 'CC1 · suspicious_activity_report · the pattern meets the escalation policy threshold for a report · evidence E4',
      itemFields: [
        field.t('id', 'Concern ID', 'Stable concern ID.', { required: true }),
        { key: 'concern', type: 'pick_list', label: 'Concern', help: 'The type of compliance concern.', required: true, options: COMPLIANCE_CONCERNS },
        field.lt('description', 'Why it is a concern', 'The facts and the applicable rule.', { required: true }),
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs that support it.', { required: true }),
      ],
    },
    field.lt('handoffPackage', 'Handoff package', 'What the handoff to the receiving team must contain, and who receives it under the escalation policy.', { required: true }),
  ],
  outcomes: [
    { key: 'handoff', type: 'pick_list', label: 'Handoff route', help: 'Which team the case is handed to. A routing recommendation, not a case decision.', required: true, options: options('fraud', 'compliance', 'joint_review'), outputField: 'handoff' },
    { key: 'recommendation', type: 'pick_list', label: 'Recommendation', help: 'The recommended next action.', required: true, options: options('request_information', 'escalate', 'close_with_rationale'), outputField: 'recommendation' },
  ],
  // The handoff package is this template's hand-off; the common business hand-off is not shown (owner, 12 Nov).
  handoffHidden: true,
});
