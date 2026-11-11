import { describe, expect, it } from 'vitest';
import { ENABLED_REVIEW_ROUTES, ExpertEditRequest, jsonDiff, StageDecisionRequest, taskPhase } from '../src';

const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };

describe('Wave 2 review stages (shared contract)', () => {
  it('enables both review routes', () => {
    expect(ENABLED_REVIEW_ROUTES).toEqual(['SME_PM', 'SME_EXPERT_PM']);
  });

  it('names the stored pending stage for the SME task view', () => {
    expect(taskPhase('SUBMITTED', { reviewRoute: 'SME_EXPERT_PM', pendingStage: 'PM_APPROVAL' }).label).toBe('Approval pending: PM approval');
    expect(taskPhase('SUBMITTED', { reviewRoute: 'SME_EXPERT_PM', pendingStage: 'EXPERT_REVIEW' }).label).toBe('Review pending: Expert review');
    expect(taskPhase('SUBMITTED', { reviewRoute: 'SME_PM', pendingStage: null }).label).toBe('Approval pending: PM approval');
  });

  it('allows only the decisions of each stage', () => {
    const base = { expectedRevision: 1, expectedVersion: 1 };
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue }).success).toBe(true);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'EXPERT_REVIEW', decision: 'APPROVE', checklist: allTrue }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: { ...allTrue, correct: false } }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'EXPERT_REVIEW', decision: 'PASS' }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'PM_APPROVAL', decision: 'APPROVE' }).success).toBe(true);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'PM_APPROVAL', decision: 'PASS' }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'PM_APPROVAL', decision: 'REJECT', rejectReason: 'INCORRECT' }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'PM_APPROVAL', decision: 'REWORK', comments: [] }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'PM_APPROVAL', decision: 'REWORK', comments: [{ text: 'unpinned' }] }).success).toBe(false);
    expect(StageDecisionRequest.safeParse({ ...base, stage: 'PM_APPROVAL', decision: 'REWORK', comments: [{ target: { kind: 'node', id: 'n1' }, text: 'Fix the join.' }] }).success).toBe(true);
  });

  it('requires a reason and an explicit materiality for an Expert edit', () => {
    const base = { expectedRevision: 1, expectedVersion: 1, output: {} };
    expect(ExpertEditRequest.safeParse({ ...base, reason: 'Fix the date', material: false }).success).toBe(true);
    expect(ExpertEditRequest.safeParse({ ...base, reason: '', material: false }).success).toBe(false);
    expect(ExpertEditRequest.safeParse({ ...base, reason: 'Fix the date' }).success).toBe(false);
  });

  it('diffs JSON down to leaf paths', () => {
    expect(jsonDiff({ a: { b: 1, c: [1, 2] }, d: 'x' }, { a: { b: 2, c: [1, 2, 3] }, d: 'x', e: true })).toEqual([
      { path: 'a.b', before: 1, after: 2 },
      { path: 'a.c[2]', before: null, after: 3 },
      { path: 'e', before: null, after: true },
    ]);
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
