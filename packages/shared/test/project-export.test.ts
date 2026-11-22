import { describe, expect, it } from 'vitest';
import { exportEligibility, ProjectExportRunDto } from '../src';

/** New RL Gym part 2 (22 Nov 2026): the PM exports the approved tasks so far once the RL Gym is connected and qualified. */
const ok = { status: 'IN_PROGRESS', approvedTasks: 2, connected: true, qualified: true };

describe('project export eligibility (new RL Gym)', () => {
  it('opens with one approved task on a connected, qualified template', () => {
    expect(exportEligibility(ok)).toEqual({ canExport: true, reason: null });
    expect(exportEligibility({ ...ok, approvedTasks: 1 }).canExport).toBe(true);
  });
  it('says why it is closed, in order: draft or cancelled, not connected, not qualified, no approved task', () => {
    expect(exportEligibility({ ...ok, status: 'DRAFT', connected: false })).toEqual({ canExport: false, reason: 'The project is still a draft.' });
    expect(exportEligibility({ ...ok, status: 'CANCELLED' }).reason).toBe('The project is cancelled.');
    expect(exportEligibility({ ...ok, connected: false, qualified: false }).reason).toBe('RL Gym isn’t connected yet.');
    expect(exportEligibility({ ...ok, qualified: false }).reason).toBe('RL Gym hasn’t qualified this template version yet.');
    expect(exportEligibility({ ...ok, approvedTasks: 0 }).reason).toBe('Export needs at least one approved task.');
  });
});

describe('export run DTO', () => {
  it('accepts a received run with a receipt and refuses an unknown outcome', () => {
    const run = {
      id: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      exportId: 'exp-abc',
      exportSha256: 'a'.repeat(64),
      reason: 'first export of KYC November',
      tasks: [{ recordId: '00000000-0000-4000-8000-000000000003', taskId: '00000000-0000-4000-8000-000000000004', title: 'T', revision: 1, packageSha256: 'b'.repeat(64), correctsRevision: null }],
      notSent: [],
      outcome: 'received',
      httpStatus: 201,
      requestId: 'req-1',
      receipt: { new: 1, superseding: 0, unchanged: 0, blocked: [], replayed: false, receiptSha256: 'c'.repeat(64) },
      error: null,
      requestedById: '00000000-0000-4000-8000-000000000005',
      createdAt: '2026-11-22T00:00:00.000Z',
    };
    expect(ProjectExportRunDto.parse(run)).toEqual(run);
    expect(ProjectExportRunDto.safeParse({ ...run, outcome: 'validated' }).success).toBe(false);
  });
});
