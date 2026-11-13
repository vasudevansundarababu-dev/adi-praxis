import { describe, expect, it } from 'vitest';
import {
  agentGraphProjection,
  agentProjection,
  checkProfile,
  checkWorkflowGraph,
  GOLDEN_MARKETING_EXAMPLE,
  MARKETING_CAMPAIGN_TASK2_PROFILE,
  MARKETING_T2_TOOLS,
  marketingTask2Graph,
  NOISE_CANCELLING_PROFILE,
  profileForTemplate,
  profileForWorkflow,
  profileProblems,
  profileShapeProblems,
  profilesForWorkflow,
  templateStartingGraph,
  withRuleVersions,
  type TemplateProfile,
  type WorkflowGraphInput,
} from '../src';

/**
 * Golden Task2 (Marketing): the VEYRA Hush One headphone launch as ONE reusable five-agent task (owner decisions of
 * 12-13 Nov 2026; Keystone's four wire decisions): the 0-4 rubric in groups A-G, CR-01 to CR-06, source data by
 * reference, no per-case answers, and its own starting workflow. The form reaches Praxis in Anvil's proposal.
 */
const P = MARKETING_CAMPAIGN_TASK2_PROFILE;
const WORKFLOW = 'VEYRA Hush One headphone launch';
const OLD_WORKFLOW = 'Launch of Noise Cancelling Phone';
const ruleIds = ['POL-01', 'POL-04', 'POL-13', 'POL-14', 'POL-16', 'POL-17', 'POL-18', 'POL-23'];
const versions = Object.fromEntries(ruleIds.map((id, i) => [id, `00000000-0000-4000-8000-0000000000${10 + i}`]));
const golden = withRuleVersions(GOLDEN_MARKETING_EXAMPLE, versions) as unknown as { sections: Record<string, Record<string, unknown>> };
const clone = () => JSON.parse(JSON.stringify(golden)) as typeof golden;
const f = (s: string, k: string) => P.sections.find((x) => x.key === s)!.fields.find((x) => x.key === k)!;

describe('Marketing Task2 form (DM03 template version 2)', () => {
  it('is a valid form for a new workflow, not built in (it arrives in Anvil\'s proposal); the old Phone workflow keeps its single-agent form', () => {
    expect(checkProfile(P)).toEqual([]);
    expect(P).toMatchObject({ profileId: 'veyra-hush-one-launch-v1', catalogWorkflowName: WORKFLOW });
    expect(profileForTemplate({ workflowName: WORKFLOW, profileId: 'veyra-hush-one-launch-v1' }).status).not.toBe('ok');
    expect(profileForWorkflow(OLD_WORKFLOW)).toMatchObject({ status: 'ok', profile: { profileId: NOISE_CANCELLING_PROFILE.profileId } });
    expect(profilesForWorkflow(OLD_WORKFLOW).map((p) => p.profileId)).toEqual(['noise-cancelling-phone-launch']);
  });

  it('one reusable task: no per-case answers, release schedule, recorded responses or outcomes; outputs come from the template execution', () => {
    const keys = P.sections.flatMap((s) => s.fields.map((x) => x.key));
    for (const k of ['caseOutcome', 'roleExpectations', 'weeklyExpectations', 'budgetExpectations', 'releaseSchedule', 'recordedResponses', 'findings', 'knownGaps', 'rationale', 'decisionFields']) expect(keys).not.toContain(k);
    expect(P.contract).toMatchObject({ outputsFrom: 'template_execution', decisionFields: null });
    expect(f('S6', 'outputContract').required).toBe(true);
    expect(f('S1', 'locales').options!.map((o) => o.value)).toEqual(['US_en-US', 'IN_en-IN', 'IN_hi-IN', 'FR_fr-FR', 'SG_en-SG']);
  });

  it('is multi-agent, blocks executable Anvil export until Anvil qualifies Marketing, and fixes the gateway tools', () => {
    expect(P.agentMode).toBe('MULTI');
    expect(P.exportCapabilities).toMatchObject({ executable: false, blockers: ['ANVIL_MARKETING_PROFILE_NOT_REGISTERED', 'ANVIL_ENVIRONMENT_NOT_QUALIFIED'] });
    expect(f('S3', 'tools').options!.map((o) => o.value)).toEqual(MARKETING_T2_TOOLS);
    expect(f('S3', 'tools').allowCustom).toBe(false);
    // Agents never hold approval, ledger, activation or clock writes.
    expect(MARKETING_T2_TOOLS.some((t) => /approval_decision|ledger\.write|activate|clock/.test(t))).toBe(false);
    expect(f('S7', 'criticalFailures').options!.map((o) => o.value)).toEqual(['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06']);
  });

  it('rubric: 0-4 levels in groups A-G (weights total 100; B needs 12 of 20 to pass)', () => {
    const c = f('S7', 'criteria');
    expect(c.scale).toBe('zero_to_four');
    expect(c.groups!.map((g) => [g.id, g.weight])).toEqual([['A', 10], ['B', 20], ['C', 15], ['D', 10], ['E', 15], ['F', 15], ['G', 15]]);
    expect(c.groups!.find((g) => g.id === 'B')!.minimum).toBe(12);
  });

  it('the reusable VEYRA task passes every form check', () => {
    expect(profileShapeProblems(P, golden)).toEqual([]);
    expect(profileProblems(P, golden)).toEqual([]);
  });

  it('a group whose criteria do not total its weight, or a criterion without level 2 or level 0, is reported', () => {
    const g = clone();
    const criteria = g.sections.S7!.criteria as Record<string, unknown>[];
    criteria.find((x) => x.id === 'B1')!.group = 'C';
    delete criteria.find((x) => x.id === 'A1')!.level2;
    delete criteria.find((x) => x.id === 'A2')!.failCondition;
    const text = profileProblems(P, g).map((p) => p.message).join(' | ');
    expect(text).toMatch(/group B \(Adaptation\) weights must total 20 \(now 15\)/);
    expect(text).toMatch(/group C \(Planning\) weights must total 15 \(now 20\)/);
    expect(text).toMatch(/Level 2/);
    expect(text).toMatch(/Level 0/);
  });

  it('the rubric and procedure stay out of the agent view; source data travels by reference', () => {
    const view = agentProjection(P, golden) as { sections: Record<string, Record<string, unknown> | undefined> };
    const text = JSON.stringify(view);
    expect(text).toContain('VEYRA Hush One');
    expect(view.sections.S7).toBeUndefined();
    expect(view.sections.S5).toBeUndefined();
    expect(f('S2', 'sourceRefs').itemFields!.map((x) => x.key)).toEqual(['id', 'dataset', 'records', 'checksum', 'licence']);
  });

  it('checkProfile rejects bad groups: duplicate IDs, totals that are not 100, a minimum above its weight', () => {
    const bad = (groups: { id: string; label: string; weight: number; minimum?: number }[]): TemplateProfile => ({
      ...P,
      profileId: 'marketing-bad-groups',
      sections: P.sections.map((s) => (s.key !== 'S7' ? s : { ...s, fields: s.fields.map((x) => (x.key === 'criteria' ? { ...x, groups } : x)) })),
    });
    expect(checkProfile(bad([{ id: 'A', label: 'A', weight: 50 }, { id: 'A', label: 'A2', weight: 50 }])).join(' ')).toMatch(/duplicate group IDs/);
    expect(checkProfile(bad([{ id: 'A', label: 'A', weight: 60 }])).join(' ')).toMatch(/group weights total 60, not 100/);
    expect(checkProfile(bad([{ id: 'A', label: 'A', weight: 100, minimum: 120 }])).join(' ')).toMatch(/minimum is above its weight/);
  });
});

