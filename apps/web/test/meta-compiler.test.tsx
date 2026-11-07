import { BlueprintResponse, HarborBlueprint, normaliseWeights, sectionProblems, validSectionCount, type CustomField } from '@praxis/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElicitationAssistant } from '@/components/templates/compiler/assistant';
import { BlueprintSummary } from '@/components/templates/compiler/blueprint-summary';
import { CustomFieldForm } from '@/components/templates/compiler/custom-field-dialog';
import { Inspector, StageNav } from '@/components/templates/compiler/inspector';
import { canGenerate, MetaCompiler, type MetaCompilerProps } from '@/components/templates/compiler/meta-compiler';
import { StageEditor } from '@/components/templates/compiler/stage-editors';
import { generateArtifacts, stableStringify } from '@/lib/mc/artifacts';
import { coerceDefault, coupleWeights, distribute, edit, fieldProblems, insertPreset, uniqueFieldId, upsertField } from '@/lib/mc/editor';
import { blueprintForTemplate, sampleBlueprintInput } from '@/lib/mc/fixtures';
import { handleMock, mockProposal, resetMockStore } from '@/lib/mc/mock-backend';
import { ctx, fixtureSource, html, template, text } from './helpers';

// MetaCompiler calls useRouter(); there is no App Router in a unit test, so the hook is replaced by a no-op router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const bp = () => HarborBlueprint.parse(sampleBlueprintInput());
const field = (over: Partial<CustomField> = {}): CustomField => ({ field_id: 'holiday_cpm', label: 'Holiday CPM', input_type: 'number_input', options: [], default_value: 1.8, inject_into: ['mcp_mock.py'], verifier_assertion: '', ...over });

function response(b: HarborBlueprint, over: Partial<BlueprintResponse> = {}): BlueprintResponse {
  const problems = sectionProblems(b);
  return { templateId: '00000000-0000-4000-8000-0000000000aa', lineageId: '00000000-0000-4000-8000-0000000000ab', version: 1, templateStatus: 'DRAFT', editable: true, blueprint: b, blueprintRevision: 3, problems, validSections: validSectionCount(problems), variantOfId: null, ...over };
}
function props(r: BlueprintResponse): MetaCompilerProps {
  return { initial: r, template: { id: r.templateId, workflowName: 'Launch', domainName: 'Digital Marketing', version: 1, status: r.templateStatus }, switcher: [{ id: r.templateId, label: 'Digital Marketing // Launch (v1)' }], presets: [], jobDescriptions: [], factoryId: null, draftId: null };
}

beforeEach(() => resetMockStore());

