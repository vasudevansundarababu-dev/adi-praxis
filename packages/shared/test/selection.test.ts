import { describe, expect, it } from 'vitest';
import { assessmentProblems, mayApprove, recommendationFrom, SelectionDecisionRequest, type CriterionFinding, type OpportunityCriteria } from '../src';

const criteria: OpportunityCriteria = [
  { id: 'kyc', text: 'KYC casework', kind: 'REQUIRED', evidence: '', equivalence: '' },
  { id: 'edd', text: 'EDD reviews', kind: 'PREFERRED', evidence: '', equivalence: '' },
];
const f = (criterionId: string, result: CriterionFinding['result'], citations = ['field:x']): CriterionFinding => ({ criterionId, result, citations, rationale: 'r' });

describe('recommendation rules (FLOW2 8.1)', () => {
  it('FIT when every required criterion is met, even with preferred gaps', () => {
    expect(recommendationFrom([f('kyc', 'MET'), f('edd', 'NOT_MET')], criteria)).toBe('FIT_RECOMMENDED');
  });
  it('a preferred-only gap can never make NOT_FIT', () => {
    expect(recommendationFrom([f('kyc', 'MET'), f('edd', 'NOT_MET')], criteria)).not.toBe('NOT_FIT_RECOMMENDED');
  });
  it('NOT_FIT only when a required criterion is not met on cited information', () => {
    expect(recommendationFrom([f('kyc', 'NOT_MET'), f('edd', 'MET')], criteria)).toBe('NOT_FIT_RECOMMENDED');
    expect(recommendationFrom([f('kyc', 'NOT_MET', []), f('edd', 'MET')], criteria)).toBe('NEEDS_INFORMATION');
  });
  it('unknown or partial required criteria ask for information (absence of evidence is not failure)', () => {
    expect(recommendationFrom([f('kyc', 'UNKNOWN', []), f('edd', 'MET')], criteria)).toBe('NEEDS_INFORMATION');
    expect(recommendationFrom([f('kyc', 'PARTIALLY_MET'), f('edd', 'MET')], criteria)).toBe('NEEDS_INFORMATION');
  });
});

describe('assessment validation (CF-20)', () => {
  const ids = new Set(['field:x', 'role:1']);
  const out = (findings: CriterionFinding[]) => ({ findings, unresolvedQuestions: [], proposedContributionRoles: [], limitations: '' });
  it('accepts a complete, grounded assessment', () => {
    expect(assessmentProblems(out([f('kyc', 'MET'), f('edd', 'UNKNOWN', [])]), criteria, ids)).toEqual([]);
  });
  it('rejects invented criteria, invented citations, missing or duplicate criteria and uncited verdicts', () => {
    const p = assessmentProblems(out([f('kyc', 'MET', ['doc:fake']), f('kyc', 'MET'), f('invented', 'MET'), f('x', 'NOT_MET', [])]), criteria, ids);
    expect(p.join(' | ')).toMatch(/cites unknown evidence "doc:fake".*assessed twice.*Unknown criterion "invented".*without citations.*"edd" was not assessed/);
  });
});

describe('selection decisions (FLOW2 8.2)', () => {
  it('a selection needs a scope; asking for information needs the question', () => {
    const base = { reasons: [{ text: 'Meets requirements' }], candidateMessage: 'Thanks' };
    expect(SelectionDecisionRequest.safeParse({ ...base, outcome: 'SELECTED' }).success).toBe(false);
    expect(SelectionDecisionRequest.safeParse({ ...base, outcome: 'NEEDS_INFORMATION' }).success).toBe(false);
    expect(SelectionDecisionRequest.safeParse({ ...base, outcome: 'SELECTED', scope: { domain: 'Banking', contributionRoles: ['TASK_AUTHOR'] } }).success).toBe(true);
  });
});

describe('separation of duties (CF-27)', () => {
  it('nobody approves their own work, nor work from someone they declared a conflict with', () => {
    expect(mayApprove({ authorId: 'a', approverId: 'a' })).toBe(false);
    expect(mayApprove({ authorId: 'a', approverId: 'b' })).toBe(true);
    expect(mayApprove({ authorId: 'a', approverId: 'b', conflicts: [{ a: 'b', b: 'a' }] })).toBe(false);
  });
});
