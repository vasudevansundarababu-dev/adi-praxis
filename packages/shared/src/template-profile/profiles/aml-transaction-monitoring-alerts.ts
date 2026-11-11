import { field, options, sectionsProfile } from '../common';

/** BK15 AML transaction-monitoring alerts (templates/aml-transaction-monitoring-alerts/task.md). Agent mode SINGLE. */
export const AML_PROFILE = sectionsProfile({
  profileId: 'aml-transaction-monitoring-alerts',
  templateId: 'BK15',
  catalogWorkflowName: 'AML transaction-monitoring alerts',
  handoverName: 'AML Transaction-Monitoring Alerts',
  slug: 'aml-transaction-monitoring-alerts',
  trigger: { help: 'The alert or scenario that started the review.', example: 'Monitoring scenario alert generated on the as-of date' },
  subject: { label: 'Customer type', help: 'The category of customer the alert concerns.', example: 'Retail customer' },
  evidenceTypes: ['alert', 'transactions', 'customer_profile', 'scenario_parameters', 'historical_context', 'other'],
  evidenceExample: 'E1 · alert · monitoring system · 2026-05-01 · scenario name, threshold and the transactions that triggered it (synthetic).',
  deliverables: [
    field.lt('transactionAnalysis', 'Transaction analysis', 'What the agent must find in the transactions.', { required: true }),
    field.lt('expectedVsObserved', 'Expected versus observed activity', 'How observed activity compares with the profile and history.', { required: true }),
    field.lt('gaps', 'Gaps', 'Information the agent cannot establish from the case.'),
    field.lt('escalationRationale', 'Escalation rationale', 'Why the alert is or is not escalated.', { required: true }),
  ],
  outcomes: [
    { key: 'disposition', type: 'pick_list', label: 'Alert disposition', help: 'The recommended alert disposition.', required: true, options: options('close_with_rationale', 'request_information', 'escalate_for_investigation'), outputField: 'disposition' },
    { key: 'suspicion', type: 'pick_list', label: 'Suspicion', help: 'Whether suspicion is established. Not a filing decision.', required: true, options: options('not_established', 'potential', 'unresolved'), outputField: 'suspicion' },
  ],
});
