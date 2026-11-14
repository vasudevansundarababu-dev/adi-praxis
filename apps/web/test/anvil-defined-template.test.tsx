import { anvilDefinition, anvilRubricSummary, emptyBlueprint, sectionProblems, TemplateDirectoryResponse, validSectionCount, type AnvilDefinitionDto, type BlueprintResponse, type HarborBlueprint } from '@praxis/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StageNav } from '@/components/templates/compiler/inspector';
import { MetaCompiler, type MetaCompilerProps } from '@/components/templates/compiler/meta-compiler';
import { DirectoryView } from '@/components/templates/directory/directory-view';
import { handleMock, resetMockStore } from '@/lib/mc/mock-backend';
import { ctx, DOMAIN_BANK, fixtureSource, html, project, template, text } from './helpers';

// MetaCompiler calls useRouter(); there is no App Router in a unit test, so the hook is replaced by a no-op router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * DECISIONS.md, 13 Nov 2026: a template whose execution Anvil defines (anvilSpec set) has no Harbor blueprint, so the
 * Meta-Compiler navigator shows "Defined by Anvil" instead of "n/6 Valid" and "to fix" badges. Harbor templates keep
 * the validator unchanged.
 */

/** What an Anvil template looks like to the Meta-Compiler: the empty blueprint with only panel 0 pre-filled. */
const anvilBlueprint = (): HarborBlueprint => {
  const b = emptyBlueprint();
  b.catalog = { ...b.catalog, primary_work: 'Open a bank account', verification_criteria: 'Evidence agrees', human_gate: 'Approval stays human', skills: ['KYC'] };
  return b;
};
const KYC: AnvilDefinitionDto = { anvilTemplateKey: 'kyc-reusable', executionSchemaVersion: 'anvil.template-execution.v2', rubricSummary: '5/2/0 per criterion; 20 criteria mapped to evaluators', roleIds: ['analyst'] };
const VEYRA: AnvilDefinitionDto = { anvilTemplateKey: 'veyra-hush-one-launch', executionSchemaVersion: 'anvil.template-execution.v3', rubricSummary: '0–4 scale, 7 groups, minimum 80; 12 criteria mapped to evaluators', roleIds: ['orchestrator', 'intent', 'performance', 'brief', 'policy'] };

function response(b: HarborBlueprint): BlueprintResponse {
  const problems = sectionProblems(b);
  return { templateId: '00000000-0000-4000-8000-0000000000aa', lineageId: '00000000-0000-4000-8000-0000000000ab', version: 6, templateStatus: 'PUBLISHED', editable: false, blueprint: b, blueprintRevision: 0, problems, validSections: validSectionCount(problems), variantOfId: null };
}
function props(r: BlueprintResponse, anvil: AnvilDefinitionDto | null): MetaCompilerProps {
  return { initial: r, template: { id: r.templateId, workflowName: 'KYC', domainName: 'Banking', version: 6, status: r.templateStatus }, switcher: [{ id: r.templateId, label: 'Banking // KYC (v6)' }], presets: [], jobDescriptions: [], factoryId: null, draftId: null, anvil };
}

beforeEach(() => resetMockStore());

