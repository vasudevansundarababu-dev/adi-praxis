import { describe, expect, it } from 'vitest';
import { NewFamilyNeed, VariantOutcome } from '../src/benchmark';
import { familiesOf, familyOfTag, focusTags, narrowForRun, outcomeFieldsOf } from '../src/edge-families';

/** E-001 §6b (owner, 24 Nov 2026): edge-case families and variants. */
const CATALOG = {
  schema: 'edge-case-catalog.v2',
  outcome_fields: [{ name: 'recommendation', label: 'Recommendation', help: 'What the analyst should do', required: true, allowed_values: ['approve', 'refer'] }, { name: 'reason_keyword', label: 'Reason keyword', help: '', required: false, suggested_values: ['TIN', 'expired'] }],
  families: [
    { family_id: 'minor_tin', name: "Minor's TIN", variants: [
      { variant_id: 'minor_without_tin', tag: 'minor_without_tin', name: 'Without TIN', state: 'available', outcome: { decision: 'request_information', written_by: 'migration' } },
      { variant_id: 'tin_applied', tag: 'tin_applied', name: 'Has applied for a TIN', state: 'available', outcome: { decision: 'approve', written_by: 'admin-0a1b2c3d' } },
      { variant_id: 'tin_invalid', tag: 'tin_invalid', name: 'TIN invalid', state: 'waiting_outcome', outcome: null },
      { variant_id: 'tin_short', tag: 'tin_short', name: 'TIN one digit short', state: 'needs_environment_change', outcome: { decision: 'request_information', written_by: 'sme-0a1b2c3d' } },
      { variant_id: 'tin_spaces', tag: 'tin_spaces', name: 'TIN with spaces', state: 'needs_recipe', outcome: { decision: 'request_information', written_by: 'sme-0a1b2c3d' } },
      { variant_id: 'fx_kyc_03_positive', tag: 'fx_kyc_03_positive', name: 'Fixture 3 positive', kind: 'fixture', state: 'waiting_outcome', outcome: null, proposed_outcome: { recommendation: 'request_information', request_type: 'tin' } },
      { variant_id: 'bad id!', tag: 'x', state: 'available' },
    ] },
  ],
};

describe('families', () => {
  it('reads Studio’s catalog; a migrated outcome still needs a person to confirm it', () => {
    const [f] = familiesOf(CATALOG, []);
    expect(f!.variants.map((v) => [v.tag, v.state, v.hasOutcome, v.needsConfirmation])).toEqual([['minor_without_tin', 'available', true, true], ['tin_applied', 'available', true, false], ['tin_invalid', 'waiting_outcome', false, true], ['tin_short', 'needs_environment_change', true, false], ['tin_spaces', 'needs_recipe', true, false], ['fx_kyc_03_positive', 'waiting_outcome', false, true]]);
    const fx = f!.variants.at(-1)!;
    expect(fx).toMatchObject({ kind: 'fixture', proposedOutcome: { decision: 'request_information', fields: { request_type: 'tin' } } });
    expect(outcomeFieldsOf(CATALOG)).toEqual([{ name: 'recommendation', label: 'Recommendation', help: 'What the analyst should do', required: true, allowedValues: ['approve', 'refer'], suggestedValues: [] }, { name: 'reason_keyword', label: 'Reason keyword', help: '', required: false, allowedValues: null, suggestedValues: ['TIN', 'expired'] }]);
  });

  it('falls back to one family per S4 edge case', () => {
    const fams = familiesOf(null, [{ tag: 'passport_only', name: 'Passport only', archetype: 'missing_doc' }]);
    expect(fams).toEqual([expect.objectContaining({ familyId: 'passport_only', source: 'template', variants: [expect.objectContaining({ tag: 'passport_only', hasOutcome: true })] })]);
    expect(familyOfTag(fams, 'passport_only')?.familyId).toBe('passport_only');
    expect(familyOfTag(fams, null)).toBeNull();
  });

  it('a focus takes every variant that counts (later ones too), or the chosen ones; never one without an outcome', () => {
    const fams = familiesOf(CATALOG, []);
    // A fixture never counts for a task, even once its outcome is confirmed.
    expect(focusTags({ familyId: 'minor_tin', variants: 'all' }, fams)).toEqual({ tags: ['minor_without_tin', 'tin_applied'], problems: [] });
    expect(focusTags({ familyId: 'minor_tin', variants: ['tin_applied'] }, fams).tags).toEqual(['tin_applied']);
    expect(focusTags({ familyId: 'minor_tin', variants: ['tin_invalid'] }, fams).problems[0]).toMatch(/No variant/);
    expect(focusTags({ familyId: 'nope', variants: 'all' }, fams).problems[0]).toMatch(/not in this template/);
    expect(narrowForRun(['a', 'b'], ['b', 'c'])).toEqual(['b']);
    expect(narrowForRun(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('an outcome is a decision, a rationale and the evidence, or "does not count" with a reason; a new family carries its variants’ outcomes', () => {
    expect(VariantOutcome.safeParse({ counts: true, decision: 'refer', rationale: 'Cannot rule the match out.', evidence: ['screening.check result'] }).success).toBe(true);
    expect(VariantOutcome.safeParse({ counts: true, decision: 'refer', rationale: 'Too short' }).success).toBe(false);
    expect(VariantOutcome.safeParse({ counts: false, rationale: 'Not a real-world situation.' }).success).toBe(true);
    expect(NewFamilyNeed.safeParse({ kind: 'new_edge_case_family', name: 'Deceased applicant', whyItMatters: 'Fraud risk on estates.', variants: [{ name: 'Death record match', description: 'Screening shows a death record.', outcome: { counts: true, decision: 'refer', rationale: 'Possible identity fraud.', evidence: ['screening.check'] } }] }).success).toBe(true);
  });
});
