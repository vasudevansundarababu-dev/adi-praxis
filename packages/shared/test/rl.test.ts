import { describe, expect, it } from 'vitest';
import { rlVerdictProblems, type RLVerdictRequest } from '../src';

const ctx = { metrics: ['correct_disposition', 'escalated'], reasonCodes: ['WRONG_ANSWER', 'UNSAFE_ACTION'], stepCount: 5 };
const base = (v: Partial<RLVerdictRequest>): RLVerdictRequest => ({ expectedRevision: 0, verdict: 'PASS', metricVerdicts: [{ metric: 'correct_disposition', agree: true }, { metric: 'escalated', agree: true }], comments: [], ...v });

describe('FLOW 4 verdict rules', () => {
  it('a clean PASS with every metric agreed has no problems', () => {
    expect(rlVerdictProblems(base({}), ctx)).toEqual([]);
  });
  it('a FAIL verdict cannot be submitted without at least one comment', () => {
    expect(rlVerdictProblems(base({ verdict: 'FAIL' }), ctx)).toEqual(['A FAIL verdict needs at least one comment']);
    expect(rlVerdictProblems(base({ verdict: 'FAIL', comments: [{ text: 'Approved despite an expired ID', trajectoryStep: 3, reasonCode: 'UNSAFE_ACTION' }] }), ctx)).toEqual([]);
  });
  it('every disagreement needs a comment; each metric exactly once; codes and steps must exist', () => {
    const v = base({ metricVerdicts: [{ metric: 'correct_disposition', agree: false }, { metric: 'invented', agree: true }], comments: [{ text: 'x', trajectoryStep: 9, reasonCode: 'NOPE' }] });
    expect(rlVerdictProblems(v, ctx)).toEqual([
      'Give exactly one verdict for the metric “escalated”',
      'Unknown metric “invented”',
      'Explain why you disagree with “correct_disposition”',
      'Unknown failure reason code “NOPE”',
      'Step 9 is not in the trajectory',
    ]);
  });
});
