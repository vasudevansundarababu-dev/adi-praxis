import { PolicyRuleBody, RuleAnnotation, annotationFlags } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applicationTypeOptions, blankAnnotation, byMarking, forApplication, sourceLabel, withMarking } from '@/components/policy/annotation-logic';
import { RuleDetail, type RuleDetailData } from '@/components/policy/rule-detail';
import { RulesTable, type RulesTableRule } from '@/components/policy/rules-table';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** Policy rule annotations on the Rules page and the rule page (PRD-POLICY-RULE-ANNOTATIONS §4, AC6–AC9). */
const ann = (over: Partial<RuleAnnotation> = {}) =>
  RuleAnnotation.parse({ classification: 'permission', marking: 'permitted_option', appliesWhen: 'A foreign passport is selected for the identification route.', why: 'Accepting the passport is permitted; “only with” makes the accompanying non-documentary check compulsory.', responsibleActor: 'agent', applicationTypes: { kind: 'all', items: [] }, jurisdictions: { kind: 'listed', items: ['US'] }, ...over });

const row = (over: Partial<RulesTableRule> = {}): RulesTableRule => ({
  ruleId: 'r1',
  ruleKey: 'R-FOREIGN-PASSPORT',
  title: 'Foreign passport',
  required: true,
  state: 'DRAFT',
  applied: false,
  documentIds: ['d1'],
  definitionProblems: [],
  evidenceProblems: [],
  versionId: 'v1',
  version: 1,
  contentHash: 'a'.repeat(64),
  requirement: 'The bank may accept a foreign passport.',
  evidence: { quote: 'The bank may accept a foreign passport only with a non-documentary check.', resolution: 'RESOLVED', document: 'Synthetic KYC policy', documentVersion: 1 },
  annotation: ann(),
  annotationSource: { source: 'AI_SUGGESTION', editedRole: 'PM', at: '2026-11-15T10:00:00Z', model: 'mock-policy-1' },
  pendingAiSuggestion: null,
  flags: annotationFlags(ann()),
  ...over,
});

