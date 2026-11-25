import { describe, expect, it } from 'vitest';
import { agentProjection, checkProfile, itemFieldsOf, MARKETING_CAMPAIGN_TASK2_PROFILE_V2, type ItemField, type TemplateProfile } from '../src';

/**
 * KYC Judgment v1 (contract C4 at Studio 1ba841d): S4 `expectedRules` is a PRIVATE policy_citation whose sub-fields are
 * all private and which carries C1's rule identity: ruleId (the rule key), ruleVersion (Authoring's integer version) and
 * textSha256. Authoring must register it (A5 follow-up), and the agent must never see it.
 */
const V2 = MARKETING_CAMPAIGN_TASK2_PROFILE_V2;
const priv = 'private_reference' as const;
const C4_EXPECTED_RULES: ItemField = {
  key: 'policies',
  label: 'Expected rules (private)',
  type: 'policy_citation',
  required: true,
  visibility: priv,
  help: 'The SME’s expected rules for this task’s typical cases. Never shown to the agent.',
  itemFields: [
    { key: 'ruleId', label: 'Rule', type: 'text', required: true, visibility: priv, help: 'Rule' },
    { key: 'ruleVersion', label: 'Version', type: 'number', required: true, visibility: priv, help: 'Version' },
    { key: 'textSha256', label: 'Text SHA-256', type: 'text', required: true, visibility: priv, help: 'Hash' },
    { key: 'appliesTo', label: 'Applies to', type: 'long_text', required: true, visibility: priv, help: 'Applies' },
    { key: 'rationale', label: 'Rationale', type: 'long_text', required: true, visibility: priv, help: 'Why' },
    { key: 'exception', label: 'Exception', type: 'long_text', required: false, visibility: priv, help: 'Exception' },
  ],
} as ItemField;
const withS4 = (field: ItemField) => ({ ...V2, sections: V2.sections.map((s) => (s.key === 'S4' ? { ...s, fields: s.fields.map((x) => (x.key === 'policies' ? field : x)) } : s)) }) as TemplateProfile;

describe('C4 S4 expectedRules: a private policy citation with C1 identity', () => {
  it('registers: a private citation field may keep every sub-field private, declare textSha256 and a number ruleVersion', () => {
    expect(checkProfile(withS4(C4_EXPECTED_RULES))).toEqual([]);
  });

  it('its item fields carry the declared type and visibility; textSha256 is part of the item', () => {
    const subs = itemFieldsOf(C4_EXPECTED_RULES);
    expect(subs.find((s) => s.key === 'ruleVersion')).toMatchObject({ type: 'number', visibility: priv });
    expect(subs.find((s) => s.key === 'textSha256')).toMatchObject({ type: 'text', visibility: priv });
    expect(subs.find((s) => s.key === 'ruleId')).toMatchObject({ visibility: priv });
    // Marketing's agent-visible declaration is unchanged.
    const mkt = V2.sections.find((s) => s.key === 'S4')!.fields.find((x) => x.key === 'policies')!;
    expect(itemFieldsOf(mkt).map((s) => [s.key, s.type, s.visibility ?? 'author_and_agent'])).toEqual(itemFieldsOf({ ...mkt, itemFields: undefined }).map((s) => [s.key, s.type, s.visibility ?? 'author_and_agent']));
  });

  it('still refused: an unknown sub-field, a retyped textSha256, or an agent-visible sub-field in a private citation', () => {
    const subs = C4_EXPECTED_RULES.itemFields!;
    expect(checkProfile(withS4({ ...C4_EXPECTED_RULES, itemFields: [...subs, { key: 'secret', type: 'text', label: 'S', help: 'S', visibility: priv }] as ItemField[] })).join(' ')).toMatch(/secret: not a policy citation sub-field/);
    expect(checkProfile(withS4({ ...C4_EXPECTED_RULES, itemFields: subs.map((x) => (x.key === 'textSha256' ? { ...x, type: 'long_text' } : x)) as ItemField[] })).join(' ')).toMatch(/textSha256: must keep its type text/);
    expect(checkProfile(withS4({ ...C4_EXPECTED_RULES, itemFields: subs.map((x) => (x.key === 'rationale' ? { ...x, visibility: 'author_and_agent' } : x)) as ItemField[] })).join(' ')).toMatch(/rationale: is in a private field and must stay private/);
  });

  it('the agent never sees it', () => {
    const p = withS4(C4_EXPECTED_RULES);
    const out = { profile: { id: p.profileId, version: 1 }, sections: { S4: { policies: [{ ruleId: 'R-TIN', ruleVersion: 3, textSha256: 'a'.repeat(64), appliesTo: 'x', rationale: 'y' }] } } };
    expect(JSON.stringify(agentProjection(p, out))).not.toContain('R-TIN');
  });
});
