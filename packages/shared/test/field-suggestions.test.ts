import { describe, expect, it } from 'vitest';
import {
  emptyOutput,
  fieldOrigin,
  hashValue,
  isBlankValue,
  isConfirmed,
  MARKETING_CAMPAIGN_TASK2_PROFILE,
  provenanceSummary,
  sectionDigest,
  sectionsToConfirm,
  setFieldValue,
  suggestibleFields,
  suggestionJson,
  unconfirmedSections,
  type SuggestionState,
} from '../src';

/** Provenance and section confirmation for suggested text (owner decisions 1-3, 15 Nov 2026). Marketing VEYRA form. */
const P = MARKETING_CAMPAIGN_TASK2_PROFILE;

describe('field suggestions: hashing, origin, confirmation', () => {
  it('hashes order-independently and the same everywhere', () => {
    expect(suggestionJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue('x')).not.toBe(hashValue('y'));
    expect(hashValue('x')).toMatch(/^[0-9a-f]{16}$/);
    expect(isBlankValue(['', { a: ' ' }])).toBe(true);
    expect(isBlankValue(0)).toBe(false);
  });

  it('origin: written by the author, used as it is, or edited (derived from the saved value)', () => {
    const state: SuggestionState = { used: { 'S1.trigger': { hash: hashValue('Twelve-week launch'), at: 't', model: 'm' } }, confirmed: {} };
    expect(fieldOrigin(state, 'S1.trigger', 'Twelve-week launch')).toBe('SUGGESTION_AS_IS');
    expect(fieldOrigin(state, 'S1.trigger', 'Twelve-week launch, US only')).toBe('SUGGESTION_EDITED');
    expect(fieldOrigin(state, 'S1.title', 'My title')).toBe('AUTHOR');
    expect(fieldOrigin(state, 'S1.trigger', '')).toBeNull();
  });

  it('suggestible fields leave out the rubric, the workflow graph, policy references and the case selector', () => {
    for (const s of P.sections) for (const f of suggestibleFields(P, s.key)) expect(['criterion', 'graph_binding', 'policy_citation']).not.toContain(f.type);
    expect(suggestibleFields(P, 'S7').some((f) => f.type === 'criterion')).toBe(false);
    const s1 = suggestibleFields(P, 'S1');
    expect(suggestibleFields(P, 'S1', `S1.${s1[0]!.key}`).map((f) => f.key)).not.toContain(s1[0]!.key);
    expect(sectionsToConfirm(P)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
  });

  it('a confirmation holds for the content it was given, and goes stale on any change in that section only', () => {
    let out = emptyOutput(P);
    const key = suggestibleFields(P, 'S1').find((f) => f.type === 'long_text' || f.type === 'text')!.key;
    out = setFieldValue(P, out, 'S1', key, 'A fictional over-ear headphone launches in five markets.');
    const state: SuggestionState = { used: {}, confirmed: { S1: { digest: sectionDigest(P, out, 'S1'), at: 't', smeUserId: 'u' } } };
    expect(isConfirmed(P, out, state, 'S1')).toBe(true);
    expect(unconfirmedSections(P, out, state)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    const s2key = P.sections.find((s) => s.key === 'S6')!.fields.find((f) => f.type === 'long_text')!.key;
    const other = setFieldValue(P, out, 'S6', s2key, 'CampaignPlan and a close-out.');
    expect(isConfirmed(P, other, state, 'S1')).toBe(true);
    const changed = setFieldValue(P, out, 'S1', key, 'Changed.');
    expect(isConfirmed(P, changed, state, 'S1')).toBe(false);
    // A blank string and a missing value are the same content.
    expect(sectionDigest(P, setFieldValue(P, emptyOutput(P), 'S1', key, ''), 'S1')).toBe(sectionDigest(P, emptyOutput(P), 'S1'));
  });

  it('the summary counts each filled field once and leaves out the case selector', () => {
    const [a, b, c] = suggestibleFields(P, 'S1').filter((f) => f.type === 'text' || f.type === 'long_text');
    let out = emptyOutput(P);
    out = setFieldValue(P, out, 'S1', a!.key, 'Mine');
    out = setFieldValue(P, out, 'S1', b!.key, 'Suggested');
    out = setFieldValue(P, out, 'S1', c!.key, 'Suggested, then edited');
    const state: SuggestionState = { used: { [`S1.${b!.key}`]: { hash: hashValue('Suggested'), at: 't', model: 'm' }, [`S1.${c!.key}`]: { hash: hashValue('Suggested'), at: 't', model: 'm' } }, confirmed: {} };
    const sum = provenanceSummary(P, out, state);
    expect(sum.counts).toEqual({ AUTHOR: 1, SUGGESTION_AS_IS: 1, SUGGESTION_EDITED: 1 });
    expect(sum.toConfirm).toBe(8);
    expect(provenanceSummary(P, out, state, `S1.${a!.key}`).counts.AUTHOR).toBe(0);
  });
});
