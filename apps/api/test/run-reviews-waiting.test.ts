import { describe, expect, it } from 'vitest';
import { waitingBatches } from '../src/routes/benchmark';

/** Owner, 23 Nov 2026: received RL Gym review batches must be visible beyond the Benchmark tab until every episode is decided. */
const P = { id: '00000000-0000-4000-8000-000000000041', name: 'KYC Onboarding' };
const batch = (decided: string[], over: object = {}) => ({
  projectId: P.id,
  forgeBatchRef: 'rr-1',
  batchId: 'smr-0051',
  runId: 'run-0228',
  createdAt: new Date('2026-11-23T15:38:59Z'),
  body: { tasks: [{ task_id: 't1', episodes: [{ item_id: 'a' }, { item_id: 'b' }] }, { task_id: 't2', episodes: [{ episode_id: 'c' }] }] },
  decisions: decided.map((itemId) => ({ itemId })),
  ...over,
});

describe('waiting RL Gym review batches', () => {
  it('counts the episodes still undecided and links to the project’s Benchmark tab', () => {
    expect(waitingBatches([batch(['a'])], [P])).toEqual([
      { projectId: P.id, projectName: 'KYC Onboarding', ref: 'rr-1', batchId: 'smr-0051', runId: 'run-0228', items: 3, waiting: 2, receivedAt: '2026-11-23T15:38:59.000Z', href: `/projects/${P.id}?tab=benchmark` },
    ]);
  });

  it('drops a batch once every episode is decided, and one whose project is not the caller’s', () => {
    expect(waitingBatches([batch(['a', 'b', 'c'])], [P])).toEqual([]);
    expect(waitingBatches([batch([])], [])).toEqual([]);
  });
});