describe('Rules page annotations (AC6, AC8)', () => {
  it('AC6: every row shows an editable Mandatory marking, Applies when and Why, labelled as an AI suggestion', () => {
    const missing = ann({ marking: 'needs_clarification', classification: 'unresolved', appliesWhen: null, why: null, openQuestions: ['Is “should” binding here?'] });
    const rows = [row(), row({ ruleId: 'r2', ruleKey: 'R-UNANNOTATED', title: 'Unannotated rule', annotation: null, annotationSource: null, flags: annotationFlags(null) }), row({ ruleId: 'r3', ruleKey: 'R-SHOULD', title: 'Should rule', annotation: missing, flags: annotationFlags(missing), annotationSource: { source: 'AUTHOR_EDIT', editedRole: 'ADMIN', at: '2026-11-15T10:00:00Z', model: null } })];
    const html = renderToStaticMarkup(<RulesTable projectId="p1" documents={[{ id: 'd1', title: 'Synthetic KYC policy' }]} rules={rows} />);
    for (const h of ['Mandatory marking', 'Applies when', 'Why']) expect(html).toContain(`>${h}</th>`);
    expect(html).toContain('aria-label="Mandatory marking for Foreign passport"');
    expect(html).toMatch(/<option value="permitted_option" selected="">Permitted option<\/option>/);
    expect(html).toContain('A foreign passport is selected for the identification route.');
    expect(html).toContain('“only with” makes the accompanying non-documentary check compulsory');
    expect(html).toContain('AI suggestion · v1');
    // Not annotated: shown, with every marking available to choose.
    expect(html).toContain('aria-label="Mandatory marking for Unannotated rule"');
    expect(html).toContain('<option value="" selected="">Not annotated</option>');
    // AC8: missing details and open questions are flagged visibly.
    expect(html).toContain('Edited by Admin · v1');
    expect(html).toContain('⚠ Unknown: classification, when it applies, why, deadline, evidence.');
    expect(html).toContain('⚠ Needs clarification before it can be applied reliably.');
    expect(html).toContain('⚠ Is “should” binding here?');
    expect(html).toContain('>Unknown</span>');
    expect(html).toContain('Suggest annotations with AI');
    expect(html).toContain('AI annotations are suggestions; your edit and your Apply tick are the decision.');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('offers a pending AI suggestion without replacing the author’s annotation', () => {
    const pending = { id: 'rev9', annotationVersion: 3, model: 'mock-policy-1', createdAt: '2026-11-15T11:00:00Z', annotation: ann({ marking: 'mandatory' }) };
    const html = renderToStaticMarkup(<RulesTable projectId="p1" documents={[{ id: 'd1', title: 'Synthetic KYC policy' }]} rules={[row({ annotationSource: { source: 'AUTHOR_EDIT', editedRole: 'PM', at: '', model: null }, pendingAiSuggestion: pending })]} />);
    expect(html).toContain('Use AI suggestion (Mandatory)');
    expect(html).toContain('Edited by PM · v1');
  });

  it('filters by marking and by flags; an inline marking change keeps every other field', () => {
    const rows = [row(), row({ ruleKey: 'R-B', annotation: null, flags: annotationFlags(null) }), row({ ruleKey: 'R-C', annotation: ann({ marking: 'mandatory' }) })];
    expect(byMarking(rows, 'permitted_option').map((r) => r.ruleKey)).toEqual(['R-FOREIGN-PASSPORT']);
    expect(byMarking(rows, 'not_annotated').map((r) => r.ruleKey)).toEqual(['R-B']);
    expect(byMarking(rows, 'flagged').map((r) => r.ruleKey)).toEqual(['R-B']);
    const changed = withMarking(ann(), 'mandatory');
    expect(changed).toMatchObject({ marking: 'mandatory', why: ann().why, appliesWhen: ann().appliesWhen });
    expect('version' in changed).toBe(false);
    expect(blankAnnotation('permitted_option')).toMatchObject({ classification: 'permission', appliesWhen: null, why: null, responsibleActor: 'unknown' });
    expect(sourceLabel({ ruleKey: 'x', annotation: null })).toBe('Not annotated');
  });
});

describe('Show rules for an application (AC9)', () => {
  const caJoint = row({ ruleKey: 'R-CA-JOINT', annotation: ann({ marking: 'mandatory_when_applicable', applicationTypes: { kind: 'listed', items: ['adult_joint', 'teen_joint'] }, jurisdictions: { kind: 'listed', items: ['US-CA'] } }) });
  const nyRule = row({ ruleKey: 'R-NY', annotation: ann({ marking: 'mandatory', jurisdictions: { kind: 'listed', items: ['US-NY'] } }) });
  const federal = row({ ruleKey: 'R-FED', annotation: ann({ marking: 'mandatory' }) });
  const unknown = row({ ruleKey: 'R-UNKNOWN', annotation: ann({ jurisdictions: { kind: 'unknown', items: [] } }) });

  it('a California Joint application keeps the Joint and California rules on a project whose examples use New York', () => {
    const out = forApplication([caJoint, nyRule, federal, unknown], { applicationType: 'adult_joint', governingState: 'CA' });
    expect(out.map((r) => [r.ruleKey, r.outcome])).toEqual([['R-CA-JOINT', 'trigger_to_check'], ['R-FED', 'applies'], ['R-UNKNOWN', 'unknown']]);
    expect(applicationTypeOptions([caJoint, federal])).toEqual(['adult_joint', 'teen_joint']);
  });
});

describe('rule page annotation, history and source (AC6, AC7)', () => {
  const a = ann({ version: 2, marking: 'mandatory_when_applicable', compound: { groupKey: 'C-1', originalStatement: 'The bank may accept a foreign passport only with a non-documentary check.', role: 'companion' }, links: [{ ruleKey: 'R-FOREIGN-PASSPORT', relation: 'companion_of', note: null }] });
  const d: RuleDetailData = {
    ruleId: 'r2',
    ruleKey: 'R-FOREIGN-NDC',
    required: true,
    versionId: 'v2',
    version: 2,
    state: 'DRAFT',
    applied: false,
    contentHash: 'b'.repeat(64),
    body: PolicyRuleBody.parse({ title: 'Non-documentary check', requirement: 'Perform a non-documentary check when a foreign passport is accepted.', requirementType: 'obligation', annotation: a }),
    excludeReason: null,
    reviewedAt: null,
    origin: 'edit',
    definitionProblems: [],
    evidenceProblems: [],
    citations: [{ id: 'c1', fieldPath: 'requirement', role: 'supports', quote: 'The bank may accept a foreign passport only with a non-documentary check.', locator: { lineStart: 3, lineEnd: 3 }, resolution: 'RESOLVED', documentVersionId: 'dv1', document: 'Synthetic KYC policy', documentVersion: 1, sha256: 'c'.repeat(64) }],
    history: [{ id: 'v2', version: 2, state: 'DRAFT', origin: 'edit', reviewedAt: null, createdAt: '2026-11-15T10:00:00Z' }],
    annotation: a,
    annotationSource: { source: 'AUTHOR_EDIT', editedRole: 'PM', at: '2026-11-15T10:05:00Z', model: null },
    flags: annotationFlags(a),
    linkedFrom: [{ ruleKey: 'R-FOREIGN-PASSPORT', relation: 'companion_of' }],
    annotationHistory: [
      { id: 'h2', annotationVersion: 2, source: 'AUTHOR_EDIT', adopted: true, model: null, editedRole: 'PM', createdAt: '2026-11-15T10:05:00Z', ruleVersionId: 'v2', annotation: a },
      { id: 'h1', annotationVersion: 1, source: 'AI_SUGGESTION', adopted: true, model: 'mock-policy-1', editedRole: 'PM', createdAt: '2026-11-15T10:00:00Z', ruleVersionId: 'v2', annotation: ann({ marking: 'mandatory' }) },
    ],
    applicationTypeOptions: ['individual', 'adult_joint'],
    projectRuleKeys: ['R-FOREIGN-NDC', 'R-FOREIGN-PASSPORT'],
  };

  it('shows the marking, applies when, why, the compound statement, the source passage and the full annotation history', () => {
    const html = renderToStaticMarkup(<RuleDetail projectId="p1" d={d} />);
    expect(html).toContain('Mandatory marking: <strong>Mandatory when applicable</strong>');
    for (const t of ['Mandatory marking', 'Applies when', 'Why', 'Classification', 'Responsible actor', 'Application types', 'Jurisdictions', 'Workflow stage', 'Deadline', 'Evidence', 'Linked rules', 'Compound statement', 'Open questions']) expect(html).toContain(`>${t}</dt>`);
    expect(html).toContain('The bank may accept a foreign passport only with a non-documentary check.');
    expect(html).toContain('Linked from: R-FOREIGN-PASSPORT (companion of)');
    expect(html).toContain('Annotation history');
    expect(html).toContain('AI suggestion (mock-policy-1)');
    expect(html).toContain('Edit by PM');
    expect(html).toContain('>Current</td>');
    expect(html).toContain('The source quotation is never changed by an annotation edit.');
    expect(html).toContain('Edit annotation');
    expect(html).toContain('aria-label="Edit annotation"');
    expect(html).not.toContain('Required: ');
    expect(a11yProblems(html)).toEqual([]);
  });
});
