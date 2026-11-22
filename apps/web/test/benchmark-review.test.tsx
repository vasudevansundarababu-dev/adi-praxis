import type { BatchDetailDto } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { BenchmarkBatchList, BenchmarkReviewer } from '../components/forge/benchmark-review';
import { PROJECT_TABS } from '../lib/forge-console';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

/** New RL Gym part 3: the Benchmark review tab and one batch's reviewer (decisions final, RL Gym's hint is only a hint). */
const P = '00000000-0000-4000-8000-000000000001';
const R = '00000000-0000-4000-8000-000000000002';
const T = '00000000-0000-4000-8000-000000000003';
const episode = (n: number) => ({
  item_id: `item-${n}`,
  episode_id: `ep-${n}`,
  system: { id: 'sys-a', version: '1', name: 'Model A' },
  attempt: 1,
  case_id: `case-${n}`,
  score: 60,
  criteria: [{ criterion_id: 'decision', verdict: 'fail', points: 0, evaluator: 'rule', detail: 'Wrong decision' }],
  path: { order: ['read', 'decide'], failed_node: 'decide', failed_why: 'missed the pending TIN', summary: 'Decided too early' },
  timeline: [{ step: 1, tool: 'application.read', args: {}, status: 'ok', node: 'read' }],
  final_output: { decision: 'approve' },
  evidence: { sealed_sha256: 'e'.repeat(64), manifest_sha256: 'm'.repeat(64) },
  suspected_cause: 'task_ambiguous',
  suspected_cause_source: 'heuristic',
});
const batch: BatchDetailDto = {
  id: R,
  batchId: 'smr-0001',
  runId: 'run-0001',
  receivedAt: '2026-11-22T10:00:00.000Z',
  items: 2,
  decided: 1,
  undelivered: 1,
  rubric: [{ criterion_id: 'decision', weight: 5, is_gate: false, skill_group: 'judgement' }],
  scoringPass: { pass: 1 },
  note: 'Synthetic data only.',
  tasks: [{ taskId: T, revision: 1, title: 'Individual checking', episodes: [episode(1), episode(2)] }],
  decisions: [{ id: '00000000-0000-4000-8000-000000000009', itemId: 'item-1', decision: 'grader_wrong', rationale: 'The rule misread the field.', criterionId: 'decision', decidedBy: 'Pat PM', decidedAt: '2026-11-22T11:00:00.000Z', delivery: { outcome: 'rejected', httpStatus: 422, requestId: 'req-9', error: { code: 'CONFLICT', message: 'Batch is building' }, at: '2026-11-22T11:00:01.000Z' } }],
  canDecide: true,
  connected: true,
};

describe('Benchmark review', () => {
  it('is a project tab; the list links each batch and counts decided and unsent items', () => {
    expect(PROJECT_TABS.map((t) => t.label)).toContain('Benchmark review');
    const m = html(<BenchmarkBatchList projectId={P} connected items={[{ id: R, batchId: 'smr-0001', runId: 'run-0001', receivedAt: '2026-11-22T10:00:00.000Z', items: 2, decided: 1, undelivered: 1 }]} />);
    expect(m).toContain(`href="/projects/${P}/benchmark-reviews/${R}"`);
    expect(text(m)).toContain('smr-0001 run-0001 2026-11-22 10:00 1 of 2 1');
    expect(a11yProblems(m)).toEqual([]);
    const off = html(<BenchmarkBatchList projectId={P} connected={false} items={[]} />);
    expect(text(off)).toContain('RL Gym isn’t connected yet');
    expect(text(off)).toContain('No review batches yet.');
  });

  it('shows the verdicts, path, evidence and RL Gym’s hint as a hint; a decided item is final with its delivery and Send again', () => {
    const m = html(<BenchmarkReviewer projectId={P} batch={batch} />);
    const t = text(m);
    expect(t).toContain('Individual checking revision 1');
    expect(t).toContain('decision fail 0 Wrong decision');
    expect(t).toContain('Path: read → decide · failed at decide : missed the pending TIN');
    expect(t).toContain('s hint task_ambiguous (heuristic) — a hint only; you decide.');
    expect(m).toContain('data-decided="grader_wrong"');
    expect(t).toContain('Grader is wrong criterion decision · Pat PM');
    expect(t).toContain('Not sent: CONFLICT Batch is building');
    expect(m).toMatch(/>Send again<\/button>/);
    // The undecided item has the decision form with every decision.
    expect(m).toContain('data-decision-form="item-2"');
    for (const label of ['Agent failure confirmed', 'Task needs correction', 'Rubric needs correction', 'Grader is wrong', 'Environment is wrong']) expect(t).toContain(label);
    expect(a11yProblems(m)).toEqual([]);
  });
});
