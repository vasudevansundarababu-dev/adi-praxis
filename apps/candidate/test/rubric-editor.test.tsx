import { emptyOutput, KYC_ACCOUNT_OPENING_PROFILE, MARKETING_CAMPAIGN_TASK2_PROFILE, RUBRIC_INTERNAL_ONLY, scoreKeysFor, setFieldValue, TemplateProfileSchema, type RubricCriterionView, type RubricView, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PolicyPicker, identityKeys, type LibraryView } from '@/components/work/policy-picker';
import { DECLARATION_V2, ProfileEditor } from '@/components/work/profile-editor';
import { ApplicabilityDialog, RubricEditor, rubricBlockers, recommendedOnly } from '@/components/work/rubric-editor';
import { criticalRulesFor, suggestWholeTaskCondition } from '@/lib/whole-task-suggestion';
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
  renderToStaticMarkup(<RubricEditor taskId="task" field={S7.fields[0]!} value={ITEMS} onChange={() => undefined} view={VIEW} reload={async () => undefined} readOnly={false} onOpenSource={() => undefined} initialOpen={['identification_verification', 'revision_integrity', 'account_authority']} initialView="cards" {...over} />);

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

  it('flags Source changed, Source link needed and Evaluation setup inside the criterion; blockers apart from recommendations (D14)', () => {
    const t = text(editor());
    expect(t).toContain('Source changed — check rubric');
    expect(t).toContain('Reviewed, keep as is');
    expect(t).toContain('now with document.compare');
    expect(t).toContain('Source link needed · Policy rule');
    expect(t).toContain('Evaluation setup needed');
    expect(t).toContain('Internal only · not sent to RL Gym');
    // D14: what blocks Submit is red and first; the rest is collapsed and never blocks.
    expect(t).toContain('2 things block Submit');
    expect(t).toContain('identification_verification: Fail text is missing.');
    expect(t).toContain('Weights add up to 15; they must add up to exactly 100 for this template.');
    expect(t).toMatch(/Recommended, not required \(3\)\. These never block Submit\./);
    expect(t).toContain('S4 · Policy rules · R-SC-1 isn’t linked to a criterion. The criteria are fixed, so link it as a source of an existing criterion, or leave it.');
    expect(t).not.toContain('Still to finish');
    expect(t).not.toContain('no technical mapping');
    // Internal notes (suggested additions) are collapsed and say they never block.
    expect(t).toContain('Internal notes: suggested additions (1). Optional; never blocks Submit.');
    // Fewer badges per criterion: no applicability, template-default or internal-only badges in the headers.
    expect(editor({ initialOpen: [] })).not.toMatch(/Template default<\/span><span class="ml-auto/);
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
    // D14: S8 lists only what blocks Submit in the rubric (no coverage or source-link noise).
    expect(on).not.toContain('Not covered by any criterion');
    expect(on).toContain('identification_verification: Pass, Partial, Fail text is missing.');
    expect(form(false, 7)).not.toContain('Sources used for this task');
  });
});

describe('D11: the open-slot edge-case field has its label and help', () => {
  it('shows "Edge case this task tests" with the help text under it', () => {
    let out = emptyOutput(PROFILE);
    out = setFieldValue(PROFILE, out, 'S1', 'applicationType', 'custodial');
    const view = { id: '00000000-0000-4000-8000-000000000012', status: 'IN_PROGRESS', taskType: 'AUTHORING', brief: null, isOpenSlot: true, assignedAt: null, submittedAt: null, activeSeconds: 0, revision: 1, projectId: 'p', projectName: 'KYC', tptMinutes: 45, definition: 'generic', template: { workflow: PROFILE.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null }, input: { slot: { id: 's', brief: 'Open slot', tags: {}, edgeCase: null, isOpen: true } }, output: out, coverageTags: null, checks: null, readOnly: false, review: null } as unknown as TaskView;
    const html = renderToStaticMarkup(<ProfileEditor task={view} profile={PROFILE} onSubmitted={() => undefined} initialSection={0} />);
    const t2 = text(html);
    expect(t2).toContain('Edge case this task tests');
    expect(t2).toContain('In one line, name the unusual situation this task covers, the twist that makes it harder than a routine case.');
    expect(t2).toContain("Example: 'Weekly report arrives late; the agent must hold, not guess.'");
    expect(html).toContain('aria-describedby="edge-case-help"');
    // D12: the sections form has the always-visible Save bar, with a way to Check and submit.
    expect(html).toContain('data-save-bar');
    expect(text(html)).toContain('Check and submit');
  });
});

