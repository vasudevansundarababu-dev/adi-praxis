import { describe, expect, it } from 'vitest';
import { benchmarkReviewTile, benchmarkTabCount, type WaitingBatch } from '@/lib/benchmark-waiting';

const W: WaitingBatch = { projectId: 'p1', projectName: 'KYC Onboarding', ref: 'rr-1', batchId: 'smr-0051', runId: 'run-0228', items: 14, waiting: 14, receivedAt: '2026-11-23T15:38:59.000Z', href: '/projects/p1?tab=benchmark' };

describe('benchmark reviews waiting: Home tile and Benchmark tab count', () => {
  it('Home tile names the project, run and count and opens the Benchmark tab', () => {
    expect(benchmarkReviewTile(W)).toEqual({
      label: 'Benchmark review: KYC Onboarding',
      count: 14,
      hint: '14 episodes of 14 from run run-0228 waiting for a decision (batch smr-0051, received 2026-11-23).',
      href: '/projects/p1?tab=benchmark',
    });
    expect(benchmarkReviewTile({ ...W, waiting: 1, runId: null }).hint).toBe('1 episode of 14 waiting for a decision (batch smr-0051, received 2026-11-23).');
  });

  it('Benchmark tab shows this project’s total and nothing when none wait', () => {
    expect(benchmarkTabCount([W, { ...W, ref: 'rr-2', waiting: 3 }, { ...W, projectId: 'p2' }], 'p1')).toBe('17 to review');
    expect(benchmarkTabCount([W], 'p2')).toBeUndefined();
  });
});
