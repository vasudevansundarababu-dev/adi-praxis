import { field, options, sectionsProfile } from '../common';

/**
 * BK10 Enhanced due diligence (templates/enhanced-due-diligence/task.md). Agent mode SINGLE until the domain owner
 * publishes one. Deliverable: enhanced checks, evidence gaps, risk assessment, recommendation, human hand-off (so the
 * S5 business hand-off is required). Pick lists are the draft's proposed labels: recommendation (S6 outcome) and
 * evidence status (on each finding).
 */
export const EDD_PROFILE = sectionsProfile({
  profileId: 'enhanced-due-diligence',
  templateId: 'BK10',
  catalogWorkflowName: 'Enhanced due diligence',
  handoverName: 'Enhanced Due Diligence',
  slug: 'enhanced-due-diligence',
  trigger: { help: 'Why the relationship needs enhanced due diligence.', example: 'High-risk case referred for enhanced due diligence' },
  subject: { label: 'Customer type', help: 'The category of customer under review.', example: 'Individual customer' },
  evidenceTypes: ['high_risk_case', 'source_of_funds', 'source_of_wealth', 'ownership_record', 'adverse_finding', 'other'],
  evidenceExample: 'E1 · source_of_funds · customer submission · 2026-05-01 · the stated origin of the funds and the supporting record supplied (authorised test data).',
  findingFields: [{ key: 'evidenceStatus', type: 'pick_list', label: 'Evidence status', help: 'The status of the evidence behind this finding.', required: true, options: options('verified', 'unverified', 'conflicting', 'missing') }],
  deliverables: [
    field.lt('enhancedChecks', 'Enhanced checks', 'The enhanced checks the agent must carry out, and on which evidence.', { required: true }),
    field.lt('evidenceGaps', 'Evidence gaps', 'Missing, unverified or conflicting evidence the agent should identify.', { required: true }),
    field.lt('riskAssessment', 'Risk assessment', 'How the agent should assess the risk of the relationship from the checks.', { required: true }),
  ],
  outcomes: [
    {
      key: 'recommendation',
      type: 'pick_list',
      label: 'Recommendation',
      help: 'The recommended next action. An authorised person makes the decision.',
      required: true,
      options: options('proceed_for_approval', 'request_information', 'escalate', 'recommend_decline'),
      outputField: 'recommendation',
    },
  ],
  handoffRequired: true,
});