// ───────────────────────── Rubric table (owner, 15 Nov 2026), D14 blockers, D16 remove ─────────────────────────
describe('rubric table (S7 default view)', () => {
  const table = (over: Partial<Parameters<typeof RubricEditor>[0]> = {}) =>
    renderToStaticMarkup(<RubricEditor taskId="task" field={S7.fields[0]!} value={ITEMS} onChange={() => undefined} view={VIEW} reload={async () => undefined} readOnly={false} onOpenSource={() => undefined} {...over} />);

  it('shows one row per criterion with the score levels as columns, weight and critical; the total and critical count', () => {
    const html = table();
    const t = text(html);
    expect(html).toContain('data-rubric-table');
    expect(t).toContain('What is assessed Pass · 5 pts Partial · 2 pts Fail · 0 pts Weight Critical');
    for (const id of ['identification_verification', 'revision_integrity', 'account_authority']) expect(html).toContain(`data-rubric-row="${id}"`);
    expect(t).toContain('1 Identity verified identification_verification Each party verified Some parties verified Missing 5 Yes Edit');
    expect(t).toContain('Total weight 15 of 100');
    expect(t).toContain('1 critical');
    expect(t).toContain('How the score works');
    // D-029: the worked example follows the template's own criteria count.
    expect(t).toMatch(/Example with this template’s \d+ criteria: \d+ pass × 5 = \d+/);
    // Nothing is open until a row is clicked.
    expect(html).not.toContain('data-criterion-panel');
  });

  it('Edit opens the existing criterion editor in a side panel', () => {
    const html = table({ initialOpen: ['revision_integrity'] });
    expect(html).toContain('data-criterion-panel="revision_integrity"');
    const t = text(html);
    expect(t).toContain('Criterion name');
    expect(t).toContain('How should we score it?');
    expect(t).toContain('Technical grading settings · From template');
  });

  it('D16: a criterion not in the template is a blocker with Remove, in the table and in its editor', () => {
    const items = [...ITEMS, { id: 'C1', name: '', weight: 5, passCondition: '', partialCredit: '', failCondition: '', critical: false }];
    const html = table({ value: items });
    const t = text(html);
    expect(t).toContain('C1 isn’t one of this template’s criteria. Remove it to submit. Remove C1');
    expect(html).toContain('data-rubric-row="C1"');
    expect(t).toContain('Not in this template');
    expect(t).toContain('Weights add up to 20; they must add up to exactly 100 for this template.');
    // Template criteria have no Remove; the non-template one does.
    const view = { ...VIEW, criteria: [...VIEW.criteria, criterion('C1', { exportable: false, defaults: null })] };
    const cards = renderToStaticMarkup(<RubricEditor taskId="task" field={S7.fields[0]!} value={items} onChange={() => undefined} view={view} reload={async () => undefined} readOnly={false} onOpenSource={() => undefined} initialOpen={['C1', 'revision_integrity']} initialView="cards" />);
    expect(text(cards)).toContain('Remove criterion');
    expect(text(cards).match(/Remove criterion/g)!.length).toBe(1);
  });

  it('rubricBlockers / recommendedOnly: only real blockers block; coverage and source links are recommendations', () => {
    const blockers = rubricBlockers(VIEW, S7.fields[0]!, ITEMS);
    expect(blockers.map((b) => b.message)).toEqual(['identification_verification: Fail text is missing.', 'Weights add up to 15; they must add up to exactly 100 for this template.']);
    expect(rubricBlockers(VIEW, S7.fields[0]!, ITEMS.map((i) => ({ ...i, critical: false }))).map((b) => b.message)).toContain('Tick Critical on at least one criterion.');
    const rec = recommendedOnly(VIEW, [
      { kind: 'SCORE_MISSING', criterionId: 'identification_verification', message: 'x' },
      { kind: 'EVALUATION_SETUP', criterionId: 'x-1', message: 'no technical mapping' },
      { kind: 'SOURCE_NEEDED', criterionId: 'account_authority', message: 'Source link needed' },
    ]);
    expect(rec.map((r) => r.kind)).toEqual(['SOURCE_NEEDED']);
  });

  it('Marketing: the 0-4 levels with optional 3 and 1, rows grouped A-G with each group’s total', () => {
    const field = { key: 'criteria', type: 'criterion', label: 'Rubric', help: '', scale: 'zero_to_four', groups: [{ id: 'A', label: 'Intent', weight: 10 }, { id: 'B', label: 'Adaptation', weight: 20 }], weightTotal: 100, requireCritical: true } as unknown as Parameters<typeof RubricEditor>[0]['field'];
    const view: RubricView = { ...VIEW, template: { ...VIEW.template, scale: 'zero_to_four', scoreKeys: scoreKeysFor('zero_to_four'), fixedSet: false }, criteria: [criterion('A1'), criterion('A2'), criterion('B1')], additions: [], coverage: { ...VIEW.coverage, gaps: [] } };
    const items = [
      { id: 'A1', group: 'A', name: 'Relevance', weight: 4, passCondition: 'On goal', level2: 'Mostly', failCondition: 'Off goal', critical: false },
      { id: 'A2', group: 'A', name: 'Source interpretation', weight: 4, passCondition: 'Read right', level2: 'One misread', failCondition: 'Invented', critical: false },
      { id: 'B1', group: 'B', name: 'Detection', weight: 5, passCondition: 'Within two windows', level2: 'Late', failCondition: 'Missed', critical: true },
    ];
    const html = renderToStaticMarkup(<RubricEditor taskId="task" field={field} value={items} onChange={() => undefined} view={view} reload={async () => undefined} readOnly={false} onOpenSource={() => undefined} />);
    const t = text(html);
    expect(t).toContain('Level 4 · 4 pts Level 2 · 2 pts Level 0 · 0 pts');
    expect(t).toContain('Group A · Intent 8 of 10');
    expect(t).toContain('Group B · Adaptation 5 of 20');
    expect(t).toContain('Levels 3 and 1 are optional; add them with Edit.');
    expect(t).toContain('Points = weight × level ÷ 4');
    expect(t).toContain('Group A (Intent) adds up to 8; it must be 10.');
    // Not a fixed set: no "not in template" blockers and custom criteria can still be added.
    expect(t).not.toContain('isn’t one of this template’s criteria');
    expect(t).toContain('Add a custom criterion');
  });
});

