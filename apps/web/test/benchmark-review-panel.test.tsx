import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkReviewPanel, canDecide, decideHint, pathText, scoreText, type ReviewBatch } from '@/components/projects/rlgym-panel';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** D-013, D-014, D-015 (owner, 23 Nov 2026): Benchmark review on batch smr-0051 (run-0228), with the episode shape the RL Gym sent. */
const EPISODE = {
  item_id: 'it-1',
  score: { score: 42.86, passed: false, failed_criteria: ['account_agreements', 'identification_verification', 'screening', 'state_rule_selection'] },
  path: {
    order: ['intake', 'identify', 'decide'],
    summary: 'Took 3 of 8 steps; failed at account (criterion account_agreements fail); not reached: verify, screen, account, state, act',
    failed_node: 'account',
    failed_why: 'criterion account_agreements fail',
  },
  system: { name: 'Mock' },
};
const BATCH: ReviewBatch = {
  ref: 'rr-c1b45f709e60',
  batchId: 'smr-0051',
  runId: 'run-0228',
  receivedAt: '2026-11-23T15:38:59.742Z',
  note: null,
  items: [{ itemId: 'it-1', taskId: '00000000-0000-4000-8000-000000000051', revision: 1, episode: EPISODE, decision: null }],
};
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const empty = { decision: 'agent_failure', rationale: '', criterionId: '' };

describe('Benchmark review panel', () => {
  it('D-014: shows the score object as score, pass/fail and failed criteria', () => {
    const html = renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[BATCH]} connected />);
    expect(html).not.toContain('[object Object]');
    expect(text(html)).toContain('Score 42.86 · not passed · failed: account_agreements, identification_verification, screening, state_rule_selection');
    expect(scoreText(40)).toBe('Score 40');
    expect(scoreText({ score: 90, passed: true, pass_mark: 70 })).toBe('Score 90 (pass mark 70) · passed');
    expect(scoreText(undefined)).toBe('Score —');
  });

  it('D-015: shows the RL Gym’s path summary once, without a repeated "failed at"', () => {
    const t = text(renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[BATCH]} connected />));
    expect(t.match(/failed at account/g)).toHaveLength(1);
    expect(pathText({ failed_node: 'account', failed_why: 'criterion x fail' })).toBe('Failed at account (criterion x fail)');
    expect(pathText({})).toBe('');
  });

  it('D-013: the Rationale box is a styled field, and a disabled Decide says why', () => {
    const html = renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[BATCH]} connected />);
    expect(html).toMatch(/Rationale<\/span><input class="input"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Decide/);
    expect(text(html)).toContain('Type a rationale to decide.');
    expect(a11yProblems(html)).toEqual([]);
    expect(canDecide(true, { ...empty, rationale: 'Agent skipped the agreements.' })).toBe(true);
    expect(decideHint(true, { ...empty, rationale: 'x' })).toBe('Ready to decide. A decision is final.');
    expect(canDecide(true, { ...empty, decision: 'grader_wrong', rationale: 'x' })).toBe(false);
    expect(decideHint(true, { ...empty, decision: 'grader_wrong' })).toBe('Type a rationale and the criterion it is about to decide.');
    expect(canDecide(false, { ...empty, rationale: 'x' })).toBe(false);
  });

  it('D-013: the shared theme defines .input with a visible border, so every field using it shows', () => {
    const css = readFileSync(new URL('../../../packages/shared/theme/theme.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.input \{[^}]*border: 1px solid var\(--praxis-border\)/);
  });
});
