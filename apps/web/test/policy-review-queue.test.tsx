import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewQueuePanel, confirmable, type QueueRow } from '@/components/policy/review-queue';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * KYC Judgment v1 A3 (owner, 25 Nov 2026): the PM's review queue on the Policies page. Each draft shows its text and
 * condition beside the source quote; flagged rules are read one by one; unflagged rules can be confirmed together, and
 * the PM's confirm is the approval. Synthetic data only.
 */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const row = (over: Partial<QueueRow>): QueueRow => ({
  ruleId: 'r1',
  ruleKey: 'R-TIN',
  version: 1,
  contentHash: 'a'.repeat(64),
  title: 'Taxpayer ID',
  requirement: 'Each applicant must give a taxpayer ID.',
  conditionText: 'Process is account_opening',
  library: { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } },
  quotes: [{ fieldPath: 'requirement', role: 'supports', quote: 'Each applicant must give a taxpayer ID.', resolution: 'RESOLVED', document: 'Synthetic bank policy' }],
  coverage: null,
  flags: [],
  ...over,
});

describe('review queue (console)', () => {
  it('shows each rule’s text and condition beside its source quote, with the AI-filled library details and the flags', () => {
    const flagged = row({ ruleId: 'r2', ruleKey: 'R-CA-ID', title: 'California ID', flags: [{ code: 'condition_not_quoted', message: 'No quote from the source says when this rule applies.' }] });
    const html = renderToStaticMarkup(<ReviewQueuePanel projectId="p" initial={{ items: [flagged, row({})], flagged: 1, total: 2, studioConnected: true }} />);
    const t = text(html);
    expect(t).toContain('Review queue');
    expect(t).toContain('2 rules to review, 1 flagged');
    expect(t).toContain('Each applicant must give a taxpayer ID.');
    expect(t).toContain('Applies when: Process is account_opening');
    expect(t).toContain('Source quote');
    expect(t).toContain('policy · bank · US · party · account_opening');
    expect(t).toContain('No quote from the source says when this rule applies.');
    // A flagged rule opens its page; only unflagged rules get a checkbox.
    expect(html).toContain('href="/projects/p/policy/rules/r2"');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(1);
    expect(t).toContain('Confirm selected (0)');
    expect(t).toContain('AI suggestions are not approval');
    expect(t).toContain('Check coverage with Studio');
    expect(t).toContain('Suggest library details');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('only unflagged rules can be confirmed together; an empty queue says so', () => {
    expect(confirmable([row({}), row({ ruleId: 'r2', flags: [{ code: 'x', message: 'y' }] })]).map((r) => r.ruleId)).toEqual(['r1']);
    expect(text(renderToStaticMarkup(<ReviewQueuePanel projectId="p" initial={{ items: [], flagged: 0, total: 0, studioConnected: false }} />))).toContain('No draft rules to review.');
  });
});