describe('Marketing Task2 starting workflow', () => {
  const graph = marketingTask2Graph();

  it('the VEYRA form starts from the five-agent workflow (canonical role IDs); the old Phone workflow keeps its own', () => {
    expect(templateStartingGraph(WORKFLOW, 1, 'veyra-hush-one-launch-v1')).toEqual(marketingTask2Graph(1));
    expect(graph.schemaVersion).toBe('praxis.workflow_graph.v1-proposed');
    expect(graph.roles.map((r) => r.id)).toEqual(['orchestrator', 'intent', 'performance', 'brief', 'policy']);
    expect(templateStartingGraph(OLD_WORKFLOW, 1)?.agentMode).toBe('SINGLE');
  });

  it('is valid: five roles, a parallel join, Task3 as an external system, a simulated approver, bounded loops', () => {
    const r = checkWorkflowGraph(graph, { tools: MARKETING_T2_TOOLS });
    expect(r.errors).toEqual([]);
    expect(graph.roles.map((x) => x.name)).toEqual(['Campaign Orchestrator', 'Intent Analyst', 'Performance and Budget Analyst', 'Creative Brief and Delivery Coordinator', 'Campaign Policy Reviewer']);
    expect(graph.nodes.find((n) => n.id === 'analyses')).toMatchObject({ type: 'join', requiredInputs: ['intent_step', 'performance_step'] });
    expect(graph.nodes.find((n) => n.id === 'task3')).toMatchObject({ type: 'external_system', returnsArtifact: 'delivery_manifest' });
    expect(graph.nodes.find((n) => n.id === 'approver')).toMatchObject({ type: 'human_step', simulated: true });
    expect(graph.loops!.map((l) => [l.id, l.maxIterations])).toEqual([['creative_revision', 2], ['plan_revision', 2], ['approval_revision', 2], ['weekly_cycle', 12]]);
    expect(graph.limits.maxTransitions).toBe(400);
  });

  it('the agent view keeps the external system and the simulated flag, and hides the private reference outcomes', () => {
    const view = agentGraphProjection(checkWorkflowGraph(graph).graph!);
    expect(view.nodes.find((n) => n.id === 'task3')).toMatchObject({ type: 'external_system', system: expect.stringContaining('Task3'), sendsRefs: ['production_request'] });
    expect(view.nodes.find((n) => n.id === 'approver')).toMatchObject({ simulated: true });
    expect(view.artifacts.map((a) => a.id)).not.toContain('reference_outcomes');
  });

  it('an external system may not receive private material or anything no earlier step produced', () => {
    const g = JSON.parse(JSON.stringify(graph)) as WorkflowGraphInput;
    const task3 = g.nodes.find((n) => n.id === 'task3') as { sendsRefs: string[] };
    task3.sendsRefs = ['reference_outcomes'];
    expect(checkWorkflowGraph(g).errors.map((e) => e.code)).toContain('PRIVATE_TO_ACTOR');
    task3.sendsRefs = ['closeout_report'];
    expect(checkWorkflowGraph(g).errors.map((e) => e.code)).toContain('ARTIFACT_NOT_AVAILABLE');
  });

  it('every tool a role holds is in the form catalogue', () => {
    for (const r of graph.roles) for (const t of r.tools ?? []) expect(MARKETING_T2_TOOLS).toContain(t);
  });
});