describe('Anvil-defined templates in the Meta-Compiler', () => {
  it('the same empty blueprint shows "to fix" counts for a Harbor template (validator unchanged)', () => {
    const problems = sectionProblems(anvilBlueprint());
    expect(validSectionCount(problems)).toBeLessThan(6);
    const t = text(html(<StageNav problems={problems} active="catalog" onSelect={() => undefined} />));
    expect(t).toMatch(/\d\/6 Valid/);
    expect(t).toMatch(/\d+ to fix/);
    expect(t).not.toContain('Defined by Anvil');
  });

  it('an Anvil template shows "Defined by Anvil" with execution schema, rubric and role ids, and no counter or "to fix" pills', () => {
    const markup = html(<StageNav problems={sectionProblems(anvilBlueprint())} active="catalog" onSelect={() => undefined} anvil={VEYRA} />);
    const t = text(markup);
    expect(t).toContain('Defined by Anvil');
    expect(t).toContain('anvil.template-execution.v3');
    expect(t).toContain('0–4 scale, 7 groups, minimum 80');
    expect(t).toContain('orchestrator, intent, performance, brief, policy');
    expect(t).not.toMatch(/\/6 Valid|to fix|\bValid\b/);
    expect(markup).not.toContain('data-testid="valid-counter"');
    // Still a keyboard tab list so the Admin can read panel 0.
    expect(markup).toContain('role="tablist" aria-orientation="vertical"');
  });

  it('the full Meta-Compiler for an Anvil template hides the stage problems and the "n/6 valid: fix every stage" hint', () => {
    const anvil = text(html(<MetaCompiler {...props(response(anvilBlueprint()), KYC)} />));
    expect(anvil).toContain('Defined by Anvil');
    expect(anvil).toContain('anvil.template-execution.v2');
    expect(anvil).toContain('analyst');
    expect(anvil).not.toMatch(/to fix|\/6 [Vv]alid|Problems in this stage|fix every stage/);
    expect(anvil).toContain('Defined by Anvil: Generate is for Meta-Compiler blueprints.');

    const harbor = text(html(<MetaCompiler {...props(response(anvilBlueprint()), null)} />));
    expect(harbor).toMatch(/to fix/);
    expect(harbor).toMatch(/\d\/6 valid: fix every stage to generate/);
    expect(harbor).not.toContain('Defined by Anvil');
  });

  it('the directory shows "Defined by Anvil" for an Anvil row and "n/6 valid" only for Harbor rows', async () => {
    const harbor = template({ workflowName: 'Launch of Noise Cancelling Phone' });
    const kyc = template({ status: 'PUBLISHED', workflowName: 'KYC', domainId: DOMAIN_BANK, domainName: 'Banking' });
    const r = await handleMock('GET', '/templates/directory', undefined, ctx(['ADMIN'], fixtureSource([harbor, kyc], [project()])));
    const data = TemplateDirectoryResponse.parse(r.body);
    const rows = data.domains.flatMap((d) => d.rows);
    expect(rows.every((x) => x.definedByAnvil === false)).toBe(true);
    // KYC as the API returns it for an Anvil version: no Harbor blueprint, execution defined by Anvil.
    const k = rows.find((x) => x.templateId === kyc.id)!;
    Object.assign(k, { definedByAnvil: true, hasBlueprint: false, validSections: 0 });
    const markup = html(<DirectoryView data={data} />);
    const kycCell = markup.slice(markup.indexOf(`href="/templates/${kyc.id}"`), markup.indexOf('</td>', markup.indexOf(`href="/templates/${kyc.id}"`)));
    expect(text(kycCell)).toContain('Defined by Anvil');
    expect(kycCell).not.toMatch(/\/6 valid/);
    const harborCell = markup.slice(markup.indexOf(`href="/templates/${harbor.id}"`), markup.indexOf('</td>', markup.indexOf(`href="/templates/${harbor.id}"`)));
    expect(text(harborCell)).toContain('6/6 valid');
    expect(harborCell).not.toContain('Defined by Anvil');
    // A PM never sees either label.
    expect(text(html(<DirectoryView data={{ ...data, view: 'PM' }} />))).not.toContain('Defined by Anvil');
  });
});

describe('anvilDefinition: read-only summary of Anvil-owned parts', () => {
  it('summarises v3 (0-4 rubric), v2 (5/2/0 evaluators), an older spec, and returns null without anvilSpec', () => {
    const v3 = { anvil_template_key: 'veyra', execution: { schema_version: 'anvil.template-execution.v3', evaluators: [{}, {}], rubric: { scale: 'zero_to_four', groups: { A: 10, B: 20, C: 15, D: 10, E: 15, F: 15, G: 15 }, minimum: { total: 80, adaptation: 12 } } } };
    expect(anvilDefinition(v3, ['a', 'b'])).toEqual({ anvilTemplateKey: 'veyra', executionSchemaVersion: 'anvil.template-execution.v3', rubricSummary: '0–4 scale, 7 groups, minimum 80; 2 criteria mapped to evaluators', roleIds: ['a', 'b'] });
    expect(anvilRubricSummary({ schema_version: 'anvil.template-execution.v2', evaluators: [{}] })).toBe('5/2/0 per criterion; 1 criterion mapped to evaluators');
    expect(anvilDefinition({ execution: { evaluatorKinds: ['rubric', 'tool_trace'] } }, [])).toEqual({ anvilTemplateKey: null, executionSchemaVersion: null, rubricSummary: 'Evaluator kinds: rubric, tool_trace; 5/2/0 per criterion', roleIds: [] });
    expect(anvilDefinition(null, ['x'])).toBeNull();
    // Summarising never changes Anvil's parts.
    const before = JSON.stringify(v3);
    anvilDefinition(v3, []);
    expect(JSON.stringify(v3)).toBe(before);
  });
});
