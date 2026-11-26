import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canExclude, canRestore, inForceText, quoteGroups } from '@/components/policy/rule-library-logic';

// D-094 (owner, 26 Nov 2026): the KYC Judgment rule page shows only what the policy library and the run use.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }), notFound: () => { throw new Error('NOT_FOUND'); }, redirect: () => undefined }));
const api = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));
vi.mock('@/lib/api', () => ({
  apiGet: async (path: string) => (path in api.routes ? { status: 200, data: api.routes[path] } : { status: 404, data: null }),
  getCurrentUser: async () => ({ id: 'u1', name: 'Pat PM', roles: ['PM'] }),
}));

const P = '00000000-0000-4000-8000-000000000001';
const R = '00000000-0000-4000-8000-000000000002';
const body = {
  title: 'Elsewhere teen joint account age',
  requirement: 'A teen joint account is for a minor aged 16 or younger.',
  requirementType: 'obligation',
  visibility: 'agent_visible',
  applicability: { universal: false, actors: ['agent'], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
  prerequisites: ['Some prerequisite'],
  exceptions: { kind: 'unknown', items: [] },
  effective: { from: null, to: null, conditionText: null },
  precedence: [],
  evidenceNeeds: ['ID'],
  verificationHint: 'Check the age',
  uncertainty: [],
  condition: { all: [{ fact: 'product', op: 'eq', value: 'teen_joint' }, { fact: 'party_role', op: 'eq', value: 'minor' }] },
  library: { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } },
  annotation: { marking: 'mandatory', openQuestions: ['Which section is "elsewhere"?'] },
};
const rule = (route: 'review_queue' | 'apply_tick', state = 'DRAFT') => ({
  ruleId: R,
  ruleKey: 'R-ELSEWHERE-TEEN-JOINT-ACCOUNT-AGE',
  required: false,
  versionId: '00000000-0000-4000-8000-000000000003',
  version: 1,
  state,
  applied: state === 'REVIEWED',
  contentHash: 'a'.repeat(64),
  body,
  excludeReason: state === 'EXCLUDED' ? 'Duplicate of R-TEEN-AGE' : null,
  reviewedAt: null,
  origin: 'extraction',
  definitionProblems: [],
  evidenceProblems: [],
  citations: [{ id: 'c1', fieldPath: 'requirement', role: 'supports', quote: 'teen joint account is for a minor aged 16 or younger', locator: { page: 3 }, resolution: 'RESOLVED', documentVersionId: 'dv', document: 'BANK-OPERATING-RULES-DRAFT.md', documentVersion: 1, sha256: 'b'.repeat(64) }],
  history: [{ id: 'h1', version: 1, state, origin: 'extraction', reviewedAt: null, createdAt: '2026-11-26T20:00:00Z' }],
  annotation: { marking: 'mandatory', appliesWhen: null, why: null, classification: 'obligation', responsibleActor: 'unknown', applicationTypes: { kind: 'unknown', items: [] }, jurisdictions: { kind: 'unknown', items: [] }, workflowStage: null, deadline: { kind: 'unknown' }, evidence: { status: 'unknown', missing: [] }, links: [], openQuestions: ['Which section is "elsewhere"?'], version: 1 },
  annotationHistory: [],
  approvalRoute: route,
  queueFlags: [{ code: 'condition_not_quoted', message: 'No quote from the source says when this rule applies.' }],
  nextAction: { code: 'link_quote', label: 'Link to a source quote', focus: 'quote' },
  library: route === 'review_queue' ? { conditionSet: true, conditionText: 'Product is Teen joint, and Party role is Minor', conditionFacts: ['product', 'party_role'], inForce: { from: '2026-01-01', source: 'document' } } : null,
});

const render = async () => {
  const { default: Page } = await import('../app/(console)/projects/[id]/policy/rules/[ruleId]/page');
  return renderToStaticMarkup((await Page({ params: Promise.resolve({ id: P, ruleId: R }) })) as React.ReactElement).replace(/&amp;/g, '&');
};

describe('D-094 rule page, server render', () => {
  beforeEach(() => {
    api.routes = { [`/projects/${P}`]: { id: P, name: 'KYC Judgment' } };
  });

  it('a KYC Judgment rule shows only what the library and the run use', async () => {
    api.routes[`/projects/${P}/policy/rules/${R}`] = rule('review_queue');
    const out = await render();
    for (const s of ['data-library-rule', 'Next action: <strong>Link to a source quote</strong>', 'Requirement and source', 'The source says', 'Quote found word for word', 'When it applies', 'Product is Teen joint, and Party role is Minor', 'party_role', 'In force from 2026-01-01 (its document’s date)', 'Library details', 'Version history', 'Exclude', 'Edit the text, the in-force date and the quotes']) expect(out, s).toContain(s);
    for (const s of ['Annotation', 'Mandatory marking', 'Define with AI', 'Who sees it', 'Prerequisites', 'Precedence', 'Required evidence', 'Suggested check', 'Responsible actor', 'Apply to project']) expect(out, s).not.toContain(s);
  });

  it('an excluded rule shows its reason and can be brought back', async () => {
    api.routes[`/projects/${P}/policy/rules/${R}`] = rule('review_queue', 'EXCLUDED');
    const out = await render();
    expect(out).toContain('Excluded: Duplicate of R-TEEN-AGE');
    expect(out).toContain('Bring back for review');
    expect(out).not.toContain('>Exclude</button>');
  });

  it('every other project keeps the page exactly as before', async () => {
    api.routes[`/projects/${P}/policy/rules/${R}`] = rule('apply_tick');
    const out = await render();
    for (const s of ['Annotation', 'Mandatory marking', 'Define with AI', 'Who sees it', 'Apply to project']) expect(out, s).toContain(s);
    expect(out).not.toContain('data-library-rule');
  });
});

describe('D-094 helpers', () => {
  it('groups the requirement quotes first and says where the in-force date comes from', () => {
    const g = quoteGroups([{ fieldPath: 'applicability.conditionText' }, { fieldPath: 'requirement' }]);
    expect(g.requirement.map((c) => c.fieldPath)).toEqual(['requirement']);
    expect(g.other.map((c) => c.fieldPath)).toEqual(['applicability.conditionText']);
    expect(inForceText({ from: '2026-02-01', source: 'rule' })).toBe('In force from 2026-02-01 (this rule’s own date).');
    expect(inForceText(null)).toMatch(/^No in-force date yet/);
  });
  it('excludes drafts only and brings back excluded rules only', () => {
    expect([canExclude('DRAFT'), canExclude('NEEDS_DEFINITION'), canExclude('REVIEWED'), canExclude('EXCLUDED')]).toEqual([true, true, false, false]);
    expect([canRestore('EXCLUDED'), canRestore('DRAFT')]).toEqual([true, false]);
  });
});
