import { field, options, sectionsProfile } from '../common';

/**
 * DM02 Omnichannel creative and locale compliance (templates/omnichannel-creative-and-locale-compliance/task.md).
 * The catalogue writes "&" where the handover writes "and"; matched by catalogue name.
 */
export const OMNICHANNEL_PROFILE = sectionsProfile({
  profileId: 'omnichannel-creative-and-locale-compliance',
  templateId: 'DM02',
  catalogWorkflowName: 'Omnichannel Creative & Locale Compliance',
  handoverName: 'Omnichannel Creative and Locale Compliance',
  slug: 'omnichannel-creative-and-locale-compliance',
  trigger: { help: 'Why the creative needs a compliance review.', example: 'Creative set submitted for release in new locales' },
  subject: { label: 'Brand or product', help: 'What the creative promotes.', example: 'Consumer audio product' },
  evidenceTypes: ['creative_asset', 'claim_substantiation', 'channel_specification', 'locale_requirement', 'other'],
  evidenceExample: 'E1 · creative_asset · brand team · 2026-05-01 · asset ID, channel, locale, the exact copy and any claims it makes.',
  findingFields: [
    field.t('assetId', 'Asset', 'The asset (evidence ID) this finding is about.', { required: true }),
    field.t('locale', 'Locale', 'The locale assessed.', { required: true }),
    { key: 'status', type: 'pick_list', label: 'Finding', help: 'The template finding value.', required: true, options: options('compliant', 'noncompliant', 'insufficient_evidence', 'not_applicable') },
  ],
  deliverables: [
    {
      key: 'claimEvidence',
      type: 'repeated_array',
      label: 'Claim evidence',
      help: 'Each product claim and the evidence that substantiates it, or that it lacks.',
      required: true,
      itemLabel: 'claim',
      itemFields: [field.lt('claim', 'Claim', 'The claim as it appears.', { required: true }), field.refs('evidenceRefs', 'Evidence', 'Substantiation evidence IDs.')],
    },
    field.lt('proposedCorrections', 'Proposed corrections', 'The corrections the agent should propose.', { required: true }),
  ],
  outcomes: [
    { key: 'recommendation', type: 'pick_list', label: 'Release recommendation', help: 'The recommended release status.', required: true, options: options('ready_for_review', 'revise', 'hold'), outputField: 'recommendation' },
  ],
});
