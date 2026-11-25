import { describe, expect, it } from 'vitest';
import { mapRecordPolicies, policyIdMapFor, PolicyIdMaps, type PolicyIdMap } from '../src/anvil/policy-id-map';
import maps from '../src/anvil/policy-id-maps.json';

const SHA_DOC = 'a5c0aa26ed48ceda91c4cc8238bb8fde588342626e9e27f1c04bfb0c5be51aea';
const DOC = '54e00852-42c6-4f43-a7b9-732cf7fd0882';
const record = (cites: { ruleId: string; contentSha256: string }[]) => ({ output: { sections: { S4: { statePolicies: cites.map((c) => ({ ...c, ruleVersion: 'rs2.d1', locator: 'project rule set v2' })) } } } });
const env = (id: string) => ({ id, version: 'golden-kyc-1.0.0', content_sha256: 'b'.repeat(64) });
const MAP: PolicyIdMap = {
  studio_template_id: 'tpl_x5rwt6d5eu',
  studio_version: 8,
  environment: 'golden-kyc-openenv',
  environment_policies: [env('KYC-01'), env('KYC-02'), env('GB-02')],
  entries: [{ forge: { kind: 'document', id: DOC, content_sha256: SHA_DOC }, environment_policy_ids: ['KYC-01', 'KYC-02'], confirmed_by: 'owner', confirmed_at: '2026-11-24' }],
};

describe('D-056: Forge policy ids mapped to the environment’s, at export only', () => {
  it('the shipped mapping file is valid and starts empty, so nothing is mapped until a person confirms it', () => {
    const parsed = PolicyIdMaps.parse(maps);
    expect(parsed.maps).toEqual([]);
    expect(policyIdMapFor({ id: 'tpl_x5rwt6d5eu', version: 8 })).toBeNull();
  });

  it('picks the mapping of the exact Studio template version', () => {
    const source = { schema: 'praxis.policy-id-map.v1' as const, maps: [MAP] };
    expect(policyIdMapFor({ id: 'tpl_x5rwt6d5eu', version: 8 }, source)).toBe(MAP);
    expect(policyIdMapFor({ id: 'tpl_x5rwt6d5eu', version: 9 }, source)).toBeNull();
    expect(policyIdMapFor(null, source)).toBeNull();
  });

  it('maps an exact match (id and content hash) to the environment’s policy ids', () => {
    expect(mapRecordPolicies(record([{ ruleId: DOC, contentSha256: SHA_DOC }]), MAP)).toEqual({ mapped: [{ forge_rule_id: DOC, forge_content_sha256: SHA_DOC, environment_policy_ids: ['KYC-01', 'KYC-02'] }], unmapped: [] });
  });

  it('never guesses: no mapping, another version, an unknown id or an undeclared environment policy are all flagged', () => {
    const cite = [{ ruleId: DOC, contentSha256: SHA_DOC }];
    expect(mapRecordPolicies(record(cite), null).unmapped[0]!.message).toMatch(/no reviewed mapping/);
    expect(mapRecordPolicies(record([{ ruleId: DOC, contentSha256: 'c'.repeat(64) }]), MAP)).toMatchObject({ mapped: [], unmapped: [{ message: expect.stringMatching(/at a version the mapping does not cover/) }] });
    expect(mapRecordPolicies(record([{ ruleId: 'other-rule', contentSha256: SHA_DOC }]), MAP)).toMatchObject({ mapped: [], unmapped: [{ ruleId: 'other-rule' }] });
    const bad = { ...MAP, entries: [{ ...MAP.entries[0]!, environment_policy_ids: ['KYC-01', 'KYC-09'] }] };
    expect(mapRecordPolicies(record(cite), bad)).toMatchObject({ mapped: [], unmapped: [{ message: expect.stringMatching(/KYC-09.*does not declare/) }] });
  });

  it('a task that cites nothing has nothing to map or flag', () => {
    expect(mapRecordPolicies({ output: { sections: {} } }, MAP)).toEqual({ mapped: [], unmapped: [] });
  });

  it('refuses a mapping entry without a person who confirmed it', () => {
    const entry = { ...MAP.entries[0]!, confirmed_by: '' };
    expect(() => PolicyIdMaps.parse({ schema: 'praxis.policy-id-map.v1', maps: [{ ...MAP, entries: [entry] }] })).toThrow();
  });
});
