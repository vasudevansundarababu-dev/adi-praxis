import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anvilSpecChecks } from '../src/tasks/submission';
import { expectedWeightTotal } from '../src/tasks/rubric/authoring-defaults';

/**
 * D-029 (owner, 23 Nov 2026): S7 weights total what the live template sets, never a hard-coded 100. The owner's case:
 * Golden KYC v6 (Authoring version 6) maps five criteria to golden-kyc-rubric-v1 and declares no total; TSK-001 has all
 * five at weight 5 (total 25) with Pass/Partial/Fail 5/2/0.
 */
const V8 = JSON.parse(readFileSync(new URL('../src/jobs/kyc-v8/template-spec.json', import.meta.url), 'utf8'));
const FIVE = ['identification_verification', 'screening', 'decision', 'next_action', 'evidence'];
const v6 = { ...V8, execution: { ...V8.execution, evaluators: V8.execution.evaluators.filter((e: { criterion_id: string }) => FIVE.includes(e.criterion_id)).concat(FIVE.filter((id) => !V8.execution.evaluators.some((e: { criterion_id: string }) => e.criterion_id === id)).map((id) => ({ capability: { id: 'golden-kyc-rubric-v1', version: '1' }, criterion_id: id, evidence_source: 'run_evidence' }))) } };
const criterion = (id: string, weight: number) => ({ id, name: id, weight, critical: id === 'identification_verification', evaluatorKind: 'golden-kyc-rubric-v1', evaluatorVersion: '1', passCondition: 'Pass text', partialCredit: 'Partial text', failCondition: 'Fail text' });
const weightCheck = (weights: number[], total = expectedWeightTotal(v6.execution, 'golden-kyc-v8-x5rwt6d5eu-v8')) =>
  anvilSpecChecks(v6, { sections: { S7: { criteria: FIVE.map((id, i) => criterion(id, weights[i]!)) } } }, total).find((c) => c.id === 'anvil.criteria-weights')!;

describe('S7 weight total from the live template', () => {
  it('Golden KYC v6: five mapped criteria at 5 each → the template total is 25', () => {
    expect(v6.execution.evaluators).toHaveLength(5);
    expect(expectedWeightTotal(v6.execution, 'golden-kyc-v8-x5rwt6d5eu-v8')).toEqual({ total: 25, source: 'template_criteria' });
  });

  it('TSK-001 as it is (five weights of 5) clears the weight check; a different total is refused with the template’s number', () => {
    expect(weightCheck([5, 5, 5, 5, 5])).toMatchObject({ ok: true, message: 'Every weight is above 0 with at most two decimals, and the weights total exactly 25' });
    expect(weightCheck([5, 5, 5, 5, 4])).toMatchObject({ ok: false, message: 'Weights must total exactly 25 for this template (now 24)' });
  });

  it('a total the template declares wins; with no total and no weights there is no fixed total; old templates keep 100', () => {
    expect(expectedWeightTotal(v6.execution, null, 30)).toEqual({ total: 30, source: 'template_field' });
    expect(expectedWeightTotal({ evaluators: [{ capability: { id: 'unknown-rubric', version: '9' }, criterion_id: 'x' }] }, null)).toEqual({ total: null, source: 'none' });
    expect(weightCheck([5, 5, 5, 5, 4], { total: null, source: 'none' })).toMatchObject({ ok: true, message: 'Every weight is above 0 with at most two decimals (total 24)' });
    expect(weightCheck([20, 20, 20, 20, 20], { total: 100, source: 'template_field' }).ok).toBe(true);
  });
});
