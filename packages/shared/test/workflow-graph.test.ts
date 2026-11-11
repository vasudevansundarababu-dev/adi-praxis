import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentGraphProjection,
  canonicalJson,
  checkWorkflowGraph,
  graphHashInput,
  layoutWorkflowGraph,
  WorkflowGraph,
} from '../src/workflow-graph';
import { INVALID_CASES, buildInvalidCase, multiAgentKyb, singleAgentKyc } from '../src/workflow-graph/fixtures';
import { renderWorkflowGraphFixtures } from './workflow-graph-fixture-files';

const codes = (g: unknown) => checkWorkflowGraph(g).errors.map((e) => e.code);

describe('WorkflowGraph v1 contract', () => {
  it('accepts the single-agent and multi-agent reference graphs with no errors', () => {
    for (const g of [singleAgentKyc(), multiAgentKyb()]) {
      const r = checkWorkflowGraph(g);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it.each(INVALID_CASES.map((c) => [c.name, c] as const))('rejects %s with its precise code', (_n, c) => {
    const r = checkWorkflowGraph(buildInvalidCase(c));
    expect(r.ok).toBe(false);
    expect(codes(buildInvalidCase(c))).toEqual(expect.arrayContaining(c.expect));
    for (const e of r.errors) expect(e.message.length).toBeGreaterThan(5);
  });

  it('names the decision and the missing route in plain words', () => {
    const r = checkWorkflowGraph(buildInvalidCase(INVALID_CASES.find((c) => c.name === 'decision-without-else')!));
    expect(r.errors[0]).toMatchObject({ code: 'DECISION_MISSING_ELSE', nodeId: 'complete' });
    expect(r.errors[0]!.message).toContain('Evidence complete?');
  });

  it('accepts nested loops when each cycle closes through its own declared loop', () => {
    const g = singleAgentKyc();
    g.nodes.push({ id: 'fix', type: 'agent_step', label: 'Fix recommendation', roleId: 'analyst', instruction: 'Correct the recommendation.', inputRefs: ['recommendation'], outputArtifact: 'fixed' });
    g.artifacts!.push({ id: 'fixed', label: 'Corrected recommendation', visibility: 'actor' });
    g.edges = g.edges.filter((e) => e.id !== 'e9');
    g.nodes.push({ id: 'ok', type: 'decision', label: 'Lead confirmed?', question: 'Did the lead confirm?', conditions: [{ id: 'confirmed', label: 'Confirmed', field: 'recommendation.verdict', op: 'eq', value: 'Confirm' }] });
    g.edges.push(
      { id: 'e20', from: 'lead', to: 'ok', port: 'responded', label: 'Responded' },
      { id: 'e21', from: 'ok', to: 'done', port: 'confirmed', label: 'Confirmed' },
      { id: 'e22', from: 'ok', to: 'fix', port: 'else', label: 'Returned' },
      { id: 'e23', from: 'ok', to: 'escalate', port: 'unknown', label: 'Unclear' },
      { id: 'e24', from: 'fix', to: 'review', label: 'Re-check' },
    );
    g.loops!.push({ id: 'rework', returnEdgeId: 'e24', maxIterations: 3, exitCondition: 'Lead confirms', exhaustedTarget: 'escalate' });
    const r = checkWorkflowGraph(g);
    expect(r.errors).toEqual([]);
  });

  it('checks tools, rules and rubric against the template context when given', () => {
    const g = singleAgentKyc();
    (g.nodes[4] as { policyRuleVersionIds?: string[] }).policyRuleVersionIds = ['rule-v9'];
    const r = checkWorkflowGraph(g, { tools: ['document_check'], policyRuleVersionIds: ['rule-v1'], rubricCriterionIds: ['C1'] });
    expect(r.errors.map((e) => e.code).sort()).toEqual(['TOOL_NOT_ALLOWED', 'UNKNOWN_REFERENCE']);
    expect(checkWorkflowGraph(singleAgentKyc()).warnings.map((w) => w.code)).toContain('REFERENCE_NOT_CHECKED');
  });

  it('warns when a human step looks like platform review', () => {
    const g = singleAgentKyc();
    (g.nodes.find((n) => n.id === 'lead') as { actorRole: string }).actorRole = 'Praxis expert reviewer';
    expect(checkWorkflowGraph(g).warnings.map((w) => w.code)).toContain('HUMAN_LOOKS_LIKE_PLATFORM_REVIEW');
  });
});

describe('agent projection', () => {
  it('removes private artifacts, rubric bindings and decision predicates', () => {
    const g = WorkflowGraph.parse(multiAgentKyb());
    const p = agentGraphProjection(g);
    const text = JSON.stringify(p);
    expect(text).not.toContain('rubric_key');
    expect(text).not.toContain('rubricCriterionIds');
    expect(text).not.toContain('consolidated.risk');
    expect(p.nodes.find((n) => n.id === 'refer')).toMatchObject({ outcomes: [{ id: 'refer_yes', label: 'Refer' }, { id: 'refer_no', label: 'No referral' }] });
    const single = JSON.stringify(agentGraphProjection(WorkflowGraph.parse(singleAgentKyc())));
    expect(single).not.toContain('reference_answer');
  });

  it('withholds future evidence until its reveal node', () => {
    const g = singleAgentKyc();
    g.artifacts!.push({ id: 'late_doc', label: 'Late filing', visibility: 'actor', revealAtNodeId: 'decide' });
    expect(JSON.stringify(agentGraphProjection(WorkflowGraph.parse(g)))).not.toContain('late_doc');
  });
});

describe('layout', () => {
  it('runs left to right, sends exception routes below the main path and marks loop returns', () => {
    const l = layoutWorkflowGraph(WorkflowGraph.parse(singleAgentKyc()))!;
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(at('start').col).toBe(0);
    expect(at('review').col).toBeGreaterThan(at('start').col);
    expect(at('decide').row).toBe(at('complete').row);
    expect(at('escalate').row).toBeGreaterThan(at('complete').row);
    expect(l.edges.find((e) => e.id === 'e7')!.kind).toBe('return');
    const again = layoutWorkflowGraph(WorkflowGraph.parse(singleAgentKyc()));
    expect(again).toEqual(l);
  });

  it('places parallel specialists in the same column and different rows', () => {
    const l = layoutWorkflowGraph(WorkflowGraph.parse(multiAgentKyb()))!;
    const own = l.nodes.find((n) => n.id === 'own')!;
    const screen = l.nodes.find((n) => n.id === 'screen')!;
    expect(own.col).toBe(screen.col);
    expect(own.row).not.toBe(screen.row);
  });
});

describe('canonical hash input', () => {
  it('sorts keys, drops whitespace and ignores layout', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1.5, y: -0 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":1.5}}');
    const g = WorkflowGraph.parse(singleAgentKyc());
    expect(graphHashInput({ ...g, layout: { start: { x: 10, y: 20 } } })).toBe(graphHashInput(g));
  });
});

describe('fixture files for Anvil', () => {
  it('match the fixture module byte for byte (regenerate with scripts/write-workflow-graph-fixtures.ts)', () => {
    const root = join(__dirname, '../../../contracts/praxis/workflow-graph/fixtures');
    for (const [rel, body] of renderWorkflowGraphFixtures()) expect(readFileSync(join(root, rel), 'utf8')).toBe(body);
  });
});

describe('template starting workflows (Wave 1 and Wave 2)', () => {
  it.each(['KYC onboarding and refresh', 'KYB and beneficial ownership', 'AML transaction-monitoring alerts', 'Omnichannel Creative & Locale Compliance', 'Launch of Noise Cancelling Phone', 'Adverse media review', 'Enhanced due diligence', 'Customer risk rating'])('%s passes the checker with no errors or warnings', async (name) => {
    const { templateStartingGraph } = await import('../src/workflow-graph');
    const g = templateStartingGraph(name)!;
    expect(g).not.toBeNull();
    const r = checkWorkflowGraph(g);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('Wave 2: only Enhanced due diligence has a business human step (its draft names an approver hand-off)', async () => {
    const { templateStartingGraph, WAVE2_GRAPH_TEMPLATES } = await import('../src/workflow-graph');
    expect(WAVE2_GRAPH_TEMPLATES).toEqual(['Adverse media review', 'Enhanced due diligence', 'Customer risk rating']);
    const humans = (name: string) => templateStartingGraph(name)!.nodes.filter((n) => n.type === 'human_step');
    expect(humans('Enhanced due diligence')).toHaveLength(1);
    expect(humans('Enhanced due diligence')[0]).toMatchObject({ actorRole: 'Authorised approver' });
    expect(humans('Adverse media review')).toHaveLength(0);
    expect(humans('Customer risk rating')).toHaveLength(0);
    for (const name of WAVE2_GRAPH_TEMPLATES) expect(templateStartingGraph(name)!).toMatchObject({ agentMode: 'SINGLE', loops: [expect.objectContaining({ maxIterations: 2, exhaustedTarget: 'escalate' })] });
  });
  it('has no starting workflow for templates outside Waves 1 and 2', async () => {
    const { templateStartingGraph } = await import('../src/workflow-graph');
    expect(templateStartingGraph('Compliance monitoring')).toBeNull();
  });
});