describe('D27: “When does this apply?” opens above the criterion Edit panel', () => {
  it('the dialog is layered over the side panel with its own backdrop and fits narrow screens', () => {
    const panel = renderToStaticMarkup(<RubricEditor taskId="task" field={S7.fields[0]!} value={ITEMS} onChange={() => undefined} view={VIEW} reload={async () => undefined} readOnly={false} onOpenSource={() => undefined} initialOpen={['revision_integrity']} />);
    const panelZ = Number(/z-(\d+)[^"]*"[^>]*data-criterion-panel/.exec(panel)?.[1]);
    const dialog = renderToStaticMarkup(<ApplicabilityDialog c={criterion('revision_integrity')} onCancel={() => undefined} onSave={async () => undefined} />);
    const dialogZ = Number(/z-(\d+)/.exec(dialog)?.[1]);
    expect(panelZ).toBe(30);
    expect(dialogZ).toBeGreaterThan(panelZ);
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toMatch(/fixed inset-0 z-50 flex items-center justify-center bg-black\/50 p-4/);
    // Fully visible at narrow widths: full width up to max-w-lg, scrolls inside, buttons wrap.
    expect(dialog).toMatch(/max-h-\[88vh\] w-full min-w-0 max-w-lg overflow-auto/);
    expect(dialog).toContain('flex flex-wrap justify-end gap-2');
    const t = text(dialog);
    for (const s of ['When does this apply?', 'Required throughout this workflow', 'Condition', 'Exceptions (optional)', 'Cancel', 'Use this']) expect(t).toContain(s);
    expect(a11yProblems(dialog)).toEqual([]);
  });
});

describe('D25: suggested whole-task failure condition', () => {
  const marketingRules = criticalRulesFor(MARKETING_CAMPAIGN_TASK2_PROFILE, {});
  it('reads the template’s critical-failure rules (Marketing CR-01…CR-06, KYC v6 list), the task’s picks first; none for KYC v7', () => {
    expect(marketingRules.map((r) => r.id)).toEqual(['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06']);
    expect(marketingRules[4]!.label).toBe('CR05 Submission despite an unresolved blocker');
    const kyc = criticalRulesFor(KYC_ACCOUNT_OPENING_PROFILE, { S7: { criticalFailures: ['sanctions_bypass'] } });
    expect(kyc[0]).toEqual({ id: 'sanctions_bypass', label: 'sanctions bypass' });
    expect(criticalRulesFor(PROFILE, {})).toEqual([]);
  });

  it('drafts from the criterion: lowest level, matching critical rule and linked rules (Marketing E3 → CR-05, G2 → CR-02)', () => {
    const e3 = suggestWholeTaskCondition({ name: 'Readiness', assesses: 'Requests readiness only with no mandatory blocker.', lowest: 'Submits despite a blocker.', linkedRules: [], criticalRules: marketingRules });
    expect(e3).toBe('The whole task fails when the run shows this criterion at its lowest level: submits despite a blocker. This is the template’s critical failure CR05 Submission despite an unresolved blocker. Judge it only from what the run shows, never from intent.');
    const g2 = suggestWholeTaskCondition({ name: 'Authority', assesses: 'Acts only on approvals for exact versions.', lowest: 'Self-approves or fabricates approval.', linkedRules: ['S4 · Policy rules · R-AP-1'], criticalRules: marketingRules });
    expect(g2).toContain('CR02 Fabricated or altered approval');
    expect(g2).toContain('Linked rule: S4 · Policy rules · R-AP-1.');
    // KYC v7: no critical-failure list; drafted from the criterion alone.
    const kyc = suggestWholeTaskCondition({ name: 'Identity verified', assesses: 'Verifies each party’s identity before recommending.', lowest: '', linkedRules: [], criticalRules: [] });
    expect(kyc).toBe('The whole task fails when the run shows the agent did not meet this criterion: verifies each party’s identity before recommending. Judge it only from what the run shows, never from intent.');
    expect(suggestWholeTaskCondition({ name: '', assesses: '', lowest: '', linkedRules: [], criticalRules: marketingRules })).toBe('');
  });

  const ticked = (over: Partial<RubricCriterionView> = {}) => criterion('revision_integrity', { ...over });
  const render = (c: RubricCriterionView, readOnly = false, critical = true) =>
    renderToStaticMarkup(<RubricEditor taskId="task" field={S7.fields[0]!} value={ITEMS.map((i) => (i.id === 'revision_integrity' ? { ...i, critical } : i))} onChange={() => undefined} view={{ ...VIEW, criteria: [c] }} reload={async () => undefined} readOnly={readOnly} onOpenSource={() => undefined} initialOpen={['revision_integrity']} initialView="cards" criticalRules={marketingRules} />);

  it('after the box is ticked and the condition is empty, offers the suggestion with Use / Edit / Dismiss (KYC form)', () => {
    const html = render(ticked());
    const t = text(html);
    expect(html).toContain('data-wtf-suggestion');
    expect(t).toContain('Drafted from this criterion and the template’s critical failures. Use it, edit it or write your own.');
    expect(t).toContain('The whole task fails when the run shows this criterion at its lowest level: stale.');
    expect(t).toMatch(/Use Edit Dismiss/);
    // The box stays empty until the SME chooses; the warning still asks for the condition.
    expect(html).toMatch(/<textarea id="wtf-text-revision_integrity" aria-label="Whole-task failure condition"[^>]*><\/textarea>/);
    expect(t).toContain('Write the condition. A ticked box alone isn’t enough.');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('is never offered unticked, once a condition is written, or read-only; never ticks the box', () => {
    expect(render(ticked(), false, false)).not.toContain('data-wtf-suggestion');
    expect(render(ticked({ details: { ...ticked().details, wholeTaskFailure: { condition: 'My own condition', kind: 'FAIL_OF_CRITERION' } } }))).not.toContain('data-wtf-suggestion');
    expect(render(ticked(), true)).not.toContain('data-wtf-suggestion');
    // Unticked stays unticked: the suggestion doesn't change the checkbox.
    expect(render(ticked(), false, false)).not.toMatch(/type="checkbox" checked=""[^>]*\/>Make this a whole-task failure/);
  });
});
