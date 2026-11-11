import { field, options, sectionsProfile } from '../common';

/**
 * BK03 Adverse media review (templates/adverse-media-review/task.md). Agent mode SINGLE until the domain owner
 * publishes one. Deliverable: identity match, source reliability, allegations versus established facts, relevance,
 * recommendation. Pick lists are the draft's proposed labels (match, recommendation), confirmed by the owner on 12 Nov;
 * per-source reliability is a fixed list (owner, 12 Nov).
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
    // Owner, 12 Nov: each source is rated from a fixed list, with a reason.
    {
      key: 'sourceReliability',
      type: 'repeated_array',
      label: 'Source reliability',
      help: 'Each media source, how reliable it is and why.',
      required: true,
      itemLabel: 'media source',
      idPrefix: 'MS',
      example: 'MS1 · the named publication · medium · established outlet, but the article relies on one unnamed source · evidence E2',
      itemFields: [
        field.t('id', 'Source ID', 'Stable source ID.', { required: true }),
        field.t('source', 'Media source', 'The publication or source, as named in the extract.', { required: true }),
        { key: 'reliability', type: 'pick_list', label: 'Reliability', help: 'How reliable the source is.', required: true, options: options('high', 'medium', 'low', 'unknown') },
        field.lt('reason', 'Reason', 'Why the source has this reliability.', { required: true }),
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs of the extracts from this source.'),
      ],
    },
    field.lt('allegationsVsFacts', 'Allegations versus established facts', 'Which statements are allegations and which are established facts, citing the extracts.', { required: true }),
    field.lt('relevance', 'Relevance', 'Whether and why the media is relevant to the customer relationship.', { required: true }),
  ],
  outcomes: [
    { key: 'match', type: 'pick_list', label: 'Identity match', help: 'Whether the media is about this customer.', required: true, options: options('confirmed', 'possible', 'false_positive', 'unresolved'), outputField: 'match' },
    { key: 'recommendation', type: 'pick_list', label: 'Recommendation', help: 'The recommended next action. A recommendation, not a relationship decision.', required: true, options: options('close', 'escalate', 'request_information'), outputField: 'recommendation' },
  ],
});
