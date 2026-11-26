import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewQueuePanel, confirmable, tableRows, type QueueRow } from '@/components/policy/review-queue';
import { filterOptions, filterQueue, NO_FILTERS, NO_JURISDICTION, readyRows, ruleHref } from '@/components/policy/queue-logic';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * KYC Judgment v1 A3 (owner, 25 Nov 2026) and D-092 (owner, 26 Nov 2026): the PM's review queue as a table. Each row has
 * its rule, document, jurisdiction, status and the next action in plain words, linking to the rule page at that field;
 * filters by document, next action, jurisdiction and status; 25 a page; "Confirm all ready" within the filter.
 * Synthetic data only.
 */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const FED = { id: 'd-fed', title: 'Federal policy' };
const CA = { id: 'd-ca', title: 'California rules' };
const row = (over: Partial<QueueRow>): QueueRow => ({
  ruleId: 'r1',
  ruleKey: 'R-TIN',
  version: 1,
  state: 'DRAFT',
  contentHash: 'a'.repeat(64),
  title: 'Taxpayer ID',
  requirement: 'Each applicant must give a taxpayer ID.',
  conditionText: 'Process is account_opening',
  library: { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } },
  jurisdiction: 'US',
  documents: [FED],
  quotes: [{ fieldPath: 'requirement', role: 'supports', quote: 'Each applicant must give a taxpayer ID.', resolution: 'RESOLVED', document: 'Federal policy' }],
  coverage: null,
  flags: [],
  nextAction: { code: 'ready', label: 'Ready to confirm', focus: null },
  ...over,
});
const LIB = { code: 'fill_library', label: 'Fill in library details', focus: 'library' };
const items = [
  row({}),
  row({ ruleId: 'r2', ruleKey: 'R-CA-ID', title: 'California ID', jurisdiction: 'US-CA', documents: [CA], flags: [{ code: 'library_incomplete', message: 'Missing for the policy library: issuer.' }], nextAction: LIB }),
  row({ ruleId: 'r3', ruleKey: 'R-CA-AGE', title: 'Teen age', state: 'NEEDS_DEFINITION', jurisdiction: null, documents: [CA], flags: [{ code: 'condition_not_set', message: 'Set when the rule applies.' }], nextAction: { code: 'set_condition', label: 'Set when it applies', focus: 'condition' } }),
];

describe('review queue table (console)', () => {
  it('shows rule, document, jurisdiction, status and next action; a flagged row links to its page at that field', () => {
    const html = renderToStaticMarkup(<ReviewQueuePanel projectId="p" initial={{ items, projectFlags: [{ code: 'us_person_undefined', message: 'No approved rule defines “US person”: approve R-US-PERSON-DEFINITION.', rule: { ruleId: 'rus', ruleKey: 'R-US-PERSON-DEFINITION' } }], flagged: 2, total: 3, studioConnected: true, approvalRoute: 'review_queue' }} />);
    const t = text(html);
    expect(t).toContain('Review queue');
    expect(t).toContain('3 rules to review, 2 with something to do first');
    for (const h of ['Rule', 'Document', 'Jurisdiction', 'Status', 'Next action']) expect(html).toContain(`<th scope="col"${h === 'Rule' ? ' class="py-1"' : ''}>${h}</th>`);
    expect(t).toContain('Ready to confirm');
    expect(html).toContain('href="/projects/p/policy/rules/r2?focus=library"');
    expect(t).toContain('Fill in library details');
    expect(html).toContain('href="/projects/p/policy/rules/r3?focus=condition"');
    expect(t).toContain('Needs definition');
    expect(t).toContain('None set');
    // The US-person warning names the rule and links to its page at "defines".
    expect(t).toContain('approve R-US-PERSON-DEFINITION');
    expect(html).toContain('href="/projects/p/policy/rules/rus?focus=defines"');
    expect(t).toContain('Confirm all ready (1)');
    expect(t).toContain('Check coverage with Studio');
    expect(t).toContain('AI suggestions are not approval');
    // The AI suggestions step lives in the queue, scoped to the document filter, estimate first.
    expect(t).toContain('Suggest library details (AI)');
    expect(t).toContain('Working out the estimate');
    // No per-row tick, and no annotation columns.
    expect(html).not.toContain('Apply to project');
    expect(html).not.toContain('Mandatory marking');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('filters by document, next action, jurisdiction, status and text; options carry counts', () => {
    const rows = tableRows(items);
    expect(filterQueue(rows, { ...NO_FILTERS, documentId: 'd-ca' }).map((r) => r.ruleKey)).toEqual(['R-CA-ID', 'R-CA-AGE']);
    expect(filterQueue(rows, { ...NO_FILTERS, action: 'fill_library' }).map((r) => r.ruleKey)).toEqual(['R-CA-ID']);
    expect(filterQueue(rows, { ...NO_FILTERS, jurisdiction: NO_JURISDICTION }).map((r) => r.ruleKey)).toEqual(['R-CA-AGE']);
    expect(filterQueue(rows, { ...NO_FILTERS, jurisdiction: 'US' }).map((r) => r.ruleKey)).toEqual(['R-TIN']);
    expect(filterQueue(rows, { ...NO_FILTERS, status: 'NEEDS_DEFINITION' }).map((r) => r.ruleKey)).toEqual(['R-CA-AGE']);
    expect(filterQueue(rows, { ...NO_FILTERS, q: 'teen' }).map((r) => r.ruleKey)).toEqual(['R-CA-AGE']);
    const o = filterOptions(rows);
    expect(o.documents).toEqual([{ value: 'd-ca', label: 'California rules', count: 2 }, { value: 'd-fed', label: 'Federal policy', count: 1 }]);
    expect(o.actions.map((a) => [a.value, a.count])).toEqual([['ready', 1], ['fill_library', 1], ['set_condition', 1]]);
    expect(o.statuses.map((s) => s.label)).toEqual(['Draft', 'Needs definition']);
  });

  it('“Confirm all ready” takes only unflagged rows within the current filter', () => {
    const rows = tableRows(items);
    expect(readyRows(rows).map((r) => r.ruleId)).toEqual(['r1']);
    expect(readyRows(filterQueue(rows, { ...NO_FILTERS, documentId: 'd-ca' }))).toEqual([]);
    expect(confirmable([row({}), row({ ruleId: 'r2', flags: [{ code: 'x', message: 'y' }] })]).map((r) => r.ruleId)).toEqual(['r1']);
    expect(ruleHref('p', { ruleId: 'r9', nextAction: { code: 'ready', label: 'Ready to confirm', focus: null } })).toBe('/projects/p/policy/rules/r9');
  });

  it('pages 25 rules at a time; an empty queue says so', () => {
    const many = Array.from({ length: 30 }, (_, i) => row({ ruleId: `r${i}`, ruleKey: `R-${String(i).padStart(2, '0')}` }));
    const html = renderToStaticMarkup(<ReviewQueuePanel projectId="p" initial={{ items: many, flagged: 0, total: 30, studioConnected: false }} />);
    expect((html.match(/data-next-action=/g) ?? []).length).toBe(25);
    expect(text(html)).toContain('Confirm all ready (30)');
    expect(text(renderToStaticMarkup(<ReviewQueuePanel projectId="p" initial={{ items: [], flagged: 0, total: 0, studioConnected: false }} />))).toContain('No draft rules to review.');
  });
});
