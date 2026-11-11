import { field, options, sectionsProfile } from '../common';

/**
 * DM01 Q4 global paid search query clustering (templates/q4-global-paid-search-query-clustering/task.md). A Digital
 * Marketing workflow. Agent mode SINGLE until the domain owner publishes one. Deliverable: clusters, query
 * assignments, intent labels, exclusions, ambiguous queries, rationale. The draft's pick lists (intent, assignment) are
 * per-query labels, so they sit on each query assignment (S5) and, as typed S6 output fields, on the one query the
 * case turns on. How a per-query list maps to output.json requires confirmation (TEMPLATE-PROFILES.md).
 */
const INTENT = options('informational', 'commercial', 'transactional', 'navigational', 'unclear');
const ASSIGNMENT = options('assigned', 'excluded', 'needs_review');

export const Q4_PAID_SEARCH_PROFILE = sectionsProfile({
  profileId: 'q4-global-paid-search-query-clustering',
  templateId: 'DM01',
  catalogWorkflowName: 'Q4 Global Paid Search Query Clustering',
  handoverName: 'Q4 Global Paid Search Query Clustering',
  slug: 'q4-global-paid-search-query-clustering',
  trigger: { help: 'Why the search queries need clustering.', example: 'Quarterly search query report ready for clustering' },
  subject: { label: 'Product or brand', help: 'What the paid search queries are about.', example: 'Consumer audio product line' },
  evidenceTypes: ['query_dataset', 'product_brief', 'locale_constraint', 'channel_constraint', 'other'],
  evidenceExample: 'E1 · query_dataset · search platform export · 2026-05-01 · the query text, locale and the columns supplied with it (authorised test data).',
  deliverables: [
    {
      key: 'clusters',
      type: 'repeated_array',
      label: 'Clusters',
      help: 'Each cluster the agent should form, named and defined as the brief requires.',
      required: true,
      itemLabel: 'cluster',
      idPrefix: 'CL',
      example: 'CL1 · the cluster name the brief’s naming rule gives · what belongs in it · evidence E1, E2',
      itemFields: [
        field.t('id', 'Cluster ID', 'Stable cluster ID.', { required: true }),
        field.t('name', 'Cluster name', 'The name, following the brief’s naming rules.', { required: true }),
        field.lt('definition', 'Definition', 'What belongs in this cluster and what does not.', { required: true }),
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs that support the cluster.'),
      ],
    },
    {
      key: 'queryAssignments',
      type: 'repeated_array',
      label: 'Query assignments',
      help: 'Each query, its cluster, its intent label and whether it is assigned, excluded or needs review. Label every query once.',
      required: true,
      itemLabel: 'query assignment',
      example: 'the query as it appears in E1 · cluster CL1 · intent commercial · assigned',
      itemFields: [
        field.t('query', 'Query', 'The query exactly as it appears in the dataset.', { required: true }),
        field.t('clusterId', 'Cluster', 'The cluster ID, when the query is assigned.'),
        { key: 'intent', type: 'pick_list', label: 'Intent', help: 'The template intent label.', required: true, options: INTENT },
        { key: 'assignment', type: 'pick_list', label: 'Assignment', help: 'The template assignment status.', required: true, options: ASSIGNMENT },
        field.refs('evidenceRefs', 'Evidence', 'Evidence IDs behind the label.'),
      ],
    },
    field.lt('exclusions', 'Exclusions', 'Which queries the agent should exclude and the brief, locale or channel rule behind each. Write "none" when there are none.', { required: true }),
    field.lt('ambiguousQueries', 'Ambiguous queries', 'Queries whose intent or cluster cannot be settled from the inputs, and why. Write "none" when there are none.', { required: true }),
  ],
  outcomes: [
    { key: 'intent', type: 'pick_list', label: 'Intent (focus query)', help: 'The intent label of the query this case turns on. Per-query labels go in Query assignments.', required: true, options: INTENT, outputField: 'intent' },
    { key: 'assignment', type: 'pick_list', label: 'Assignment (focus query)', help: 'Whether the query this case turns on is assigned, excluded or needs review.', required: true, options: ASSIGNMENT, outputField: 'assignment' },
  ],
});
