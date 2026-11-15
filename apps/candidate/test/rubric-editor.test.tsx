import { emptyOutput, RUBRIC_INTERNAL_ONLY, scoreKeysFor, setFieldValue, TemplateProfileSchema, type RubricCriterionView, type RubricView, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PolicyPicker, identityKeys, type LibraryView } from '@/components/work/policy-picker';
import { DECLARATION_V2, ProfileEditor } from '@/components/work/profile-editor';
import { RubricEditor } from '@/components/work/rubric-editor';
import type { TaskView } from '@/lib/work-types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * The SME task form with RUBRIC_RECOMMENDATIONS_ENABLED (approved mockup docs/design/mockups/sme-task-form.html): the
 * simplified rubric editor (S7), Sources used for this task, the S4 policy picker (D6), the D3 declaration and public
 * names in template help (D5). With the flag off the form is unchanged. KYC v7 synthetic fixture; no network.
 */
const V7 = JSON.parse(readFileSync(new URL('../../api/test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as { authoring: { profile: unknown } };
const PROFILE = TemplateProfileSchema.parse(V7.authoring.profile) as TemplateProfile;
const S7 = PROFILE.sections.find((s) => s.key === 'S7')!;
const S4 = PROFILE.sections.find((s) => s.key === 'S4')!;
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const link = (label: string, over: Partial<RubricCriterionView['links'][number]> = {}): RubricCriterionView['links'][number] => ({ target: `t:${label}`, kind: 'WORKFLOW_STEP', label, excerpt: `${label} excerpt`, snapshot: 'a'.repeat(64), templateId: 't', templateVersion: 2, taskId: 'task', taskRevision: 4, section: 'S5', field: 'steps', state: 'OK', ...over });
const tech = [
  { label: 'Evaluator', value: 'golden-kyc-rubric-v1', note: 'From template' },
  { label: 'Evaluator version', value: '1', note: 'From template' },
  { label: 'Output field', value: '—', note: 'Not used' },
];
function criterion(id: string, over: Partial<RubricCriterionView> = {}): RubricCriterionView {
  return {
    id,
    origin: 'TEMPLATE_DEFAULT',
    exportable: true,
    annotationVersion: 1,
    details: { assesses: `Do ${id}`, applicability: { kind: 'REQUIRED', condition: 'Every application this task covers.', exceptions: '' }, wholeTaskFailure: null, evidenceRequired: 'Run evidence', stepLabel: 'Verify identity', roleLabel: 'The agent', skill: id, why: 'Linked to Workflow · Verify identity.', unresolved: [], covers: [] },
    editedFields: [],
    aiFields: [],
    links: [link('Workflow · Verify identity'), link('S3 · Permitted tools · identity.check', { kind: 'TASK_FIELD' })],
    needs: [],
    sourceChanged: false,
    defaults: { id, name: 'Identity verified', passCondition: 'Each party verified', partialCredit: 'Some parties verified', failCondition: 'No verification' },
    changedFromDefault: [],
    technical: tech,
    howChecked: { text: 'RL Gym scores this from the recorded run with the template’s evaluator golden-kyc-rubric-v1, version 1.', setupNeeded: false },
    proposed: {},
    ...over,
  };
}
const VIEW: RubricView = {
  aiEnabled: false,
  template: { id: 't', version: 2, scale: 'five_two_zero', scoreKeys: scoreKeysFor('five_two_zero'), fixedSet: true, wholeTaskRule: 'In this template, when a whole-task failure criterion scores Fail (0), the whole task fails, whatever the other scores. A Partial doesn’t fail the task.', criterionFailureSupported: true, weightsFromTemplate: true },
  rubric: { section: 'S7', fieldKey: 'criteria' },
  seed: null,
  criteria: [
    criterion('identification_verification', { details: { ...criterion('x').details, wholeTaskFailure: { condition: 'Recommends clearance while identity verification is incomplete.', kind: 'FAIL_OF_CRITERION' } }, aiFields: ['assesses'] }),
    criterion('revision_integrity', { defaults: null, sourceChanged: true, links: [link('S2 · Application input contract', { state: 'CHANGED', currentExcerpt: 'now with document.compare', kind: 'TASK_FIELD', section: 'S2', field: 'inputContract' })] }),
    criterion('account_authority', { defaults: null, needs: ['Policy rule'], details: { ...criterion('x').details, applicability: { kind: 'REQUIRED_WHEN', condition: 'Someone acts for another party.', exceptions: 'A bank officer approves an unproven authority.' } } }),
  ],
  additions: [{ id: 'x-1', name: 'Agent does not grant human approval', status: 'SUGGESTED', internalOnly: true, ai: true, annotationVersion: 1, details: { ...criterion('x').details, applicability: { kind: 'UNSET', condition: '', exceptions: '' } }, links: [link('Workflow · Verify custodian authority')] }],
  sources: { version: 1, items: [{ kind: 'POLICY_DOCUMENT', ref: 'dv1', label: 'Golden Bank custodial policy', detail: 'version rs1.d1 · 3 rules applied', ticked: true, origin: 'DEFAULT' }, { kind: 'TEMPLATE_REFERENCE', ref: 'template:t', label: 'Template references · KYC onboarding and refresh v2', detail: 'tool catalogue, output schema and the rubric evaluator map', ticked: true, origin: 'DEFAULT' }], available: [{ kind: 'TEMPLATE_REFERENCE', ref: 'template:t:federal', label: 'Federal policy references from the template', detail: 'template v2 · read-only', ticked: false, origin: 'DEFAULT' }] },
  coverage: { total: 4, covered: 3, gaps: [{ key: 'rule:r', label: 'S4 · Policy rules · R-SC-1' }], duplicates: [] },
  unused: [],
  run: { id: 'r', mode: 'DERIVED', model: null, createdAt: '2026-11-15T00:00:00Z' },
  history: [{ version: 1, submittedAt: '2026-11-15T00:00:00Z' }],
  internalOnly: RUBRIC_INTERNAL_ONLY,
};
const ITEMS = [
  { id: 'identification_verification', name: 'Identity verified', weight: 5, passCondition: 'Each party verified', partialCredit: 'Some parties verified', failCondition: '', critical: true, evidenceRefs: [], evaluatorKind: 'golden-kyc-rubric-v1', evaluatorVersion: '1', outputField: '', comparison: '', expectedValue: '' },
  { id: 'revision_integrity', name: 'Revisions handled', weight: 5, passCondition: 'Latest version used', partialCredit: 'Noticed', failCondition: 'Stale', critical: false },
  { id: 'account_authority', name: 'Authority', weight: 5, passCondition: 'Verified', partialCredit: 'Noted', failCondition: 'Assumed', critical: false },
];

const editor = (over: Partial<Parameters<typeof RubricEditor>[0]> = {}) =>
  renderToStaticMarkup(<RubricEditor taskId="task" field={S7.fields[0]!} value={ITEMS} onChange={() => undefined} view={VIEW} reload={async () => undefined} readOnly={false} onOpenSource={() => undefined} initialOpen={['identification_verification', 'revision_integrity', 'account_authority']} {...over} />);

describe('simplified rubric editor (S7)', () => {
  it('shows the nine fields in the owner’s order, with template defaults, automatic links and read-only technical settings', () => {
    const t = text(editor());
    const order = ['Criterion name', 'What should the agent do?', 'Derived from', 'When does this apply?', 'How should we score it?', 'Whole-task failure', 'What evidence should support the score?', 'How it will be checked', 'Technical grading settings · From template'];
    // In the first criterion's body, each field follows the one before it.
    let pos = t.indexOf('Criterion name');
    for (const o of order) {
      pos = t.indexOf(o, pos);
      expect(pos, o).toBeGreaterThanOrEqual(0);
    }
    expect(t).toContain('Linked automatically · nothing to maintain');
    expect(t).toContain('Pass · 5');
    expect(t).toContain('Partial · 2');
    expect(t).toContain('Fail · 0');
    expect(t).toContain('Template default');
    expect(t).toContain('golden-kyc-rubric-v1 · From template');
    expect(t).toContain('Output field — · Not used');
    expect(t).toMatch(/doesn’t mean the evaluator is ready in RL Gym/);
    // An SME never types evaluator IDs, versions or output paths (editor AC 1): no inputs for them.
    expect(editor()).not.toMatch(/aria-label="(Evaluator|Output field|Comparison|Expected value)/);
  });

  it('whole-task failure states its condition and the template’s rule; AI suggestions are labelled', () => {
    const t = text(editor());
    expect(t).toContain('Make this a whole-task failure when…');
    expect(editor()).toContain('Recommends clearance while identity verification is incomplete.');
    expect(t).toContain('It’s what a Fail on this criterion means Supported');
    expect(t).toContain('A Partial doesn’t fail the task.');
    expect(t).toContain('AI suggestion');
  });

  it('flags Source changed, Source link needed, Evaluation setup needed and the to-finish list', () => {
    const t = text(editor());
    expect(t).toContain('Source changed — check rubric');
    expect(t).toContain('Reviewed, keep as is');
    expect(t).toContain('now with document.compare');
    expect(t).toContain('Source link needed · Policy rule');
    expect(t).toContain('Evaluation setup needed');
    expect(t).toContain('Internal only · not sent to RL Gym');
    expect(t).toMatch(/Still to finish \(\d+\)/);
    expect(t).toContain('Fail description missing');
    expect(t).toContain('Not covered by any criterion: S4 · Policy rules · R-SC-1');
  });

  it('conditional applicability shows Not applicable / Unknown wording; read-only mode has no edit controls', () => {
    expect(text(editor())).toContain('When it doesn’t apply: Not applicable, never full marks');
    const ro = editor({ readOnly: true });
    expect(text(ro)).not.toContain('Refresh suggestions');
    expect(text(ro)).not.toContain('Reviewed, keep as is');
    expect(text(ro)).not.toContain('Add another source');
  });

  it('Sources used for this task are real checkboxes, ticked by default, with Add another source', () => {
    const html = editor();
    expect(text(html)).toContain('Sources used for this task');
    expect((html.match(/type="checkbox" class="mt-1"( disabled="")? checked=""/g) ?? []).length).toBe(2);
    expect(text(html)).toContain('Add another source');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('S4 policy picker (D6)', () => {
  const LIB: LibraryView = { setVersion: 1, documents: [{ documentVersionId: 'dv1', title: 'Golden Bank custodial policy', jurisdiction: 'US-TX', category: 'Bank policy', effectiveFrom: '2026-01-01', policyId: 'doc-1', version: 'rs1.d1', publicationRef: 'project rule set v1', sha256: 'b'.repeat(64), rules: [{ ruleKey: 'R-ID-1', ruleVersionId: 'rv', title: 'Verify', requirement: 'Verify', marking: 'Mandatory', appliesWhen: null }] }] };
  const field = S4.fields[0]!;
  it('reads identity keys from the template’s item fields', () => {
    expect(identityKeys(field)).toMatchObject({ id: 'ruleId', version: 'ruleVersion', locator: 'locator', sha: 'contentSha256' });
    expect(identityKeys(field).notes.map((f) => f.key)).toEqual(['appliesTo', 'rationale', 'exception']);
  });
  it('shows picked references read-only (identity from the library) and only the notes as editable', () => {
    const html = renderToStaticMarkup(<PolicyPicker taskId="t" field={field} value={[{ ruleId: 'doc-1', ruleVersion: 'rs1.d1', locator: 'project rule set v1', contentSha256: 'b'.repeat(64), appliesTo: '', rationale: '', exception: '' }]} onChange={() => undefined} readOnly={false} initialLibrary={LIB} />);
    const t = text(html);
    expect(t).toContain('Golden Bank custodial policy');
    expect(t).toContain('Published');
    expect(t).toContain('Policy ID 🔒 doc-1');
    expect(t).toContain('bbbbbbbbbbbbbbbb…bbbbbbbb');
    expect((html.match(/<textarea/g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/<input[^>]*value="doc-1"/);
    expect(t).toContain('Add policy');
  });
  it('empty state: no published policies, nothing to type', () => {
    const t = text(renderToStaticMarkup(<PolicyPicker taskId="t" field={field} value={[]} onChange={() => undefined} readOnly={false} initialLibrary={{ setVersion: null, documents: [] }} />));
    expect(t).toContain('This project has no published policies yet.');
    expect(t).toContain('Ask your project admin to add policies');
    expect(t).not.toContain('Add policy');
  });
});

describe('task form with and without the flag', () => {
  function task(formV2: boolean): TaskView {
    let out = emptyOutput(PROFILE);
    out = setFieldValue(PROFILE, out, 'S1', 'applicationType', 'custodial');
    return { id: '00000000-0000-4000-8000-000000000010', status: 'IN_PROGRESS', taskType: 'AUTHORING', brief: null, isOpenSlot: false, assignedAt: null, submittedAt: null, activeSeconds: 0, revision: 1, projectId: 'p', projectName: 'KYC v7', tptMinutes: 45, definition: 'generic', template: { workflow: PROFILE.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null }, input: {}, output: out, coverageTags: null, checks: null, readOnly: false, review: null, formV2 } as TaskView;
  }
  const form = (formV2: boolean, section: number) => text(renderToStaticMarkup(<ProfileEditor task={task(formV2)} profile={PROFILE} onSubmitted={() => undefined} initialSection={section} initialRubric={formV2 ? VIEW : null} initialLibrary={{ setVersion: null, documents: [] }} />));

  it('template help shows RL Gym, never the internal name, with or without the flag (D5)', () => {
    for (const on of [true, false]) {
      expect(form(on, 1)).toContain('RL Gym assigns one isolated application snapshot');
      expect(form(on, 1)).not.toMatch(/Anvil|Praxis|ADI-Labs/);
    }
  });

  it('S7 is the simplified editor when on, and the old repeated list when off', () => {
    expect(form(true, 6)).toContain('Sources used for this task');
    expect(form(false, 6)).not.toContain('Sources used for this task');
    expect(form(false, 6)).toContain('Add item');
  });

  it('S8 shows the ticked sources and the D3 declaration text exactly', () => {
    const on = form(true, 7);
    expect(on).toContain('Sources used for this task Golden Bank custodial policy');
    expect(DECLARATION_V2).toBe('I won’t use real customer, employer or account information.');
    expect(on).toContain('Not covered by any criterion');
    expect(form(false, 7)).not.toContain('Sources used for this task');
  });
});
