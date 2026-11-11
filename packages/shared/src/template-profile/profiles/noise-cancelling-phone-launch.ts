import { field, options, sectionsProfile } from '../common';

/**
 * DM03. The catalogue calls this workflow "Launch of Noise Cancelling Phone"; the handover template is
 * "Noise Cancelling Headphones Launch" (templates/noise-cancelling-headphones-launch/task.md). Matched by catalogue
 * name; nothing is renamed.
 */
export const NOISE_CANCELLING_PROFILE = sectionsProfile({
  profileId: 'noise-cancelling-phone-launch',
  templateId: 'DM03',
  catalogWorkflowName: 'Launch of Noise Cancelling Phone',
  handoverName: 'Noise Cancelling Headphones Launch',
  slug: 'noise-cancelling-headphones-launch',
  trigger: { help: 'Why the launch plan is needed.', example: 'Quarterly launch window approved' },
  subject: { label: 'Product', help: 'The product being launched.', example: 'Consumer audio device' },
  evidenceTypes: ['product_brief', 'test_evidence', 'audience', 'channel_requirements', 'budget', 'launch_dates', 'other'],
  evidenceExample: 'E1 · product_brief · product team · 2026-05-01 · features, target audience, launch window and constraints (synthetic).',
  deliverables: [
    field.lt('launchPlan', 'Launch plan', 'The plan the agent must produce, by phase.', { required: true }),
    {
      key: 'channelAssets',
      type: 'repeated_array',
      label: 'Channel assets',
      help: 'The assets each channel needs.',
      itemLabel: 'channel asset',
      idPrefix: 'A',
      itemFields: [field.t('id', 'Asset ID', 'Stable asset ID.', { required: true }), field.t('channel', 'Channel', 'Where it runs.', { required: true }), field.lt('description', 'Description', 'What the asset is.', { required: true })],
    },
    {
      key: 'claims',
      type: 'repeated_array',
      label: 'Substantiated claims',
      help: 'Each product claim, its status and the supporting test evidence.',
      required: true,
      itemLabel: 'claim',
      itemFields: [
        field.lt('claim', 'Claim', 'The claim.', { required: true }),
        { key: 'status', type: 'pick_list', label: 'Claim status', help: 'The template claim status.', required: true, options: options('supported', 'unsupported', 'needs_review') },
        field.refs('evidenceRefs', 'Evidence', 'Supporting evidence IDs.'),
      ],
    },
    {
      key: 'budgetAllocation',
      type: 'repeated_array',
      label: 'Budget allocation',
      help: 'Allocation by channel; reconcile it with the supplied budget.',
      itemLabel: 'allocation',
      itemFields: [field.t('channel', 'Channel', 'The channel.', { required: true }), { key: 'amount', type: 'number', label: 'Amount', help: 'Allocated amount.', min: 0, required: true }],
    },
    field.lt('measurementPlan', 'Measurement plan', 'Success measures and how they are tracked.', { required: true }),
  ],
  outcomes: [
    { key: 'release', type: 'pick_list', label: 'Release recommendation', help: 'The recommended release status.', required: true, options: options('ready_for_review', 'revise', 'hold'), outputField: 'release' },
  ],
});
