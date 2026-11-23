import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InboxBell } from '@/components/inbox-bell';
import { BenchmarkReviewPanel, type ReviewBatch } from '@/components/projects/rlgym-panel';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** D-004 (owner, 23 Nov 2026): the PM/Admin bell, and assigning each task's run review to its author or a project SME Reviewer. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const AUTHOR = { smeUserId: '00000000-0000-4000-8000-0000000000a1', name: 'John Doe', role: 'author' as const };
const REVIEWER = { smeUserId: '00000000-0000-4000-8000-0000000000a2', name: 'Rae Reviewer', role: 'reviewer' as const };
const BATCH: ReviewBatch = {
  ref: 'rr-1',
  batchId: 'smr-0051',
  runId: 'run-0228',
  receivedAt: '2026-11-23T15:38:59.742Z',
  note: null,
  items: [{ itemId: 'it-1', taskId: '24c82997-e8fa-46f0-8a41-863bd3e54dbd', revision: 1, episode: { score: 40 }, decision: null }],
  tasks: [{ taskId: '24c82997-e8fa-46f0-8a41-863bd3e54dbd', assignee: null, eligible: [AUTHOR, REVIEWER], locked: false }],
};

describe('staff bell', () => {
  it('shows the count and links each item to where it is done', () => {
    const html = renderToStaticMarkup(<InboxBell items={[{ kind: 'run_review_unassigned', title: 'Assign a reviewer to 2 tasks in run review smr-0051', detail: 'KYC · run run-0228', href: '/projects/p?tab=benchmark', count: 2 }]} />);
    expect(html).toContain('aria-label="Inbox, 1 waiting"');
    expect(html).toContain('href="/projects/p?tab=benchmark"');
    expect(text(html)).toContain('Assign a reviewer to 2 tasks in run review smr-0051');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says when nothing is waiting, or when it could not load', () => {
    expect(text(renderToStaticMarkup(<InboxBell items={[]} />))).toContain('Nothing is waiting for you right now.');
    expect(text(renderToStaticMarkup(<InboxBell items={[]} unavailable />))).toContain('The inbox could not be loaded.');
  });
});

describe('Benchmark review: reviewer per task', () => {
  it('a PM picks the author (first) or a project SME Reviewer', () => {
    const html = renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[BATCH]} connected />);
    expect(text(html)).toContain('no reviewer yet');
    expect([...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].filter((m) => m[1]!.startsWith('00000000')).map((m) => m[2])).toEqual(['John Doe (wrote the task)', 'Rae Reviewer (SME Reviewer)']);
    expect(text(html)).toContain('Assign reviewer');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a staff Reviewer sees who reviews but cannot assign or decide; a decided task keeps its reviewer', () => {
    const readOnly = renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[{ ...BATCH, tasks: [{ ...BATCH.tasks![0]!, assignee: AUTHOR }] }]} connected canDecide={false} />);
    expect(text(readOnly)).toContain('reviewed by John Doe (wrote the task)');
    expect(readOnly).not.toContain('Assign reviewer');
    expect(readOnly).not.toContain('>Decide<');
    expect(text(readOnly)).toContain('A PM, an Admin or the assigned SME decides.');
    const locked = renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[{ ...BATCH, tasks: [{ ...BATCH.tasks![0]!, assignee: AUTHOR, locked: true }] }]} connected />);
    expect(text(locked)).toContain('decided, so the reviewer is fixed');
    expect(locked).not.toContain('Change reviewer');
  });
});
