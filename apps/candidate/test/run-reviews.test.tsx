import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InboxBell } from '@/components/inbox-bell';
import { RunReviews } from '@/components/forge/run-reviews';
import { canDecide, decideHint } from '@/lib/run-review';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** D-004 (owner, 23 Nov 2026): the SME's bell (Rework, run reviews) and the run reviews page. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const REVIEW = {
  ref: 'rr-1',
  batchId: 'smr-0051',
  runId: 'run-0228',
  projectId: 'p',
  projectName: 'KYC Customer onboarding for US bank',
  receivedAt: '2026-11-23T15:38:59.742Z',
  items: [
    { itemId: 'it-1', taskId: '24c82997-e8fa-46f0-8a41-863bd3e54dbd', revision: 1, runId: 'run-0228', scorePass: 2, evidenceSha256: 'ab'.repeat(32), episode: { score: { score: 42.86, passed: false, failed_criteria: ['account_agreements'] }, path: { summary: 'Took 3 of 8 steps', failed_node: 'account' }, suspected_cause: 'task' }, decision: null },
    { itemId: 'it-2', taskId: '24c82997-e8fa-46f0-8a41-863bd3e54dbd', revision: 1, episode: { score: 70 }, decision: { decision: 'agent_failure', rationale: 'Skipped screening.', criterionId: null, decidedBy: 'John Doe', at: '2026-11-23T16:00:00Z' } },
  ],
};

describe('SME bell', () => {
  it('lists Rework with the reason and assigned run reviews, each linked', () => {
    const html = renderToStaticMarkup(
      <InboxBell
        items={[
          { kind: 'rework', title: 'Rework: Custodial account KYC', detail: 'RL Gym review (batch smr-0051): Step 4 names the wrong agreement.', href: '/tasks/t1', count: 1 },
          { kind: 'run_review', title: 'Review run results: 1 episode', detail: 'KYC · smr-0051 · run run-0228', href: '/run-reviews', count: 1 },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Inbox, 2 waiting"');
    expect(html).toContain('href="/tasks/t1"');
    expect(html).toContain('href="/run-reviews"');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('Run reviews page', () => {
  it('shows the score, path and hint once, with a visible Rationale box; decided episodes show their decision', () => {
    const html = renderToStaticMarkup(<RunReviews reviews={[REVIEW]} />);
    const t = text(html);
    expect(t).toContain('Score 42.86 · not passed · failed: account_agreements');
    expect(t).toContain('Path: Took 3 of 8 steps');
    expect(t).toContain('RL Gym’s hint (not a decision): task');
    expect(html).toMatch(/Rationale<\/span><input class="input"/);
    expect(t).toContain('Type a rationale to decide.');
    expect(t).toContain('Decided: Accept: the score stands (agent failure confirmed) by John Doe · Skipped screening.');
    // E-007 phase 2: what the decision is bound to, and the three kinds of verdict.
    expect(t).toContain(`Reviewing run run-0228 · score pass 2 · evidence ${'ab'.repeat(8)}`);
    expect(t).toContain('Your verdict');
    for (const v of ['Accept: the score stands', 'Dispute: the grader is wrong', 'Can’t assess']) expect(t).toContain(v);
    expect(a11yProblems(html)).toEqual([]);
    expect(canDecide({ decision: 'task_correction', rationale: 'Step 4 is wrong.', criterionId: '' })).toBe(true);
    expect(decideHint({ decision: 'rubric_correction', rationale: 'x', criterionId: '' })).toBe('Type the criterion it is about to decide.');
  });

  it('says so when nothing is assigned', () => {
    expect(text(renderToStaticMarkup(<RunReviews reviews={[]} />))).toContain('No run reviews are assigned to you right now.');
  });
});
