import { field, options, sectionsProfile } from '../common';

/**
 * BK06 Compliance monitoring (templates/compliance-monitoring/task.md). Agent mode SINGLE until the domain owner
 * publishes one. Deliverable: obligation-to-evidence assessment, exceptions, severity, proposed follow-up. Pick lists
 * are the draft's proposed labels: result (S6 outcome and on each obligation) and severity (S6 outcome). The
 * obligations are case evidence (S2); the profile states no obligation or threshold of its own.
 */
const RESULT = options('compliant', 'noncompliant', 'insufficient_evidence', 'not_applicable');

export const COMPLIANCE_MONITORING_PROFILE = sectionsProfile({
  profileId: 'compliance-monitoring',
  templateId: 'BK06',
  catalogWorkflowName: 'Compliance monitoring',
  handoverName: 'Compliance Monitoring',
  slug: 'compliance-monitoring',
  trigger: { help: 'Why the monitoring review is run.', example: 'Scheduled monitoring review for the period' },
  subject: { label: 'Monitored area', help: 'The business area, process or control in the monitoring scope.', example: 'Retail payments operations' },
  evidenceTypes: ['monitoring_scope', 'records', 'obligations', 'monitoring_period', 'other'],
  evidenceExample: 'E1 · obligations · project rule set v1 · 2026-05-01 · the obligations in scope exactly as the approved source states them.',
  deliverables: [
    {
      key: 'obligationAssessments',
      type: 'repeated_array',
      label: 'Obligation-to-evidence assessment',
      help: 'Each obligation in scope, the records that show whether it is met, and the result.',
      required: true,
      itemLabel: 'obligation assessment',
      idPrefix: 'OB',
      example: 'OB1 · the obligation as the source states it · assessment against records E2, E3 · result insufficient_evidence',
      itemFields: [
        field.t('id', 'Obligation ID', 'Stable obligation ID.', { required: true }),
        field.lt('obligation', 'Obligation', 'The obligation, as the approved source states it.', { required: true }),
        field.lt('assessment', 'Assessment', 'What the records show about this obligation in the monitoring period.', { required: true }),
        { key: 'result', type: 'pick_list', label: 'Result', help: 'The template result value for this obligation.', required: true, options: RESULT },
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs the assessment relies on.'),
      ],
    },
    // Owner, 12 Nov: each exception has its own severity; the overall severity (S6) stays the graded output.
    {
      key: 'exceptions',
      type: 'repeated_array',
      label: 'Exceptions',
      help: 'Each exception (control gap) the agent should identify, with its own severity. Leave empty when there are none.',
      itemLabel: 'exception',
      idPrefix: 'EX',
      example: 'EX1 · obligation OB2 not met: three payments released without the second approval · high · evidence E3',
      itemFields: [
        field.t('id', 'Exception ID', 'Stable exception ID.', { required: true }),
        field.lt('description', 'Exception', 'What is wrong, citing the obligation it breaks.', { required: true }),
        { key: 'severity', type: 'pick_list', label: 'Severity', help: 'How severe this exception is.', required: true, options: options('low', 'medium', 'high', 'critical') },
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs that show it.', { required: true }),
      ],
    },
    field.lt('proposedFollowUp', 'Proposed follow-up', 'The follow-up the agent should propose for each exception. A proposal, not a remediation decision.', { required: true }),
  ],
  outcomes: [
    { key: 'result', type: 'pick_list', label: 'Monitoring result', help: 'The overall monitoring result for the scope and period.', required: true, options: RESULT, outputField: 'result' },
    { key: 'severity', type: 'pick_list', label: 'Severity', help: 'The overall severity of the exceptions found (usually the highest, or as you judge and explain). Use undetermined when the evidence cannot settle it.', required: true, options: options('low', 'medium', 'high', 'critical', 'undetermined'), outputField: 'severity' },
  ],
});