describe('U2 editing helpers', () => {
  it('S2-06: coupled weight sliders stay locked to 100 and auto-normalise rebalances', () => {
    const w = coupleWeights([40, 35, 25], 0, 70);
    expect(w[0]).toBe(70);
    expect(w.reduce((a, b) => a + b, 0)).toBe(100);
    expect(coupleWeights([50, 50], 1, 100)).toEqual([0, 100]);
    expect(coupleWeights([0, 0, 0], 0, 10)).toEqual([10, 45, 45]);
    expect(distribute([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(normaliseWeights([60, 30, 30]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('S2-02: network_internal can never be switched off by an edit', () => {
    const next = edit(bp(), (d) => {
      (d.harbor_contract as { network_internal: boolean }).network_internal = false;
    });
    expect(next.harbor_contract.network_internal).toBe(true);
  });

  it('S2-08: field_id is auto-slugged and unique; problems need a target, options, a typed default and a verifier assertion', () => {
    const b = bp();
    expect(uniqueFieldId(b, 'Target CAC ceiling')).toBe('target_cac_ceiling_2');
    expect(uniqueFieldId(b, 'Holiday CPM multiplier')).toBe('holiday_cpm_multiplier');
    expect(fieldProblems(b, 'stage_3', field({ inject_into: [] })).join()).toContain('at least one target');
    expect(fieldProblems(b, 'stage_3', field({ input_type: 'single_select', options: [], default_value: null })).join()).toContain('at least one option');
    expect(fieldProblems(b, 'stage_3', field({ default_value: 'abc' })).join()).toContain('default must be a number');
    expect(fieldProblems(b, 'stage_3', field({ inject_into: ['eval/test_verifiers.py'] })).join()).toContain('verifier assertion');
    expect(fieldProblems(b, 'stage_3', field({ field_id: 'target_cac_ceiling' })).join()).toContain('used more than once');
    expect(fieldProblems(b, 'stage_3', field({ field_id: 'Bad Id' })).join()).toContain('lowercase slug');
    expect(fieldProblems(b, 'stage_3', field())).toEqual([]);
    expect(fieldProblems(b, 'stage_3', b.custom_fields_by_stage.stage_3[0]!, 'target_cac_ceiling')).toEqual([]);
    expect(coerceDefault('number_input', '42')).toBe(42);
    expect(coerceDefault('currency_slider', '')).toBeNull();
    expect(coerceDefault('boolean_toggle', true)).toBe(true);
    expect(coerceDefault('multi_select', ['a'])).toEqual(['a']);
    expect(coerceDefault('single_select', '')).toBeNull();
  });

  it('S2-08 edit and delete; S2-14 presets insert into the active stage, renamed when the id is taken', () => {
    let b = upsertField(bp(), 'stage_2', field());
    expect(b.custom_fields_by_stage.stage_2.map((f) => f.field_id)).toEqual(['holiday_cpm']);
    b = upsertField(b, 'stage_4', field({ label: 'Holiday CPM x' }), 'holiday_cpm');
    expect(b.custom_fields_by_stage.stage_2).toEqual([]);
    expect(b.custom_fields_by_stage.stage_4[0]!.label).toBe('Holiday CPM x');
    b = insertPreset(b, 'stage_4', field());
    expect(b.custom_fields_by_stage.stage_4.map((f) => f.field_id)).toEqual(['holiday_cpm', 'holiday_cpm_2']);
    b = insertPreset(b, 'catalog', field({ field_id: 'ubo_hop_depth' }));
    expect(b.custom_fields_by_stage.stage_1.map((f) => f.field_id)).toContain('ubo_hop_depth');
  });

  it('S2-09, S2-10: previews are deterministic and contain test_custom_<field_id> for verifier-bound fields', () => {
    const a = generateArtifacts(bp(), null);
    const b = generateArtifacts(HarborBlueprint.parse(JSON.parse(JSON.stringify(sampleBlueprintInput()))), null);
    expect(a).toEqual(b);
    expect(a['eval/test_verifiers.py']).toContain("def test_custom_target_cac_ceiling(env_state):\n    assert env_state['weekly_cac_usd'] <= 42");
    expect(a['eval/test_verifiers.py']).not.toContain('test_custom_launch_locales');
    expect(a['UISpec.json']).toBe(stableStringify(bp()));
    expect(a['meta_prompt.md']).toContain('--network=internal');
    const start = performance.now();
    for (let i = 0; i < 20; i++) generateArtifacts(bp(), null);
    expect((performance.now() - start) / 20).toBeLessThan(50);
  });
});

describe('U2 mock routes (contract behaviour the UI relies on)', () => {
  const draft = template();
  const published = template({ status: 'PUBLISHED', workflowName: 'KYB' });
  const source = fixtureSource([draft, published]);

  it('S2-16: a stale expectedRevision gets 409 BLUEPRINT_CONFLICT and the newer revision is readable', async () => {
    const admin = ctx(['ADMIN'], source);
    const first = BlueprintResponse.parse((await handleMock('GET', `/templates/${draft.id}/blueprint`, undefined, admin)).body);
    const saved = await handleMock('PUT', `/templates/${draft.id}/blueprint`, { blueprint: first.blueprint, expectedRevision: 0 }, admin);
    expect(saved.status).toBe(200);
    const stale = await handleMock('PUT', `/templates/${draft.id}/blueprint`, { blueprint: first.blueprint, expectedRevision: 0 }, admin);
    expect(stale).toMatchObject({ status: 409, body: { error: 'BLUEPRINT_CONFLICT' } });
    expect(BlueprintResponse.parse((await handleMock('GET', `/templates/${draft.id}/blueprint`, undefined, admin)).body).blueprintRevision).toBe(1);
  });

  it('S2-15: only DRAFT is editable', async () => {
    const admin = ctx(['ADMIN'], source);
    const r = BlueprintResponse.parse((await handleMock('GET', `/templates/${published.id}/blueprint`, undefined, admin)).body);
    expect(r.editable).toBe(false);
    expect(await handleMock('PUT', `/templates/${published.id}/blueprint`, { blueprint: r.blueprint, expectedRevision: 0 }, admin)).toMatchObject({ status: 409, body: { error: 'TEMPLATE_NOT_EDITABLE' } });
  });

  it('S2-12: Save Variant creates a DRAFT v1 linked to its source; the label must be unique in the domain', async () => {
    const admin = ctx(['ADMIN'], source);
    expect(await handleMock('POST', `/templates/${draft.id}/variant`, { label: 'KYB' }, admin)).toMatchObject({ status: 409, body: { error: 'VARIANT_LABEL_TAKEN' } });
    const v = await handleMock('POST', `/templates/${draft.id}/variant`, { label: 'Launch (EU)' }, admin);
    expect(v).toMatchObject({ status: 201, body: { version: 1, variantOfId: draft.id } });
    const id = (v.body as { templateId: string }).templateId;
    expect(BlueprintResponse.parse((await handleMock('GET', `/templates/${id}/blueprint`, undefined, admin)).body)).toMatchObject({ templateStatus: 'DRAFT', variantOfId: draft.id, editable: true });
  });

  it('S2-14 / D7: propose-field returns a proposal only (nothing saved); AI off returns the reason', async () => {
    const admin = ctx(['ADMIN'], source);
    const before = (await handleMock('GET', `/templates/${draft.id}/blueprint`, undefined, admin)).body;
    const r = await handleMock('POST', `/templates/${draft.id}/assistant/propose-field`, { stage: 'stage_3', prompt: 'Holiday CPM multiplier around 1.8' }, admin);
    expect(r.body).toMatchObject({ proposal: { input_type: 'number_input', default_value: 1.8 }, unavailableReason: null });
    expect((await handleMock('GET', `/templates/${draft.id}/blueprint`, undefined, admin)).body).toEqual(before);
    process.env.MC_MOCK_AI_OFF = '1';
    const off = await handleMock('POST', `/templates/${draft.id}/assistant/propose-field`, { stage: 'stage_3', prompt: 'x' }, admin);
    delete process.env.MC_MOCK_AI_OFF;
    expect(off.body).toMatchObject({ proposal: null, unavailableReason: expect.stringContaining('switched off') });
    expect(mockProposal('Locale: en-GB, de-DE')).toMatchObject({ input_type: 'single_select', options: ['en-GB', 'de-DE'] });
    expect(mockProposal('Target CAC ceiling $42')).toMatchObject({ input_type: 'currency_slider', default_value: 42 });
  });

  it('NFR-07: PMs cannot use the Meta-Compiler routes and see only published blueprints', async () => {
    const pm = ctx(['PM'], source);
    expect((await handleMock('PUT', `/templates/${draft.id}/blueprint`, {}, pm)).status).toBe(403);
    expect((await handleMock('POST', `/templates/${draft.id}/variant`, { label: 'x' }, pm)).status).toBe(403);
    expect((await handleMock('GET', `/templates/${draft.id}/blueprint`, undefined, pm)).status).toBe(404);
    expect((await handleMock('GET', `/templates/${published.id}/blueprint`, undefined, pm)).status).toBe(200);
  });
});

describe('U2 Screen 2 rendering', () => {
  it('S2-07, S2-17: n/6 Valid counter; Generate → is a link only when 6/6 valid and saved', () => {
    const markup = html(<MetaCompiler {...props(response(bp()))} />);
    expect(text(markup)).toContain('6/6 Valid');
    expect(markup).toMatch(/href="\/templates\/[\w-]+\/generate"[^>]*>Generate →/);
    const broken = edit(bp(), (d) => void (d.step_5_default_rubric.milestones[0]!.weight = 10));
    const bad = html(<MetaCompiler {...props(response(broken))} />);
    expect(text(bad)).toContain('5/6 Valid');
    expect(bad).not.toContain('/generate"');
    expect(bad).toMatch(/<button type="button" disabled="" aria-describedby="generate-hint"[^>]*>Generate →/);
    expect(canGenerate(6, true)).toBe(false);
    expect(canGenerate(6, false)).toBe(true);
    expect(canGenerate(5, false)).toBe(false);
  });

  it('S2-01, S2-18: switcher shows Domain // Workflow (vN) and panel 0 Catalog & Staffing opens first', () => {
    const t = text(html(<MetaCompiler {...props(response(bp()))} />));
    expect(t).toContain('Digital Marketing // Launch (v1)');
    expect(t).toContain('0. Catalog & Staffing');
    expect(t).toContain('Primary work');
    expect(t).toContain('Edge-case catalog (JSON)');
  });

  it('S2-15: a non-draft is read-only (fieldset disabled) and points to New version', () => {
    const markup = html(<MetaCompiler {...props(response(bp(), { editable: false, templateStatus: 'PUBLISHED' }))} />);
    expect(markup).toMatch(/<fieldset disabled=""/);
    expect(text(markup)).toContain('Only a draft can be edited');
    expect(text(markup)).toContain('New version');
  });

  it('S2-02 to S2-06: every stage editor renders its fields; --network=internal is checked and disabled', () => {
    const b = bp();
    const s1 = html(<StageEditor section="stage_1" bp={b} onChange={() => undefined} jobDescriptions={[]} />);
    expect(s1).toMatch(/<input type="checkbox" disabled=""[^>]*checked=""\/><span class="font-medium">--network=internal<\/span>/);
    for (const label of ['Studio Blueprint ID', 'Display title', 'SME role persona', 'Execution topology', 'Max horizon turns', 'Cadence unit label', 'ATIF v1.2', 'Zero-Baseline Gate']) expect(text(s1)).toContain(label);
    expect(text(html(<StageEditor section="stage_2" bp={b} onChange={() => undefined} jobDescriptions={[]} />))).toMatch(/Target path.*Ground-truth path.*SME tag options/);
    expect(text(html(<StageEditor section="stage_3" bp={b} onChange={() => undefined} jobDescriptions={[]} />))).toMatch(/Tool ID.*Archetype.*Min.*Default.*Max/);
    expect(text(html(<StageEditor section="stage_4" bp={b} onChange={() => undefined} jobDescriptions={[]} />))).toMatch(/IF subject.*Operator.*Hard Fail −1\.0/);
    const s5 = html(<StageEditor section="stage_5" bp={b} onChange={() => undefined} jobDescriptions={[]} />);
    expect(text(s5)).toContain('Total weight 100% (locked to 100%)');
    expect(text(s5)).toContain('Auto-normalise');
    expect(s5).toContain('aria-valuetext="40 percent"');
  });

  it('S2-10: inspector shows the three tabs, Copy and the footer counters', () => {
    const b = bp();
    const markup = html(<Inspector artifacts={generateArtifacts(b, null)} counters={{ dropzones: 2, mcp: 2, customFields: 2 }} />);
    expect(markup).toMatch(/role="tab" aria-selected="true"[^>]*>UISpec.json/);
    expect(text(markup)).toMatch(/Meta-Prompt.*Pytest & Widget Map.*Copy/);
    expect(text(markup)).toContain('Dropzones 2 · MCP 2 · Custom Fields 2');
    expect(html(<Inspector artifacts={generateArtifacts(b, null)} counters={{ dropzones: 0, mcp: 0, customFields: 0 }} initialTab="pytest" />)).toContain('def test_custom_target_cac_ceiling');
  });

  it('S2-07: stage navigator is a keyboard tab list with validity badges', () => {
    const b = edit(bp(), (d) => void (d.studio_id = ''));
    const markup = html(<StageNav problems={sectionProblems(b)} active="stage_1" onSelect={() => undefined} />);
    expect(markup).toContain('role="tablist" aria-orientation="vertical"');
    expect(markup).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
    expect(text(markup)).toContain('5/6 Valid');
    expect(text(markup)).toMatch(/Domain, Persona & Horizon 1 to fix/);
  });

  it('S2-08: the custom-field dialog has stage, type, auto-slugged id, options, typed default and inject targets', () => {
    const markup = html(<CustomFieldForm bp={bp()} stage="stage_2" initial={field({ input_type: 'single_select', options: ['A', 'B'], default_value: 'B', inject_into: ['task.json'] })} onSave={() => undefined} onCancel={() => undefined} />);
    const t = text(markup);
    for (const s of ['Stage', 'Input type', 'Label', 'field_id', 'Options', 'Default value', 'Inject into (at least one)', 'instruction.md', 'eval/test_verifiers.py']) expect(t).toContain(s);
    expect(markup).toContain('<option value="B" selected="">B</option>');
    const empty = html(<CustomFieldForm bp={bp()} stage="stage_2" initial={null} onSave={() => undefined} onCancel={() => undefined} />);
    expect(text(empty)).toContain('Label is required');
    expect(empty).toMatch(/<button type="submit" disabled=""/);
  });

  it('S2-14: preset chips, and an AI proposal with Accept / Edit / Discard; AI off shows the reason', () => {
    const preset = { id: '00000000-0000-4000-8000-0000000000ff', label: 'UBO hop depth', field: field({ field_id: 'ubo_hop_depth' }), sortOrder: 0, active: true };
    const common = { presets: [preset], disabled: false, stageLabel: '3. Mock Env', propose: async () => ({ ok: true, data: null, error: null }), check: () => [], onInsertPreset: () => undefined, onAccept: () => undefined, onEdit: () => undefined, onManual: () => undefined };
    const withProposal = text(html(<ElicitationAssistant {...common} initialResult={{ proposal: field(), problems: [], provider: 'mock', model: 'mock-drafter', costUsd: 0, unavailableReason: null }} />));
    expect(withProposal).toContain('+ UBO hop depth');
    expect(withProposal).toMatch(/Accept Edit Discard/);
    expect(withProposal).toContain('Nothing is saved until you accept it');
    const off = text(html(<ElicitationAssistant {...common} initialResult={{ proposal: null, problems: [], provider: 'mock', model: 'mock', costUsd: 0, unavailableReason: 'AI drafting is switched off.' }} />));
    expect(off).toContain('AI drafting is switched off.');
    expect(off).toContain('Add the field by hand');
  });

  it('S1-15: PM summary is read-only with Create project', () => {
    const t = template({ status: 'PUBLISHED' });
    const markup = html(<BlueprintSummary bp={blueprintForTemplate(t)} templateId={t.id} />);
    expect(markup).toContain(`href="/projects/new?templateId=${t.id}"`);
    expect(markup).not.toMatch(/<input|<textarea|<select/);
  });
});
