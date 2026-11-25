import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkReviewPanel, RlGymExportPanel, type ReviewBatch, type RlGymExportState } from '@/components/projects/rlgym-panel';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** E-007 phase 2 (owner, 24 Nov 2026): existing screens only, with the stronger checks, the receipt and the bound review. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('Export for benchmark: why a task was not sent, the RL Gym’s answer per task, the receipt', () => {
  it('shows each failing check with section, field, who fixes it and whether retrying helps', () => {
    const state: RlGymExportState = {
      connected: true,
      canExport: true,
      reason: null,
      rlgymTemplate: { id: 'tpl', version: 9, specSha256: 'c'.repeat(64) },
      exported: true,
      tasks: [],
      runs: [
        {
          id: 'r1',
          exportId: 'exp-1',
          reason: 'first export of KYC',
          outcome: 'received',
          createdAt: '2026-11-24T12:00:00Z',
          tasks: [{ taskId: 't-a', title: 'Adult joint', revision: 1, warnings: ['POLICY_ID_UNMAPPED'], policyIdsUnmapped: [{ ruleId: '54e00852-42c6-4f43-a7b9-732cf7fd0882' }] }, { taskId: 't-b', title: 'Teen joint', revision: 2, checksGap: true, warnings: ['STEP_TOOL_NOT_OFFERED'] }],
          taskAnswers: { 't-a': 'accepted', 't-b': 'duplicate' },
          notSent: [{ title: 'Custodial', code: 'CHECKS_FAILED', message: 'S5: …', problems: [{ code: 'STEP_TOOL_NOT_OFFERED', section: 'S5', field: 'S5.steps[14].tool', owner: 'author', retryHelps: false, message: 'Step 15 uses recommend, but S3 does not offer it to the agent.' }] }],
          authoringReceiptSha256: 'd'.repeat(64),
          receipt: { new: 1, superseding: 0, unchanged: 1, blocked: [], replayed: false },
          error: null,
        },
      ],
    };
    const html = renderToStaticMarkup(<RlGymExportPanel projectId="p" initial={state} />);
    const t = text(html);
    expect(t).toContain('Adult joint (revision 1): accepted by RL Gym');
    // D-056: a cited policy with no reviewed mapping to the environment's ids is shown, not hidden.
    expect(t).toContain('a policy it cites is not mapped to the environment’s policy ids, so the agent’s policy.read will not find it');
    expect(t).toContain('Teen joint (revision 2): already in RL Gym (duplicate, unchanged) · approved before the stronger checks (warnings: STEP_TOOL_NOT_OFFERED)');
    expect(t).toContain('STEP_TOOL_NOT_OFFERED S5 · S5.steps[14].tool: Step 15 uses recommend');
    expect(t).toContain('To fix: the author (send it back for rework). Trying again won’t help until it is fixed.');
    expect(t).toContain(`ADI Forge receipt ${'d'.repeat(16)}`);
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('Benchmark review: the run, score pass and evidence under review; Accept, Dispute or Can’t assess', () => {
  it('names what the decision is bound to and offers the three kinds of verdict', () => {
    const batch: ReviewBatch = {
      ref: 'rr-1',
      batchId: 'smr-1',
      runId: 'run-0300',
      receivedAt: '2026-11-24T12:00:00Z',
      note: null,
      items: [{ itemId: 'it-1', taskId: '24c82997-e8fa-46f0-8a41-863bd3e54dbd', revision: 1, runId: 'run-0300', scorePass: 2, evidenceSha256: 'e'.repeat(64), episode: { score: 40 }, decision: null }],
    } as ReviewBatch;
    const html = renderToStaticMarkup(<BenchmarkReviewPanel projectId="p" batches={[batch]} connected />);
    const t = text(html);
    expect(t).toContain(`Reviewing run run-0300 · score pass 2 · evidence ${'e'.repeat(16)}`);
    for (const v of ['Accept: the score stands (agent failure confirmed)', 'Dispute: the task needs correction', 'Dispute: the environment is wrong', 'Can’t assess']) expect(t).toContain(v);
    expect(a11yProblems(html)).toEqual([]);
  });
});
