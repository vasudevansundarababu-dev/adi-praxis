import { BLUEPRINT_SECTIONS, HarborBlueprint, sectionProblems, TemplateDirectoryResponse, validSectionCount, type CustomField, type SmeAuthoredTaskDto } from '@praxis/shared';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ElicitationAssistant } from '@/components/templates/compiler/assistant';
import { BlueprintSummary } from '@/components/templates/compiler/blueprint-summary';
import { CustomFieldForm } from '@/components/templates/compiler/custom-field-dialog';
import { Inspector, StageNav } from '@/components/templates/compiler/inspector';
import { MetaCompiler } from '@/components/templates/compiler/meta-compiler';
import { StageEditor } from '@/components/templates/compiler/stage-editors';
import { Pipeline } from '@/components/templates/deploy/pipeline';
import { DirectoryView } from '@/components/templates/directory/directory-view';
import { McHeader } from '@/components/templates/mc-header';
import { TaskStore } from '@/components/templates/tasks/task-store';
import { generateArtifacts } from '@/lib/mc/artifacts';
import { sampleBlueprintInput } from '@/lib/mc/fixtures';
import { handleMock, resetMockStore } from '@/lib/mc/mock-backend';
import { a11yProblems } from './a11y';
import { ctx, fixtureSource, html, project, template } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const ok = (el: ReactElement) => expect(a11yProblems(html(el))).toEqual([]);
const bp = () => HarborBlueprint.parse(sampleBlueprintInput());
const field = (over: Partial<CustomField> = {}): CustomField => ({ field_id: 'holiday_cpm', label: 'Holiday CPM', input_type: 'number_input', options: [], default_value: 1.8, inject_into: ['mcp_mock.py'], verifier_assertion: '', ...over });

describe('NFR-10 static checker', () => {
  it('flags the problems it is meant to catch', () => {
    const p = a11yProblems('<div><input id="a"/><button></button><a href="/x"></a><img src="i.png"/><span id="d"></span><span id="d"></span><p aria-describedby="nope" tabindex="2"></p></div>');
    expect([...p].sort()).toEqual([
      'img without alt: src="i.png"',
      'positive tabindex on <p>',
      'button without an accessible name: <button>',
      'link without an accessible name: href="/x"',
      'form control without a label: <input id="a">',
      'duplicate id "d" (2 times)',
      'aria-describedby="nope" points at no element',
    ].sort());
    expect(a11yProblems('<label>Name <input/></label><label for="b">B</label><select id="b"></select><button aria-label="Close"><svg></svg></button>')).toEqual([]);
  });
});

describe('NFR-10 Screen 1 directory', () => {
  it('Admin and PM views', async () => {
    resetMockStore();
    const t = template();
    const source = fixtureSource([t, template({ status: 'PUBLISHED', workflowName: 'KYB' })]);
    for (const roles of [['ADMIN'], ['PM']]) {
      const data = TemplateDirectoryResponse.parse((await handleMock('GET', '/templates/directory', undefined, ctx(roles, source))).body);
      ok(<DirectoryView data={data} />);
    }
    ok(<McHeader isAdmin active={{ workflowName: 'KYB', version: 2, href: '/templates/x' }} />);
  });
});

describe('NFR-10 Screen 2 Meta-Compiler', () => {
  const b = bp();
  const problems = sectionProblems(b);
  const initial = { templateId: '00000000-0000-4000-8000-0000000000aa', lineageId: '00000000-0000-4000-8000-0000000000ab', version: 1, templateStatus: 'DRAFT' as const, editable: true, blueprint: b, blueprintRevision: 1, problems, validSections: validSectionCount(problems), variantOfId: null };

  it('full editor, every stage editor, the stage navigator and inspector tabs', () => {
    ok(<MetaCompiler initial={initial} template={{ id: initial.templateId, workflowName: 'Launch', domainName: 'Digital Marketing', version: 1, status: 'DRAFT' }} switcher={[{ id: initial.templateId, label: 'Digital Marketing // Launch (v1)' }]} presets={[]} jobDescriptions={[]} factoryId={null} draftId={null} />);
    for (const s of BLUEPRINT_SECTIONS) ok(<StageEditor section={s} bp={b} onChange={() => undefined} jobDescriptions={[{ id: '00000000-0000-4000-8000-0000000000ac', title: 'Synthetic JD' }]} />);
    ok(
      <div>
        <StageNav problems={problems} active="stage_2" onSelect={() => undefined} />
        <div id="mc-stage-panel" />
      </div>,
    );
    for (const tab of ['uispec', 'prompt', 'pytest'] as const) ok(<Inspector artifacts={generateArtifacts(b, null)} counters={{ dropzones: 2, mcp: 2, customFields: 2 }} initialTab={tab} />);
  });

  it('custom-field dialog for every input type, the assistant and the PM summary', () => {
    for (const input_type of ['number_input', 'currency_slider', 'single_select', 'multi_select', 'boolean_toggle', 'text_input'] as const) {
      ok(<CustomFieldForm bp={b} stage="stage_3" initial={field({ input_type, options: input_type.endsWith('select') ? ['A', 'B'] : [], min: 0, max: 10 })} onSave={() => undefined} onCancel={() => undefined} />);
    }
    ok(<CustomFieldForm bp={b} stage="stage_1" initial={null} onSave={() => undefined} onCancel={() => undefined} />);
    const common = { presets: [{ id: '00000000-0000-4000-8000-0000000000ff', label: 'UBO hop depth', field: field(), sortOrder: 0, active: true }], disabled: false, stageLabel: '3. Mock Env', propose: (async () => ({ ok: true, data: null, error: null })) as never, check: () => [], onInsertPreset: () => undefined, onAccept: () => undefined, onEdit: () => undefined, onManual: () => undefined };
    ok(<ElicitationAssistant {...common} />);
    ok(<ElicitationAssistant {...common} initialResult={{ proposal: field(), problems: [], provider: 'mock', model: 'mock-drafter', costUsd: 0, unavailableReason: null }} />);
    ok(<BlueprintSummary bp={b} templateId="00000000-0000-4000-8000-0000000000aa" />);
  });
});

describe('NFR-10 Screen 3 pipeline and task store', () => {
  const p = project();
  const targets = [{ id: p.id, name: p.name, templateVersion: 1, smes: [{ candidateId: '00000000-0000-4000-8000-0000000000e1', displayName: 'Synthetic SME', email: 'sme@example.test' }] }];
  const models = { items: [{ provider: 'claude' as const, model: 'claude-sonnet-5', label: 'Claude', available: true }], liveAi: true, codegenEnabled: false };

  it('pipeline before and after a run', () => {
    ok(<Pipeline templateId="00000000-0000-4000-8000-0000000000aa" models={models} targets={targets} deployments={[]} initialGeneration={null} initialVerification={null} />);
    ok(<Pipeline templateId="00000000-0000-4000-8000-0000000000aa" models={models} targets={[]} deployments={[]} initialGeneration={null} initialVerification={null} />);
  });

  it('task store', () => {
    const task = { id: '00000000-0000-4000-8000-00000000a201', externalTaskId: 'TASK-1', title: 'Synthetic', workflowName: 'Launch', templateVersion: 1, projectName: 'P', authoredBy: null, bundleSha256: 'a'.repeat(64), zeroBaselineScore: 0, oracleScore: 1, dataClassification: 'SYNTHETIC', executionMode: 'HERMETIC_MCP', reviewStatus: 'SUBMITTED' } as SmeAuthoredTaskDto;
    ok(<TaskStore tasks={[task]} />);
    ok(<TaskStore tasks={[]} />);
  });
});
