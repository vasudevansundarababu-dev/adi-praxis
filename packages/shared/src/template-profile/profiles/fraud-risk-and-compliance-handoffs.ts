import { field, options, sectionsProfile } from '../common';

/**
 * BK11 Fraud-risk and compliance handoffs (templates/fraud-risk-and-compliance-handoffs/task.md). The catalogue name
 * is "Fraud-risk/compliance handoffs"; matched by catalogue name. Agent mode SINGLE until the domain owner publishes
 * one. Deliverable: facts, fraud indicators, compliance concerns, handoff package, recommendation and rationale. Pick
 * lists are the draft's proposed labels (handoff, recommendation).
 */
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
    field.lt('fraudIndicators', 'Fraud indicators', 'The fraud indicators the evidence supports, citing evidence IDs.', { required: true }),
    field.lt('complianceConcerns', 'Compliance concerns', 'The compliance concerns the case raises, citing evidence IDs and the applicable rule.', { required: true }),
    field.lt('handoffPackage', 'Handoff package', 'What the handoff to the receiving team must contain, and who receives it under the escalation policy.', { required: true }),
  ],
  outcomes: [
    { key: 'handoff', type: 'pick_list', label: 'Handoff route', help: 'Which team the case is handed to. A routing recommendation, not a case decision.', required: true, options: options('fraud', 'compliance', 'joint_review'), outputField: 'handoff' },
    { key: 'recommendation', type: 'pick_list', label: 'Recommendation', help: 'The recommended next action.', required: true, options: options('request_information', 'escalate', 'close_with_rationale'), outputField: 'recommendation' },
  ],
});
