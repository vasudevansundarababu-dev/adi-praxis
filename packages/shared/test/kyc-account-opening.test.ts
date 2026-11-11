import { describe, expect, it } from 'vitest';
import {
  agentProjection,
  checkProfile,
  compilePraxisContract,
  GOLDEN_KYC_EXAMPLE,
  KYC_ACCOUNT_OPENING_PROFILE,
  KYC_PROFILE,
  profileForTemplate,
  profileForWorkflow,
  profileProblems,
  profileShapeProblems,
  profilesForWorkflow,
  withRuleVersions,
} from '../src';

/** KYC template version 2 (owner, 11 Nov 2026): the Golden Bank KYC authoring reference must be authorable. */
const P = KYC_ACCOUNT_OPENING_PROFILE;
const versions = Object.fromEntries(['GB-01', 'GB-02', 'GB-03', 'GB-04', 'GB-05', 'GB-06', 'GB-07'].map((id, i) => [id, `00000000-0000-4000-8000-00000000000${i + 1}`]));
const golden = withRuleVersions(GOLDEN_KYC_EXAMPLE, versions) as unknown as Record<string, unknown>;

describe('KYC template v2: account opening (golden reference)', () => {
  it('registers as an alternate form: KYC v1 stays the workflow default; a v2 template opts in by profile ID', () => {
    expect(checkProfile(P)).toEqual([]);
    expect(profileForWorkflow('KYC onboarding and refresh')).toMatchObject({ status: 'ok', profile: { profileId: KYC_PROFILE.profileId } });
    expect(profileForTemplate({ workflowName: 'KYC onboarding and refresh', profileId: 'kyc-account-opening' })).toMatchObject({ status: 'ok', profile: { profileId: 'kyc-account-opening' } });
    expect(profileForTemplate({ workflowName: 'Sanctions screening alerts', profileId: 'kyc-account-opening' }).status).toBe('unsupported');
    expect(profilesForWorkflow('KYC onboarding and refresh').map((p) => p.profileId)).toEqual(['kyc-onboarding-and-refresh', 'kyc-account-opening']);
  });

  it('holds the golden structure: tool catalogue, four recommendations, products, states, party roles, follow-ups', () => {
    const f = (s: string, k: string) => P.sections.find((x) => x.key === s)!.fields.find((x) => x.key === k)!;
    expect(f('S3', 'tools').options!.map((o) => o.value)).toContain('information.request');
    expect(f('S3', 'tools').allowCustom).toBe(false);
    expect(f('S6', 'recommendation').options!.map((o) => o.value)).toEqual(['ready_for_approval', 'request_information', 'specialist_review', 'not_eligible_for_requested_product']);
    expect(f('S1', 'product').options!.map((o) => o.value)).toEqual(['individual_checking', 'adult_joint_checking', 'teen_joint_checking', 'custodial_cash_savings']);
    expect(f('S1', 'state').options!.map((o) => o.value)).toEqual(['CA', 'NY', 'TX', 'FL', 'IL']);
    expect(f('S2', 'parties').itemFields!.find((x) => x.key === 'role')!.options!.map((o) => o.value)).toEqual(expect.arrayContaining(['teen_owner', 'legal_guardian', 'custodian', 'beneficiary']));
    expect(f('S5', 'followUps').maxItems).toBe(3);
  });

  it('the worked golden case (teen joint checking, NY, slot 5) passes every form check', () => {
    expect(profileShapeProblems(P, golden)).toEqual([]);
    expect(profileProblems(P, golden)).toEqual([]);
  });

  it('Anvil task v1 export: the recommendation check compiles; evaluator-graded checks are reported, never invented', () => {
    const r = compilePraxisContract(P, golden, { taskId: 't1', revisionId: 't1-r1' });
    // Anvil task v1 grades output.json fields only. The golden reference grades 19 of its 20 checks with Anvil's own
    // evaluators (ZEN/OPA/trace) over the observed trajectory, so they have no output binding: the export is blocked
    // with that exact reason (open item for the owner and Anvil), while authoring, review and the dataset work.
    expect('blockers' in r).toBe(true);
    const blockers = 'blockers' in r ? r.blockers : [];
    const unbound = blockers.filter((b) => b.code === 'MISSING_BINDING').map((b) => b.path);
    expect(unbound).toHaveLength(19);
    expect(unbound).not.toContain('S7.criteria[4].outputField');
    expect(blockers.every((b) => ['MISSING_BINDING', 'WEIGHTS'].includes(b.code))).toBe(true);
  });

  it('keeps private expectations out of the agent view', () => {
    const view = agentProjection(P, golden) as { sections: Record<string, Record<string, unknown> | undefined> };
    const text = JSON.stringify(view);
    expect(text).toContain('APP-NY-TJ-0005');
    expect(view.sections.S6?.recommendation).toBeUndefined();
    expect(view.sections.S7).toBeUndefined();
    expect(view.sections.S5).toBeUndefined();
    expect(view.sections.S1?.scenarioSlot).toBeUndefined();
    expect(view.sections.S3?.recordedResponses).toBeUndefined();
    for (const secret of ['resolvable_identity_gap', 'fabricated_verification', 'Proof of P1 date of birth', 'insufficient_data']) expect(text, secret).not.toContain(secret);
  });

  it('an unfilled rule version, a fourth follow-up round or an unknown tool is caught', () => {
    const bad = structuredClone(golden) as { sections: Record<string, Record<string, unknown>> };
    (bad.sections.S5!.followUps as unknown[]).push(...[2, 3, 3].map((round, i) => ({ id: `FU${i + 2}`, round, partyId: 'P2', itemRequested: 'x', why: 'x', permittedEvidence: 'x', deadline: '2026-06-09', response: 'no_reply' })));
    (bad.sections.S3!.tools as string[]).push('funds.transfer');
    const problems = [...profileShapeProblems(P, bad), ...profileProblems(P, bad).map((p) => p.message)].join(' | ');
    expect(problems).toMatch(/funds\.transfer|allowed/i);
    expect(problems).toMatch(/at most 3|3 /i);
  });
});
