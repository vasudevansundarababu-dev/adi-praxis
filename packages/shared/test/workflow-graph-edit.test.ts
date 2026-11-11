import { describe, expect, it } from 'vitest';
import { applyGraphOp, applyGraphOps, checkWorkflowGraph, GraphEditError, GraphOp, graphOpText, templateStartingGraph, WorkflowGraph, type WorkflowGraph as G } from '../src/workflow-graph';

const start = (name = 'KYC onboarding and refresh'): G => WorkflowGraph.parse(templateStartingGraph(name));
const errors = (g: G) => checkWorkflowGraph(g).errors.map((e) => e.code);

describe('Wave 2 graph edits: every operation keeps a valid graph valid', () => {
  it('adds a step after a step and keeps the flow connected', () => {
    const g = applyGraphOp(start(), { op: 'add_step_after', nodeId: 'conclude', label: 'Check sanctions', instruction: 'Screen every party.' });
    expect(errors(g)).toEqual([]);
    const added = g.nodes.find((n) => n.label === 'Check sanctions')!;
    expect(g.edges.some((e) => e.from === 'conclude' && e.to === added.id)).toBe(true);
  });

  it('adds a decision with else and unknown routes to an escalation', () => {
    const g = applyGraphOp(start(), { op: 'add_decision_after', nodeId: 'conclude', question: 'Is the risk acceptable?', yesLabel: 'Acceptable', noLabel: 'Too high' });
    expect(errors(g)).toEqual([]);
    const d = g.nodes.find((n) => n.type === 'decision' && n.label === 'Is the risk acceptable?')!;
    expect(g.edges.filter((e) => e.from === d.id).map((e) => e.port).sort()).toEqual(['else', 'no', 'unknown', 'yes']);
  });

  it('adds a person in the case with a timeout route, never platform review', () => {
    const g = applyGraphOp(start('KYB and beneficial ownership'), { op: 'add_human_step_after', nodeId: 'conclude', label: 'Relationship manager confirms', actorRole: 'Relationship manager', prompt: 'Confirm the ownership structure with the client.' });
    expect(errors(g)).toEqual([]);
    const h = g.nodes.find((n) => n.type === 'human_step')!;
    expect(g.edges.filter((e) => e.from === h.id).map((e) => e.port).sort()).toEqual(['responded', 'timeout']);
  });

  it('adds a parallel step with a branch-aware join, and a third into the same join', () => {
    let g = applyGraphOp(start(), { op: 'add_parallel_step', nodeId: 'review', label: 'Assess adverse media', instruction: 'Search the news for the applicant.' });
    expect(errors(g)).toEqual([]);
    const join = g.nodes.find((n) => n.type === 'join')!;
    expect(join.type === 'join' && join.requiredInputs).toHaveLength(2);
    g = applyGraphOp(g, { op: 'add_parallel_step', nodeId: 'review', label: 'Check registry', instruction: 'Look up the registry.' });
    expect(errors(g)).toEqual([]);
    expect(g.nodes.filter((n) => n.type === 'join')).toHaveLength(1);
    expect((g.nodes.find((n) => n.type === 'join') as { requiredInputs: string[] }).requiredInputs).toHaveLength(3);
  });

  it('adds a bounded correction loop with an exhausted exit outside the loop', () => {
    let g = applyGraphOp(start('KYB and beneficial ownership'), { op: 'add_decision_after', nodeId: 'conclude', question: 'Is the recommendation complete?', yesLabel: 'Complete', noLabel: 'Incomplete' });
    const d = g.nodes.find((n) => n.label === 'Is the recommendation complete?')!;
    g = applyGraphOp(g, { op: 'add_correction_loop', decisionId: d.id, backToNodeId: 'conclude', label: 'Needs correction', maxIterations: 3 });
    expect(errors(g)).toEqual([]);
    expect(g.loops.find((l) => l.maxIterations === 3)).toBeTruthy();
  });

  it('removes a step and reconnects around it; the checker reports anything left dangling', () => {
    const added = applyGraphOp(start(), { op: 'add_step_after', nodeId: 'conclude', label: 'Extra', instruction: 'Extra work.' });
    const id = added.nodes.find((n) => n.label === 'Extra')!.id;
    const g = applyGraphOp(added, { op: 'remove_node', nodeId: id });
    expect(errors(g)).toEqual([]);
    expect(g.nodes.some((n) => n.id === id)).toBe(false);
    const person = applyGraphOp(start(), { op: 'remove_node', nodeId: 'human' });
    expect(errors(person)).toEqual([]);
    expect(() => applyGraphOp(start(), { op: 'remove_node', nodeId: 'start' })).toThrow(GraphEditError);
  });

  it('refuses operations that cannot apply, with a plain reason', () => {
    expect(() => applyGraphOp(start(), { op: 'add_step_after', nodeId: 'sufficient', label: 'X', instruction: 'Y' })).toThrow(/exactly one next step/);
    expect(() => applyGraphOp(start(), { op: 'set_instruction', nodeId: 'sufficient', instruction: 'Y' })).toThrow(/Only an agent step/);
    expect(() => applyGraphOp(start(), { op: 'add_parallel_step', nodeId: 'conclude', label: 'X', instruction: 'Y' })).toThrow(/exactly one step before it/);
    expect(() => applyGraphOp(start(), { op: 'rename_node', nodeId: 'ghost', label: 'Y' })).toThrow(/no step ghost/);
  });

  it('accepts only the listed operations and fields', () => {
    expect(GraphOp.safeParse({ op: 'add_step_after', nodeId: 'a', label: 'b', instruction: 'c', code: 'rm -rf /' }).success).toBe(false);
    expect(GraphOp.safeParse({ op: 'run_shell', nodeId: 'a' }).success).toBe(false);
    expect(graphOpText({ op: 'add_human_step_after', nodeId: 'a', label: 'L', actorRole: 'R', prompt: 'P' })).toEqual(['L', 'R', 'P']);
  });

  it('applies a batch in order and leaves the input graph unchanged', () => {
    const g0 = start();
    const before = JSON.stringify(g0);
    const g = applyGraphOps(g0, [{ op: 'rename_node', nodeId: 'review', label: 'Review the file' }, { op: 'add_step_after', nodeId: 'conclude', label: 'Summarise', instruction: 'Summarise findings.' }]);
    expect(JSON.stringify(g0)).toBe(before);
    expect(g.nodes.find((n) => n.id === 'review')!.label).toBe('Review the file');
  });
});
