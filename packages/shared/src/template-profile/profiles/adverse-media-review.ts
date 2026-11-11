import { field, options, sectionsProfile } from '../common';

/**
 * BK03 Adverse media review (templates/adverse-media-review/task.md). Agent mode SINGLE until the domain owner
 * publishes one. Deliverable: identity match, source reliability, allegations versus established facts, relevance,
 * recommendation. Pick lists are the draft's proposed labels (match, recommendation).
 */
export const ADVERSE_MEDIA_PROFILE = sectionsProfile({
  profileId: 'adverse-media-review',
  templateId: 'BK03',
  catalogWorkflowName: 'Adverse media review',
  handoverName: 'Adverse Media Review',
  slug: 'adverse-media-review',
  trigger: { help: 'Why the adverse-media review is needed.', example: 'Media screening returned a possible match' },
  subject: { label: 'Customer type', help: 'The category of customer the media concerns.', example: 'Individual customer' },
  evidenceTypes: ['customer_identifiers', 'media_extract', 'source_metadata', 'other'],
  evidenceExample: 'E1 · media_extract · named publication · 2026-05-01 · the supplied extract as published, with its headline and date (authorised test data).',
  deliverables: [
    field.lt('identityMatch', 'Identity match', 'How the agent must decide whether the media is about this customer, and from which identifiers.', { required: true }),
    field.lt('sourceReliability', 'Source reliability', 'How reliable each media source is, and why.', { required: true }),
    field.lt('allegationsVsFacts', 'Allegations versus established facts', 'Which statements are allegations and which are established facts, citing the extracts.', { required: true }),
    field.lt('relevance', 'Relevance', 'Whether and why the media is relevant to the customer relationship.', { required: true }),
  ],
  outcomes: [
    { key: 'match', type: 'pick_list', label: 'Identity match', help: 'Whether the media is about this customer.', required: true, options: options('confirmed', 'possible', 'false_positive', 'unresolved'), outputField: 'match' },
    { key: 'recommendation', type: 'pick_list', label: 'Recommendation', help: 'The recommended next action. A recommendation, not a relationship decision.', required: true, options: options('close', 'escalate', 'request_information'), outputField: 'recommendation' },
  ],
});
