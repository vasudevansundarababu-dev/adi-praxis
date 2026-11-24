import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FamilyPicker } from '@/components/work/benchmark-fields';
import { a11yProblems } from './a11y';

/** E-001 §6b (owner, 24 Nov 2026): "Focus on edge case" by family and variant. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\\s+/g, ' ');
const FAMILIES = {
  source: 'catalog' as const,
  fallbackReason: null,
  items: [
    {
      familyId: 'expired_id',
      name: 'Expired ID',
      description: 'An identity document that is not valid on the application date.',
      archetype: 'missing_doc',
      complexity: 'single_hop',
      variants: [
        { variantId: 'expired_document', tag: 'expired_document', name: 'Expired passport', description: '', boundary: null, state: 'available', hasOutcome: true, needsConfirmation: true },
        { variantId: 'expires_today', tag: 'expires_today', name: 'Expires today', description: '', boundary: 'expires on the application date', state: 'available', hasOutcome: true, needsConfirmation: false },
        { variantId: 'expires_in_30', tag: 'expires_in_30', name: 'Expires within 30 days', description: '', boundary: null, state: 'waiting_outcome', hasOutcome: false, needsConfirmation: true },
      ],
    },
  ],
};

describe('Family picker', () => {
  it('lists families; a chosen family shows its variants, which count, and which wait for an SME outcome', () => {
    const html = renderToStaticMarkup(<FamilyPicker families={FAMILIES} familyId="expired_id" variants="all" editable onFamily={() => undefined} onVariants={() => undefined} />);
    const t = text(html);
    expect(t).toContain('Focus on edge-case family (optional)');
    expect(t).toContain('Expired ID — 3 variants, Missing document or detail');
    expect(t).toContain('Every variant that counts, including ones added later');
    expect(t).toContain('Expires today (boundary: expires on the application date)');
    expect(t).toContain('waiting for an SME outcome, so it can’t count yet');
    expect(t).toContain('outcome carried over, not yet confirmed by a person');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('Raise a new edge-case family', () => {
  it('collects the family and its variants with the SME’s outcomes; the request is the agreed shape', async () => {
    const { NewFamilyForm, newFamilyBody } = await import('@/components/work/benchmark-fields');
    const html = renderToStaticMarkup(<NewFamilyForm sliceLists={{ complexity: ['single_hop'], archetype: ['missing_doc'] }} onSend={async () => null} onCancel={() => undefined} />);
    const t = text(html);
    for (const s of ['Family name', 'Why it matters to the bank', 'Variant 1', 'Boundary, if it is one', 'Expected outcome', 'Doesn’t count as a test', 'Evidence the analyst should cite', 'Add a variant']) expect(t).toContain(s);
    expect(a11yProblems(html)).toEqual([]);
    expect(newFamilyBody({ name: ' Deceased applicant ', whyItMatters: 'Fraud route.', archetype: '', complexity: 'single_hop', variants: [{ name: 'Death record', description: 'A death record matches.', boundary: '', counts: true, decision: 'refer', rationale: 'Possible fraud.', evidence: 'screening.check\n\n ID date of birth ' }, { name: 'Yesterday', description: 'Dated the day before.', boundary: 'one day', counts: false, decision: 'x', rationale: 'Adds nothing.', evidence: '' }] })).toEqual({
      kind: 'new_edge_case_family',
      name: 'Deceased applicant',
      whyItMatters: 'Fraud route.',
      complexity: 'single_hop',
      variants: [
        { name: 'Death record', description: 'A death record matches.', outcome: { counts: true, decision: 'refer', rationale: 'Possible fraud.', evidence: ['screening.check', 'ID date of birth'] } },
        { name: 'Yesterday', description: 'Dated the day before.', boundary: 'one day', outcome: { counts: false, rationale: 'Adds nothing.' } },
      ],
    });
  });
});

describe('Propose a new variant of a family (owner, 24 Nov 2026)', () => {
  it('picks the family, writes meaning, twist and boundary, and the expected outcome with the environment’s pick lists', async () => {
    const { NewVariantForm, newVariantBody } = await import('@/components/work/benchmark-fields');
    const fields = [{ name: 'recommendation', label: 'Recommendation', help: '', required: true, allowedValues: ['ready_for_approval', 'request_information'] }, { name: 'request_type', label: 'Request type', help: '', required: false, allowedValues: ['tin', 'none'] }, { name: 'reason_keyword', label: 'Reason keyword', help: '', required: false, allowedValues: null, suggestedValues: ['TIN'] }];
    const html = renderToStaticMarkup(<NewVariantForm families={FAMILIES.items} fields={fields} onSend={async () => null} onCancel={() => undefined} />);
    const t = text(html);
    for (const s of ['Family', 'Already in this family: Expired passport, Expires today, Expires within 30 days.', 'What it means', 'The twist', 'It is a boundary case', 'Expected outcome', 'Recommendation', 'Request type (optional)', 'Send for PM/Admin review']) expect(t).toContain(s);
    expect(a11yProblems(html)).toEqual([]);
    expect(newVariantBody({ familyId: 'expired_id', name: ' Expires tomorrow ', meaning: 'Valid on the day.', twist: 'One day left.', isBoundary: true, boundary: ' expires the day after ', decision: 'ready_for_approval', fields: { recommendation: 'x', request_type: 'none', reason_keyword: '' }, rationale: 'Valid on the application date.', evidence: 'expiry date\n' }, fields)).toEqual({
      kind: 'new_edge_case_variant', familyId: 'expired_id', name: 'Expires tomorrow', meaning: 'Valid on the day.', twist: 'One day left.', boundary: 'expires the day after',
      outcome: { decision: 'ready_for_approval', fields: { request_type: 'none' }, rationale: 'Valid on the application date.', evidence: ['expiry date'] },
    });
  });
});
