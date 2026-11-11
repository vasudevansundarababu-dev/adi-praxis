import { field, options, sectionsProfile } from '../common';

/** BK13 KYB and beneficial ownership (templates/kyb-and-beneficial-ownership/task.md). Agent mode SINGLE for now. */
export const KYB_PROFILE = sectionsProfile({
  profileId: 'kyb-and-beneficial-ownership',
  templateId: 'BK13',
  catalogWorkflowName: 'KYB and beneficial ownership',
  handoverName: 'KYB and Beneficial Ownership',
  slug: 'kyb-and-beneficial-ownership',
  trigger: { help: 'Why the business-customer review is needed.', example: 'New business account application' },
  subject: { label: 'Entity type', help: 'The legal form of the business under review.', example: 'Private limited company' },
  evidenceTypes: ['entity_record', 'ownership_record', 'control_evidence', 'policy_extract', 'other'],
  evidenceExample: 'E1 · entity_record · company registry · 2026-05-01 · name, registered number (synthetic), incorporation date, registered address.',
  extraEvidence: [
    {
      key: 'parties',
      type: 'repeated_array',
      label: 'Parties',
      help: 'Every legal entity and person in the ownership and control structure.',
      itemLabel: 'party',
      idPrefix: 'P',
      required: true,
      example: 'P1 · the legal entity under review · legal_entity',
      itemFields: [
        field.t('id', 'Party ID', 'Stable party ID.', { required: true }),
        field.t('name', 'Name', 'Authorised test identity only.', { required: true }),
        { key: 'role', type: 'pick_list', label: 'Role', help: 'The party role from the template pick list.', required: true, options: options('legal_entity', 'shareholder', 'beneficial_owner', 'controller', 'authorised_signatory', 'trustee', 'settlor', 'beneficiary', 'other') },
      ],
    },
    {
      key: 'ownership',
      type: 'repeated_array',
      label: 'Ownership links',
      help: 'Who owns what, with the supported percentage. Do not infer unsupported control.',
      itemLabel: 'ownership link',
      example: 'P2 owns 60% of P1, supported by E2',
      itemFields: [
        field.t('ownerId', 'Owner party ID', 'The owning party.', { required: true }),
        field.t('ownedId', 'Owned party ID', 'The owned party.', { required: true }),
        { key: 'percent', type: 'number', label: 'Percent', help: 'Supported ownership percentage.', min: 0, max: 100, required: true },
        field.t('evidenceRef', 'Evidence ID', 'The record that supports this link.'),
      ],
    },
  ],
  deliverables: [
    field.lt('entityVerification', 'Entity verification', 'What the agent must establish about the entity and from which records.', { required: true }),
    field.lt('ownershipTraversal', 'Ownership traversal', 'The ownership chain the agent must trace, layer by layer.', { required: true }),
    {
      key: 'beneficialOwners',
      type: 'repeated_array',
      label: 'Beneficial owners and controllers',
      help: 'Each person who owns or controls the entity, with the basis.',
      required: true,
      itemLabel: 'beneficial owner',
      example: 'P4 · indirect holding through P2 · evidence E2',
      itemFields: [field.t('partyId', 'Party ID', 'The person.', { required: true }), field.lt('basis', 'Basis', 'Ownership percentage or control, and the evidence.', { required: true })],
    },
    field.lt('gaps', 'Gaps', 'Missing ownership or control evidence the agent should identify.'),
  ],
  outcomes: [
    { key: 'disposition', type: 'pick_list', label: 'Disposition', help: 'The recommended next action. A recommendation, not an account decision.', required: true, options: options('complete_for_review', 'request_information', 'escalate'), outputField: 'disposition' },
  ],
});
