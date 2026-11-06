import { describe, expect, it } from 'vitest';
import { bindingSatisfied, PRAXIS_STAGED_EXAMPLE, PRAXIS_SYNTHETIC_EXAMPLE, praxisContractIssues } from '../src/praxis-contract';
describe('Praxis executable contract v1', () => {
  it('qualifies the shared synthetic reference fixture', () => expect(praxisContractIssues(PRAXIS_SYNTHETIC_EXAMPLE)).toEqual([]));
  it.each(['environment', 'visibility', 'stages', 'ids', 'weights', 'reference', 'review'])('fails closed with field-specific issues: %s', (kind) => {
    const t = structuredClone(PRAXIS_SYNTHETIC_EXAMPLE);
    if (kind === 'environment') t.environment.binding = 'shell';
    if (kind === 'visibility') t.evidence[0]!.visibility = 'future';
    if (kind === 'stages') t.stages.push({ ...t.stages[0]! });
    if (kind === 'ids') t.constraints[0]!.id = t.evidence[0]!.id;
    if (kind === 'weights') t.rubric.criteria[0]!.weight_bps = 1;
    if (kind === 'reference') t.rubric.reference_output.spend_usd = 1001;
    if (kind === 'review') t.provenance.review.reviewed_revision_id = 'wrong-revision';
    expect(praxisContractIssues(t).length).toBeGreaterThan(0);
    expect(praxisContractIssues(t)[0]!.path).not.toBe('');
  });
  it('does not coerce numeric strings, booleans or missing values into rule success', () => {
    const b = { kind: 'json_number_max' as const, field: 'spend', value: 1000 };
    for (const value of ['999', true, NaN, Infinity]) expect(bindingSatisfied(b, { spend: value })).toBe(false);
    expect(bindingSatisfied(b, {})).toBe(false);
  });
  it('cannot reveal private evidence through the public stage', () => {
    const t = structuredClone(PRAXIS_SYNTHETIC_EXAMPLE);
    t.stages[0]!.evidence_ids.push('ev-private-note');
    expect(praxisContractIssues(t)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'stages.0.evidence_ids' })]));
  });
});

describe('Praxis staged contract v2', () => {
  it('qualifies the frozen staged example', () => expect(praxisContractIssues(PRAXIS_STAGED_EXAMPLE)).toEqual([]));
  it.each(['early_reveal', 'private_reveal', 'missing_stage', 'action', 'state_id', 'state_field', 'state_key', 'final_reference', 'stage_reference'])('rejects unsupported staged binding: %s', (kind) => {
    const t = structuredClone(PRAXIS_STAGED_EXAMPLE);
    if (kind === 'early_reveal') t.stages[0]!.evidence_ids.push('ev-budget-update');
    if (kind === 'private_reveal') t.stages[0]!.evidence_ids.push('ev-private-note');
    if (kind === 'missing_stage') t.evidence[2]!.reveal_stage_id = 'absent';
    if (kind === 'action') t.stages[0]!.action_id = 'absent';
    if (kind === 'state_id') t.stages[0]!.state_updates[0]!.id = 'ev-channel-costs';
    if (kind === 'state_field') t.stages[0]!.state_updates[0]!.from_field = 'absent';
    if (kind === 'state_key') t.stages[0]!.state_updates.push({ ...t.stages[0]!.state_updates[0]!, id: 'unique-update' });
    if (kind === 'final_reference') t.rubric.reference_output.spend_usd = 10000;
    if (kind === 'stage_reference') t.stages[0]!.rubric.reference_output.spend_usd = 10000;
    expect(praxisContractIssues(t).length).toBeGreaterThan(0);
  });
});
