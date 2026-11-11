import { field, options, sectionsProfile } from '../common';

/**
 * BK09 Customer risk rating (templates/customer-risk-rating/task.md). Agent mode SINGLE until the domain owner
 * publishes one. Deliverable: factor assessments, calculation where supported, proposed risk, overrides, rationale.
 * Pick lists are the draft's proposed labels (risk, override). The rating methodology is case evidence (S2); the
 * profile states no factor, weight or threshold of its own.
 */
export const CUSTOMER_RISK_RATING_PROFILE = sectionsProfile({
  profileId: 'customer-risk-rating',
  templateId: 'BK09',
  catalogWorkflowName: 'Customer risk rating',
  handoverName: 'Customer Risk Rating',
  slug: 'customer-risk-rating',
  trigger: { help: 'Why the customer is being rated or re-rated.', example: 'Customer risk rating due at onboarding' },
  subject: { label: 'Customer type', help: 'The category of customer being rated.', example: 'Individual customer' },
  evidenceTypes: ['customer_profile', 'risk_factor', 'supporting_evidence', 'rating_methodology', 'other'],
  evidenceExample: 'E1 · rating_methodology · project methodology v1 · 2026-05-01 · the factors and bands exactly as the versioned methodology states them.',
  deliverables: [
    {
      key: 'factorAssessments',
      type: 'repeated_array',
      label: 'Factor assessments',
      help: 'Each risk factor the methodology names, how it applies to this customer and the evidence for it.',
      required: true,
      itemLabel: 'factor assessment',
      idPrefix: 'RF',
      example: 'RF1 · the factor as the methodology names it · high · assessment for this customer · evidence E2',
      itemFields: [
        field.t('id', 'Factor ID', 'Stable factor ID.', { required: true }),
        field.t('factor', 'Risk factor', 'The factor, as the methodology names it.', { required: true }),
        // Owner, 12 Nov: each factor is rated; no weights or formula (the methodology document decides the overall rating).
        { key: 'rating', type: 'pick_list', label: 'Factor rating', help: 'The risk this factor indicates for this customer.', required: true, options: options('low', 'medium', 'high') },
        field.lt('assessment', 'Assessment', 'How the factor applies to this customer.', { required: true }),
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs that support the assessment.'),
      ],
    },
    field.lt('calculation', 'Calculation', 'The rating calculation, where the methodology supports one. Write "not supported" when it does not.'),
    field.lt('overrideRationale', 'Override rationale', 'Why the proposed rating differs from the calculated one.', { required: { anyOf: [{ field: 'S6.override', in: ['proposed_increase', 'proposed_decrease'] }] } }),
  ],
  outcomes: [
    { key: 'risk', type: 'pick_list', label: 'Proposed risk', help: 'The proposed customer risk rating. A proposal, not a final rating.', required: true, options: options('low', 'medium', 'high', 'undetermined'), outputField: 'risk' },
    { key: 'override', type: 'pick_list', label: 'Override', help: 'Whether an override of the calculated rating is proposed.', required: true, options: options('none', 'proposed_increase', 'proposed_decrease'), outputField: 'override' },
  ],
});
