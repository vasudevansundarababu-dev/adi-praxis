import { describe, expect, it } from 'vitest';
import { checkGoldenPack, GOLDEN_KYC_EXAMPLE, KYC_ACCOUNT_OPENING_PROFILE } from '../src';

/** Golden task packs (owner, 12 Nov 2026): a form and its worked cases are uploaded and checked without a code change. */
const profile = { ...KYC_ACCOUNT_OPENING_PROFILE, profileId: 'pack-demo', catalogWorkflowName: 'Pack demo workflow', agentMode: 'MULTI' as const };
const example = { ...GOLDEN_KYC_EXAMPLE, profile: { id: 'pack-demo', version: 1 } };
const pack = { schemaVersion: 'praxis.golden_pack.v1', source: 'unit test', profile, examples: [{ name: 'Case 1', output: example }] };
const free = () => false;

describe('golden task pack', () => {
  it('a valid pack passes: the form registers and every example passes the form checks', () => {
    const r = checkGoldenPack(pack, free);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ ok: true, profile: { profileId: 'pack-demo', agentMode: 'MULTI' }, examples: [{ name: 'Case 1', problems: [] }] });
  });

  it('reports a wrong schema version, an unsupported field type, an unknown tool and an incomplete example', () => {
    expect(checkGoldenPack({ ...pack, schemaVersion: 'v0' }, free).problems.join(' ')).toMatch(/schemaVersion/);
    const broken = JSON.parse(JSON.stringify(profile));
    broken.sections[1].fields.push({ key: 'sig', type: 'signature_pad', label: 'Sign', help: 'x' });
    expect(checkGoldenPack({ ...pack, profile: broken }, free).problems.join(' ')).toMatch(/unsupported field type "signature_pad"/);
    const incomplete = { ...example, sections: { ...example.sections, S6: {}, S3: { ...example.sections.S3, tools: ['funds.transfer'] } } };
    const r = checkGoldenPack({ ...pack, examples: [{ name: 'Bad', output: incomplete }] }, free);
    expect(r.ok).toBe(false);
    expect(r.examples[0]!.problems.join(' ')).toMatch(/recommendation/i);
    expect(r.examples[0]!.problems.join(' ')).toMatch(/funds\.transfer/);
  });

  it('a taken form ID, a canonical form or an example for another form is refused', () => {
    expect(checkGoldenPack(pack, () => true).problems.join(' ')).toMatch(/already in use.*pack-demo-v2/);
    expect(checkGoldenPack({ ...pack, profile: { ...profile, storage: 'canonical' } }, free).ok).toBe(false);
    expect(checkGoldenPack({ ...pack, examples: [{ name: 'X', output: { ...example, profile: { id: 'other', version: 1 } } }] }, free).problems.join(' ')).toMatch(/output\.profile\.id must be "pack-demo"/);
  });

  it('a new workflow may bring its template, coverage included', () => {
    const template = { domainName: 'Marketing', primaryWork: 'w', verificationCriteria: 'v', humanGate: 'h', skills: ['Campaign compliance'], defaultTptMinutes: 60, coverageDimensions: { dimensions: [{ key: 'market', label: 'Market', values: ['US'] }], cells: [] } };
    expect(checkGoldenPack({ ...pack, template }, free).ok).toBe(true);
    expect(checkGoldenPack({ ...pack, template: { ...template, skills: [] } }, free).ok).toBe(false);
  });
});

/** The example pack in docs/authoring/golden-packs stays valid (regenerate with GEN_GOLDEN_PACK=1). */
describe('example golden pack file', () => {
  it('validates', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const path = new URL('../../../docs/authoring/golden-packs/example-golden-pack.json', import.meta.url);
    if (process.env.GEN_GOLDEN_PACK === '1') {
      const id = 'example-golden-pack';
      const example = {
        schemaVersion: 'praxis.golden_pack.v1',
        source: 'Example pack: the Golden Bank KYC form and worked case, re-labelled as a new workflow. Copy and edit it for a new golden task.',
        profile: { ...KYC_ACCOUNT_OPENING_PROFILE, profileId: id, catalogWorkflowName: 'Example golden workflow', handoverName: 'Example golden form' },
        template: { domainName: 'Banking', primaryWork: 'Author one synthetic investigation with its reference outcome and rubric.', verificationCriteria: 'Evidence, rules, reference and rubric agree.', humanGate: 'An authorised person decides; the agent only recommends.', skills: ['KYC'], defaultTptMinutes: 90, taskModes: ['AUTHORING'], coverageDimensions: { dimensions: [{ key: 'product', label: 'Product', values: ['teen_joint_checking'] }], cells: [{ tags: { product: 'teen_joint_checking' }, quota: 1, required: true }] } },
        examples: [{ name: 'Teen joint checking, NY, slot 5', output: { ...GOLDEN_KYC_EXAMPLE, profile: { id, version: 1 } } }],
      };
      writeFileSync(path, JSON.stringify(example, null, 2) + '\n');
    }
    const r = checkGoldenPack(JSON.parse(readFileSync(path, 'utf8')), () => false);
    expect(r.problems).toEqual([]);
  });
});
