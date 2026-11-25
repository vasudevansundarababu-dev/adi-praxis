import { describe, expect, it } from 'vitest';
import { mapRecordPolicies, policyIdMapFor, policyIdMapWire, PolicyIdMaps, type PolicyIdMap } from '../src/anvil/policy-id-map';
import maps from '../src/anvil/policy-id-maps.json';

const SHA_DOC = 'a5c0aa26ed48ceda91c4cc8238bb8fde588342626e9e27f1c04bfb0c5be51aea';
const DOC = '54e00852-42c6-4f43-a7b9-732cf7fd0882';
const record = (cites: { ruleId: string; contentSha256: string }[]) => ({ output: { sections: { S4: { statePolicies: cites.map((c) => ({ ...c, ruleVersion: 'rs2.d1', locator: 'project rule set v2' })) } } } });
const env = (id: string) => ({ id, title: id, text_sha256: 'b'.repeat(64) });
const docEntry = { forge: { kind: 'document' as const, id: DOC, content_sha256: SHA_DOC, label: 'doc' }, environment_policy_ids: ['KYC-01', 'KYC-02'], reason: 'test', confirmed_by: 'owner', confirmed_at: '2026-11-25' };
const MAP: PolicyIdMap = { environment: 'golden-kyc-openenv', environment_version: 12, applies_to: [{ studio_template_id: 'tpl_x5rwt6d5eu', studio_version: 8 }], source: 'test', environment_policies: [env('KYC-01'), env('KYC-02'), env('GB-02')], entries: [docEntry] };
const file = (m: PolicyIdMap[]) => ({ schema: 'praxis.policy-id-map.v1' as const, maps: m });
const cite = [{ ruleId: DOC, contentSha256: SHA_DOC }];

describe('D-056: Forge policy ids mapped to the environment’s, at export only', () => {
  it('the shipped proposal: golden-kyc-openenv@12 for tpl_x5rwt6d5eu v8, its 7 policies, the document and all 11 rule set v2 rules, none confirmed yet', () => {
    const parsed = PolicyIdMaps.parse(maps);
    const m = policyIdMapFor({ id: 'tpl_x5rwt6d5eu', version: 8 }, parsed)!;
    expect(m).toMatchObject({ environment: 'golden-kyc-openenv', environment_version: 12 });
    expect(m.environment_policies.map((p) => p.id).sort()).toEqual(['GB-02', 'GB-03', 'GB-05', 'KYC-01', 'KYC-02', 'KYC-03', 'KYC-04']);
    expect(m.entries.filter((e) => e.forge.kind === 'document')).toHaveLength(1);
    expect(m.entries.filter((e) => e.forge.kind === 'rule')).toHaveLength(11);
    for (const e of m.entries) {
      expect(e.confirmed_by).toBeNull();
      expect(e.reason.length).toBeGreaterThan(10);
      for (const id of e.environment_policy_ids) expect(m.environment_policies.some((p) => p.id === id)).toBe(true);
    }
    // Until the owner confirms, the tasks' citation is flagged and nothing is sent.
    expect(mapRecordPolicies(record(cite), m)).toMatchObject({ mapped: [], unmapped: [{ message: expect.stringMatching(/waits for the owner's confirmation/) }] });
  });

  it('picks the map of the exact Studio template release; two maps for one release are refused', () => {
    expect(policyIdMapFor({ id: 'tpl_x5rwt6d5eu', version: 8 }, file([MAP]))).toBe(MAP);
    expect(policyIdMapFor({ id: 'tpl_x5rwt6d5eu', version: 9 }, file([MAP]))).toBeNull();
    expect(policyIdMapFor(null, file([MAP]))).toBeNull();
    expect(() => PolicyIdMaps.parse(file([MAP, { ...MAP, environment_version: 11 }]))).toThrow(/Two maps/);
  });

  it('maps a confirmed exact match (id and content hash); the wire carries the environment version and every hash', () => {
    const r = mapRecordPolicies(record(cite), MAP);
    expect(r).toEqual({ mapped: [{ forge_rule_id: DOC, forge_content_sha256: SHA_DOC, environment_policy_ids: ['KYC-01', 'KYC-02'] }], unmapped: [] });
    // The exact shape the RL Gym accepts (fde41cf).
    expect(policyIdMapWire(MAP, r.mapped)).toEqual({ environment_version: 'golden-kyc-openenv@12', map: { [DOC]: ['KYC-01', 'KYC-02'] }, policies: { 'KYC-01': { content_sha256: 'b'.repeat(64) }, 'KYC-02': { content_sha256: 'b'.repeat(64) } }, source_sha256: { [DOC]: SHA_DOC } });
  });

  it('never guesses: no map, another version, an unknown id, unconfirmed, no clear match or an undeclared id are all flagged', () => {
    expect(mapRecordPolicies(record(cite), null).unmapped[0]!.message).toMatch(/no mapping/);
    expect(mapRecordPolicies(record([{ ruleId: DOC, contentSha256: 'c'.repeat(64) }]), MAP)).toMatchObject({ mapped: [], unmapped: [{ message: expect.stringMatching(/at a version the mapping does not cover/) }] });
    expect(mapRecordPolicies(record([{ ruleId: 'other-rule', contentSha256: SHA_DOC }]), MAP)).toMatchObject({ mapped: [], unmapped: [{ ruleId: 'other-rule' }] });
    const withEntry = (e: Partial<typeof docEntry>) => ({ ...MAP, entries: [{ ...docEntry, ...e }] });
    expect(mapRecordPolicies(record(cite), withEntry({ confirmed_by: null as unknown as string })).unmapped[0]!.message).toMatch(/waits for the owner/);
    expect(mapRecordPolicies(record(cite), withEntry({ environment_policy_ids: [], reason: 'no environment policy covers it' })).unmapped[0]!.message).toMatch(/no clear match.*no environment policy covers it/);
    expect(mapRecordPolicies(record(cite), withEntry({ environment_policy_ids: ['KYC-01', 'KYC-09'] })).unmapped[0]!.message).toMatch(/KYC-09.*does not declare/);
  });

  it('a task that cites nothing has nothing to map or flag', () => {
    expect(mapRecordPolicies({ output: { sections: {} } }, MAP)).toEqual({ mapped: [], unmapped: [] });
  });
});
