import { PolicyRuleBody } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { setRuleApplied } from '@/components/policy/apply-rule';
import { RuleDetail, type RuleDetailData } from '@/components/policy/rule-detail';
import { RulesTable, type RulesTableRule } from '@/components/policy/rules-table';
import { applySteps, rulesForDocument, visibleRules, type Suggestion } from '@/components/policy/rules-table-logic';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const rule = (over: Partial<RulesTableRule> = {}): RulesTableRule => ({
  ruleId: 'r1',
  ruleKey: 'R-JOINT-CIP',
  title: 'Joint holder CIP',
  required: true,
  state: 'DRAFT',
  applied: false,
  documentIds: ['d1'],
  definitionProblems: [],
  evidenceProblems: [],
  versionId: 'v1',
  version: 1,
  contentHash: 'a'.repeat(64),
  requirement: 'Every joint account holder must pass full CIP.',
  evidence: { quote: 'Each joint holder must pass full CIP.', resolution: 'RESOLVED', document: 'SEED — Federal KYC policy', documentVersion: 1 },
  ...over,
});
const sugg = (entries: Array<[string, boolean]>) => new Map<string, Suggestion>(entries.map(([k, m]) => [k, { ruleKey: k, match: m, reason: m ? 'Joint accounts.' : 'Not relevant.' }]));

