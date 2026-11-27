import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterFacts, originText, queueForFact, typeText, undescribed, type FactRow } from '@/components/policy/facts-logic';
import { filterQueue, NO_FILTERS, type QueueTableRow } from '@/components/policy/queue-logic';

// The Policy page's fact list (owner, 26 Nov 2026): read-only table, search, 10 a page (D-120), "Used by" links to the queue's fact filter.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }), notFound: () => { throw new Error('NOT_FOUND'); }, redirect: () => undefined }));
const api = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));
vi.mock('@/lib/api', () => ({
  apiGet: async (path: string) => (path in api.routes ? { status: 200, data: api.routes[path] } : { status: 404, data: null }),
  getCurrentUser: async () => ({ id: 'u1', name: 'Pat PM', roles: ['PROJECT_MANAGER'] }),
}));

const fact = (o: Partial<FactRow> = {}): FactRow => ({ id: 'product', label: 'Product', description: null, type: 'enum', allowedValues: ['individual', 'teen_joint'], cardinality: 'one', origin: 'case_data', sourceField: null, definedBy: null, usedBy: 0, ...o });

describe('fact list helpers', () => {
  it('searches the variable, the label and the description', () => {
    const rows = [fact(), fact({ id: 'us_person', label: null, description: 'A US citizen or resident.', origin: 'derived' })];
    expect(filterFacts(rows, 'US_PERS').map((r) => r.id)).toEqual(['us_person']);
    expect(filterFacts(rows, 'citizen').map((r) => r.id)).toEqual(['us_person']);
    expect(filterFacts(rows, 'product').map((r) => r.id)).toEqual(['product']);
    expect(filterFacts(rows, ' ')).toHaveLength(2);
  });
  it('says the type with its values, and where the fact comes from', () => {
    expect(typeText(fact())).toBe('enum: individual, teen_joint');
    expect(typeText(fact({ type: 'boolean', allowedValues: [] }))).toBe('boolean');
    expect(typeText(fact({ type: 'enum', cardinality: 'many', allowedValues: ['a'] }))).toBe('enum (one or more): a');
    expect(originText(fact())).toBe('Case data (a field of each case)');
    expect(originText(fact({ sourceField: 'case.product' }))).toBe('Case field case.product');
    expect(originText(fact({ origin: 'derived', definedBy: { ruleId: 'r1', ruleKey: 'R-US-PERSON-DEFINITION' } }))).toBe('Derived: defined by rule R-US-PERSON-DEFINITION');
  });
  it('links "Used by" to the review queue filtered to the fact, and lists facts without a description', () => {
    expect(queueForFact('p1', 'us_person')).toBe('/projects/p1/policy?fact=us_person#review-queue');
    expect(undescribed([fact(), fact({ id: 'x', description: 'Has one.' })])).toEqual(['product']);
  });
  it('the queue fact filter keeps only rules whose condition names the fact', () => {
    const row = (ruleKey: string, facts: string[]): QueueTableRow => ({ ruleId: ruleKey, ruleKey, title: ruleKey, state: 'DRAFT', contentHash: 'h', jurisdiction: 'US', documents: [], nextAction: { code: 'ready', label: 'Ready', focus: null }, flags: [], facts });
    const rows = [row('R-1', ['product']), row('R-2', ['us_person', 'product']), row('R-3', [])];
    expect(filterQueue(rows, { ...NO_FILTERS, fact: 'us_person' }).map((r) => r.ruleKey)).toEqual(['R-2']);
    expect(filterQueue(rows, { ...NO_FILTERS, fact: 'product' }).map((r) => r.ruleKey)).toEqual(['R-1', 'R-2']);
    expect(filterQueue(rows, NO_FILTERS)).toHaveLength(3);
  });
});

describe('Policy page server render with the fact list', () => {
  const P = '00000000-0000-4000-8000-000000000001';
  beforeEach(() => {
    const facts = Array.from({ length: 30 }, (_, i) => fact({ id: `fact_${String(i).padStart(2, '0')}`, label: `Fact ${i}`, usedBy: i === 0 ? 2 : 0 }));
    facts.push(fact({ id: 'us_person', label: null, description: 'Derived from citizenship.', type: 'boolean', allowedValues: [], origin: 'derived', definedBy: { ruleId: 'r-us', ruleKey: 'R-US-PERSON-DEFINITION' } }));
    api.routes = {
      [`/projects/${P}`]: { id: P, name: 'KYC Judgment' },
      [`/projects/${P}/policy/documents`]: { maxPages: 20, items: [] },
      [`/projects/${P}/policy/rules`]: { items: [] },
      [`/projects/${P}/policy/review-queue`]: { items: [{ ruleId: 'r1', ruleKey: 'R-1', version: 1, state: 'DRAFT', contentHash: 'h', title: 'One', requirement: 'x', conditionText: 'Not set yet.', library: null, jurisdiction: 'US', documents: [], quotes: [], coverage: null, flags: [], nextAction: { code: 'ready', label: 'Ready', focus: null }, facts: ['us_person'] }], flagged: 0, total: 1, studioConnected: false, approvalRoute: 'review_queue', counts: { rules: 1, approved: 0, excluded: 0 } },
      [`/projects/${P}/policy/fact-catalog`]: { catalog: { catalog_id: 'kyc-judgment-openenv.facts', facts: facts.slice(0, 30) }, version: 1 },
      [`/projects/${P}/policy/library-exports`]: { items: [] },
      [`/projects/${P}/policy/enrichment`]: { status: 'none' },
      [`/projects/${P}/policy/facts`]: { catalogId: 'kyc-judgment-openenv.facts', version: 1, items: facts },
    };
  });
  const render = async (sp: Record<string, string> = {}) => {
    const { default: Page } = await import('../app/(console)/projects/[id]/policy/page');
    return renderToStaticMarkup((await Page({ params: Promise.resolve({ id: P }), searchParams: Promise.resolve(sp) })) as React.ReactElement).replace(/&amp;/g, '&');
  };

  it('renders the Facts step with the fact table: 10 a page, columns, "No description", derived origin and Used by link', async () => {
    const out = await render();
    expect(out).toContain('See the fact list (31)');
    for (const h of ['Variable', 'Description', 'Type and allowed values', 'Where it comes from', 'Used by']) expect(out).toContain(`>${h}</th>`);
    expect(out.match(/data-fact="/g)).toHaveLength(10);
    expect(out).toContain('No description');
    expect(out).toContain(`href="/projects/${P}/policy?fact=fact_00#review-queue"`);
    expect(out).toContain('2 rules');
  });
  it('shows the same help the Support Bot answers from', async () => {
    const out = await render();
    expect(out).toContain('How this page works');
    expect(out).toContain('WHAT IS A FACT');
    expect(out).toContain('NEXT ACTION &quot;SET WHEN IT APPLIES&quot;');
  });
  it('opens with the queue filtered to a fact from ?fact=', async () => {
    const out = await render({ fact: 'us_person' });
    expect(out).toContain('data-fact-filter="us_person"');
    expect(out).toMatch(/<details[^>]*open/);
  });
});