describe('Issue 2: rules table selection (PR-M01, PR-M02)', () => {
  const rules = [rule(), rule({ ruleId: 'r2', ruleKey: 'R-MINOR', documentIds: ['d1'] }), rule({ ruleId: 'r3', ruleKey: 'R-CA', documentIds: ['d2'] }), rule({ ruleId: 'r4', ruleKey: 'R-APPLIED', applied: true, state: 'REVIEWED' })];

  it('shows the rules of the chosen document', () => {
    expect(rulesForDocument(rules, 'd2').map((r) => r.ruleKey)).toEqual(['R-CA']);
    expect(rulesForDocument(rules, 'd1')).toHaveLength(3);
  });

  it('shows all rules without a prompt; with one, the suggested rules plus those already applied', () => {
    const d1 = rulesForDocument(rules, 'd1');
    expect(visibleRules(d1, null, false)).toHaveLength(3);
    const s = sugg([['R-JOINT-CIP', false], ['R-MINOR', true], ['R-APPLIED', false]]);
    expect(visibleRules(d1, s, false).map((r) => r.ruleKey)).toEqual(['R-MINOR', 'R-APPLIED']);
    expect(visibleRules(d1, s, true).map((r) => r.ruleKey)).toEqual(['R-MINOR', 'R-JOINT-CIP', 'R-APPLIED']);
  });

  it('knows what ticking needs first: an AI definition for missing fields, a confirmation for unverified evidence', () => {
    expect(applySteps(rule())).toEqual({ define: false, confirmEvidence: false });
    expect(applySteps(rule({ definitionProblems: ['Choose a type.'], evidenceProblems: ['Link the requirement.'] }))).toEqual({ define: true, confirmEvidence: true });
  });

  it('renders the dropdown, prompt box and the four columns, with the rule name as a link and accessible checkboxes', () => {
    const html = renderToStaticMarkup(
      <RulesTable projectId="p1" documents={[{ id: 'd1', title: 'SEED — Federal KYC policy' }, { id: 'd2', title: 'SEED — CA addendum' }]} rules={[rule(), rule({ ruleId: 'r2', ruleKey: 'R-BAD', title: 'Beneficial owner CIP', evidence: { quote: 'a beneficial owner who is also a signer must pass full CIP .', resolution: 'QUOTE_MISMATCH', document: 'SEED — Federal KYC policy', documentVersion: 1 }, evidenceProblems: ['Link the requirement to a quote found in the source document.'] }), rule({ ruleId: 'r3', ruleKey: 'R-CA', documentIds: ['d2'] })]} />,
    );
    expect(html).toContain('Policy document');
    expect(html).toMatch(/<option value="d1"[^>]*>SEED — Federal KYC policy<\/option>/);
    expect(html).toContain('Which rules does this template need?');
    expect(html).toContain('KYC for single, joint and minor accounts');
    for (const h of ['Rule name', 'Evidence', 'Required', 'Apply to project']) expect(html).toContain(`>${h}</th>`);
    expect(html).toContain('href="/projects/p1/policy/rules/r1"');
    expect(html).toContain('aria-label="Apply Joint holder CIP to the project"');
    expect(html).toContain('Quote not found in the document — check it before applying.');
    expect(html).not.toContain('R-CA');
    expect(html).toContain('2 rules from this document.');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('Apply to project flow (PR-M04..M06)', () => {
  type Call = [string, string, unknown];
  const fake = (responses: Record<string, unknown>) => {
    const calls: Call[] = [];
    const call = async <T,>(method: 'POST' | 'PUT', path: string, body?: unknown) => {
      calls.push([method, path, body]);
      const key = Object.keys(responses).find((k) => path.endsWith(k))!;
      return { ok: true, status: 200, data: responses[key] as T, error: null };
    };
    return { calls, call };
  };
  const target = { ruleId: 'r1', contentHash: 'a'.repeat(64), definitionProblems: [] as string[], evidenceProblems: [] as string[] };

  it('a complete rule is applied in one call; unticking sends applied=false', async () => {
    const f = fake({ '/applied': { applied: true, warnings: [] } });
    expect(await setRuleApplied('p1', target, true, { call: f.call })).toEqual({ kind: 'done', applied: true, warnings: [] });
    expect(f.calls).toEqual([['PUT', '/projects/p1/policy/rules/r1/applied', { applied: true, expectedContentHash: 'a'.repeat(64) }]]);
    const g = fake({ '/applied': { applied: false, warnings: [] } });
    await setRuleApplied('p1', target, false, { call: g.call });
    expect(g.calls[0]![2]).toMatchObject({ applied: false });
  });

  it('defines a rule with gaps first, then applies the new content', async () => {
    const f = fake({ '/define': { contentHash: 'b'.repeat(64), definitionProblems: [], evidenceProblems: [] }, '/applied': { applied: true, warnings: [] } });
    const stages: string[] = [];
    await setRuleApplied('p1', { ...target, definitionProblems: ['Choose a type.'] }, true, { call: f.call, onStage: (s) => stages.push(s) });
    expect(f.calls.map((c) => c[1])).toEqual(['/projects/p1/policy/rules/r1/define', '/projects/p1/policy/rules/r1/applied']);
    expect(f.calls[1]![2]).toMatchObject({ expectedContentHash: 'b'.repeat(64) });
    expect(stages).toEqual(['Defining with AI…', 'Applying…']);
  });

  it('asks the PM to confirm unverified evidence before applying, and sends the confirmation', async () => {
    const f = fake({ '/applied': { applied: true, warnings: ['Link the requirement.'] } });
    const t = { ...target, evidenceProblems: ['Link the requirement.'] };
    const first = await setRuleApplied('p1', t, true, { call: f.call });
    expect(first).toMatchObject({ kind: 'confirm', problems: ['Link the requirement.'] });
    expect(f.calls).toHaveLength(0);
    await setRuleApplied('p1', t, true, { call: f.call, acceptUnverifiedEvidence: true });
    expect(f.calls[0]![2]).toMatchObject({ acceptUnverifiedEvidence: true });
  });
});

describe('rule page (PR-M07)', () => {
  const d: RuleDetailData = {
    ruleId: 'r1',
    ruleKey: 'R-SIGNER-BENEFICIAL-OWNER-CIP',
    required: true,
    versionId: 'v1',
    version: 1,
    state: 'DRAFT',
    applied: false,
    contentHash: 'a'.repeat(64),
    body: PolicyRuleBody.parse({ title: 'Signer beneficial-owner CIP', requirement: 'A beneficial owner who is also a signer must pass full CIP.', requirementType: 'obligation', applicability: { actors: ['beneficial owner', 'signer', 'bank'], actions: ['complete CIP'], jurisdictions: ['US-Federal'] }, exceptions: { kind: 'listed', items: [{ statement: 'Existing customers verified within 12 months', conditions: null }] }, effective: { conditionText: 'always' }, evidenceNeeds: ['CIP record'] }),
    excludeReason: null,
    reviewedAt: null,
    origin: 'extraction',
    definitionProblems: [],
    evidenceProblems: ['Link the requirement to a quote found in the source document.'],
    citations: [{ id: 'c1', fieldPath: 'requirement', role: 'supports', quote: 'a beneficial owner who is also a signer must pass full CIP .', locator: {}, resolution: 'QUOTE_MISMATCH', documentVersionId: 'dv1', document: 'SEED — Federal KYC policy', documentVersion: 1, sha256: 'a5c0aa26'.padEnd(64, '0') }],
    history: [{ id: 'v1', version: 1, state: 'DRAFT', origin: 'extraction', reviewedAt: null, createdAt: '2026-11-14T10:00:00Z' }],
  };

  it('shows every field formatted, the evidence with its verification, history and the actions', () => {
    const html = renderToStaticMarkup(<RuleDetail projectId="p1" d={d} />);
    for (const t of ['Requirement', 'Type', 'Who sees it', 'Applies to', 'Prerequisites', 'Exceptions', 'Effective', 'Precedence', 'Required evidence', 'Suggested check (hint)']) expect(html).toContain(`>${t}</dt>`);
    expect(html).toContain('Obligation (must)');
    expect(html).toContain('US-Federal');
    expect(html).toContain('Existing customers verified within 12 months');
    expect(html).toContain('Quote NOT found in this version — check it');
    expect(html).toContain('Draft — not applied');
    expect(html).toContain('Apply to project');
    expect(html).toContain('Define with AI');
    expect(html).toContain('Your tick is the review; no further approval is needed.');
    expect(html).toContain('Edit fields and quotes');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('an applied rule shows as applied and offers no AI redefinition', () => {
    const html = renderToStaticMarkup(<RuleDetail projectId="p1" d={{ ...d, state: 'REVIEWED', applied: true, reviewedAt: '2026-11-14T11:00:00Z' }} />);
    expect(html).toContain('Applied to the project (reviewed)');
    expect(html).not.toContain('Define with AI');
  });
});
