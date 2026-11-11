import { z } from 'zod';
import { DECISION_ELSE, DECISION_UNKNOWN, HUMAN_RESPONDED, HUMAN_TIMEOUT, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from './schema';

/**
 * Structural edits to a WorkflowGraph (authoring v2.1 Wave 2: joins, loops and human steps in both editors).
 * Pure functions: they return a new graph and never throw on a "bad" shape the author is mid-way through; the checker
 * reports what is still wrong. They throw only when the operation itself cannot apply (unknown node, wrong node kind).
 * The same operations back the Classic buttons and the chatbot's proposals (applied only after the SME confirms).
 */
type G = WorkflowGraph;

const Label = z.string().trim().min(1).max(200);
const Text = z.string().trim().min(1).max(4000);
const NodeRef = z.string().trim().min(1).max(64);

/** The operations an author (or a confirmed chatbot proposal) may apply. Strict: no other field is accepted. */
export const GraphOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename_node'), nodeId: NodeRef, label: Label }).strict(),
  z.object({ op: z.literal('set_instruction'), nodeId: NodeRef, instruction: Text }).strict(),
  z.object({ op: z.literal('add_step_after'), nodeId: NodeRef, label: Label, instruction: Text }).strict(),
  z.object({ op: z.literal('add_decision_after'), nodeId: NodeRef, question: Text, yesLabel: Label, noLabel: Label }).strict(),
  z.object({ op: z.literal('add_human_step_after'), nodeId: NodeRef, label: Label, actorRole: Label, prompt: Text }).strict(),
  z.object({ op: z.literal('add_parallel_step'), nodeId: NodeRef, label: Label, instruction: Text }).strict(),
  z.object({ op: z.literal('add_correction_loop'), decisionId: NodeRef, backToNodeId: NodeRef, label: Label, maxIterations: z.number().int().min(1).max(50) }).strict(),
  z.object({ op: z.literal('remove_node'), nodeId: NodeRef }).strict(),
]);
export type GraphOp = z.infer<typeof GraphOp>;

export class GraphEditError extends Error {}

const clone = (g: G): G => structuredClone(g);
const nodeOf = (g: G, id: string) => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new GraphEditError(`There is no step ${id}`);
  return n;
};
const freshId = (g: G, base: string) => {
  const taken = new Set([...g.nodes.map((n) => n.id), ...g.edges.map((e) => e.id), ...g.artifacts.map((a) => a.id), ...g.loops.map((l) => l.id)]);
  let i = 1;
  while (taken.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
};
const returnEdgeIds = (g: G) => new Set(g.loops.map((l) => l.returnEdgeId));
/** The one forward, port-less edge leaving a node, which an insertion splices into. */
const plainOut = (g: G, id: string, what: string): WorkflowEdge => {
  const loops = returnEdgeIds(g);
  const outs = g.edges.filter((e) => e.from === id && !loops.has(e.id));
  if (outs.length !== 1 || outs[0]!.port) throw new GraphEditError(`${what} can be added only after a step with exactly one next step`);
  return outs[0]!;
};
const outputOf = (n: WorkflowNode) => (n.type === 'agent_step' ? n.outputArtifact : n.type === 'input' ? n.provides[0] : undefined);
const firstRole = (g: G, n: WorkflowNode) => (n.type === 'agent_step' ? n.roleId : g.roles[0]!.id);
const escalationOf = (g: G): { graph: G; id: string } => {
  const existing = g.nodes.find((n) => n.type === 'escalation');
  if (existing) return { graph: g, id: existing.id };
  const id = freshId(g, 'escalate');
  return { graph: { ...g, nodes: [...g.nodes, { id, type: 'escalation', label: 'Escalate', reason: 'The case cannot be completed on this path.', policyRuleVersionIds: [], rubricCriterionIds: [] }] }, id };
};
const base = { policyRuleVersionIds: [] as string[], rubricCriterionIds: [] as string[] };

function newStep(g: G, after: WorkflowNode, label: string, instruction: string): { graph: G; id: string } {
  const id = freshId(g, 'step');
  const out = freshId(g, `${id}_out`);
  const input = outputOf(after);
  return {
    id,
    graph: {
      ...g,
      artifacts: [...g.artifacts, { id: out, label: `${label} result`, visibility: 'actor' }],
      nodes: [...g.nodes, { id, type: 'agent_step', label, roleId: firstRole(g, after), instruction, inputRefs: input ? [input] : [], outputArtifact: out, ...base }],
    },
  };
}

export function applyGraphOp(graph: G, raw: GraphOp): G {
  const op = GraphOp.parse(raw);
  let g = clone(graph);
  switch (op.op) {
    case 'rename_node': {
      nodeOf(g, op.nodeId);
      g.nodes = g.nodes.map((n) => (n.id === op.nodeId ? ({ ...n, label: op.label } as WorkflowNode) : n));
      return g;
    }
    case 'set_instruction': {
      const n = nodeOf(g, op.nodeId);
      if (n.type !== 'agent_step') throw new GraphEditError('Only an agent step has an instruction');
      g.nodes = g.nodes.map((x) => (x.id === op.nodeId ? { ...n, instruction: op.instruction } : x));
      return g;
    }
    case 'add_step_after': {
      const n = nodeOf(g, op.nodeId);
      const next = plainOut(g, n.id, 'A step');
      const made = newStep(g, n, op.label, op.instruction);
      g = made.graph;
      g.edges = [...g.edges.map((e) => (e.id === next.id ? { ...e, from: made.id } : e)), { id: freshId(g, 'e'), from: n.id, to: made.id, label: '' }];
      return g;
    }
    case 'add_decision_after': {
      const n = nodeOf(g, op.nodeId);
      const next = plainOut(g, n.id, 'A decision');
      const field = outputOf(n);
      if (!field) throw new GraphEditError('A decision needs the result of the step before it');
      const esc = escalationOf(g);
      g = esc.graph;
      const id = freshId(g, 'decision');
      const conditions = [
        { id: 'yes', label: op.yesLabel, field: `${field}.decision`, op: 'eq' as const, value: 'yes' },
        { id: 'no', label: op.noLabel, field: `${field}.decision`, op: 'eq' as const, value: 'no' },
      ];
      g.nodes = [...g.nodes, { id, type: 'decision', label: op.question.slice(0, 200), question: op.question, conditions, ...base }];
      g.edges = g.edges.map((x) => (x.id === next.id ? { ...x, to: id } : x));
      // One edge at a time, so each gets a fresh id.
      for (const [to, port, label] of [[next.to, 'yes', op.yesLabel], [esc.id, 'no', op.noLabel], [esc.id, DECISION_ELSE, 'Other'], [esc.id, DECISION_UNKNOWN, 'Unclear']] as const) {
        g.edges = [...g.edges, { id: freshId(g, 'e'), from: id, to, port, label }];
      }
      return g;
    }
    case 'add_human_step_after': {
      const n = nodeOf(g, op.nodeId);
      const next = plainOut(g, n.id, 'A person step');
      const esc = escalationOf(g);
      g = esc.graph;
      const id = freshId(g, 'person');
      const evidence = g.artifacts.filter((a) => a.visibility === 'actor' && !a.revealAtNodeId).map((a) => a.id).slice(0, 1);
      g.nodes = [
        ...g.nodes,
        { id, type: 'human_step', label: op.label, actorRole: op.actorRole, prompt: op.prompt, responseSchema: [{ key: 'decision', label: 'Decision', type: 'choice', options: ['Approve', 'Return'] }], permittedEvidence: evidence, timeoutMinutes: 1440, ...base },
      ];
      g.edges = g.edges.map((x) => (x.id === next.id ? { ...x, to: id } : x));
      g.edges = [...g.edges, { id: freshId(g, 'e'), from: id, to: next.to, port: HUMAN_RESPONDED, label: 'Responded' }];
      g.edges = [...g.edges, { id: freshId(g, 'e'), from: id, to: esc.id, port: HUMAN_TIMEOUT, label: 'No response' }];
      return g;
    }
    case 'add_parallel_step': {
      const n = nodeOf(g, op.nodeId);
      if (n.type !== 'agent_step') throw new GraphEditError('A parallel step runs alongside an agent step');
      const loops = returnEdgeIds(g);
      const ins = g.edges.filter((e) => e.to === n.id && !loops.has(e.id));
      if (ins.length !== 1 || ins[0]!.port) throw new GraphEditError('A parallel step needs a step with exactly one step before it');
      const before = nodeOf(g, ins[0]!.from);
      const next = plainOut(g, n.id, 'A parallel step');
      const made = newStep(g, before, op.label, op.instruction);
      g = made.graph;
      // Same inputs as the step it runs beside, so both can start together.
      g.nodes = g.nodes.map((x) => (x.id === made.id && x.type === 'agent_step' ? { ...x, inputRefs: [...n.inputRefs] } : x));
      g.edges = [...g.edges, { id: freshId(g, 'e'), from: before.id, to: made.id, label: '' }];
      const target = nodeOf(g, next.to);
      if (target.type === 'join') {
        g.nodes = g.nodes.map((x) => (x.id === target.id && x.type === 'join' ? { ...x, requiredInputs: [...x.requiredInputs, made.id] } : x));
        g.edges = [...g.edges, { id: freshId(g, 'e'), from: made.id, to: target.id, label: '' }];
      } else {
        const join = freshId(g, 'join');
        g.nodes = [...g.nodes, { id: join, type: 'join', label: 'Both done', requiredInputs: [n.id, made.id], optionalInputs: [], ...base }];
        g.edges = g.edges.map((e) => (e.id === next.id ? { ...e, from: join } : e));
        g.edges = [...g.edges, { id: freshId(g, 'e'), from: n.id, to: join, label: '' }];
        g.edges = [...g.edges, { id: freshId(g, 'e'), from: made.id, to: join, label: '' }];
      }
      return g;
    }
    case 'add_correction_loop': {
      const d = nodeOf(g, op.decisionId);
      if (d.type !== 'decision') throw new GraphEditError('A correction loop starts at a decision');
      nodeOf(g, op.backToNodeId);
      const esc = escalationOf(g);
      g = esc.graph;
      const port = freshId(g, 'retry');
      const field = d.conditions[0]!.field;
      g.nodes = g.nodes.map((x) => (x.id === d.id && x.type === 'decision' ? { ...x, conditions: [...x.conditions, { id: port, label: op.label, field, op: 'eq' as const, value: 'retry' }] } : x));
      const edgeId = freshId(g, 'e');
      g.edges = [...g.edges, { id: edgeId, from: d.id, to: op.backToNodeId, port, label: op.label }];
      g.loops = [...g.loops, { id: freshId(g, 'loop'), returnEdgeId: edgeId, maxIterations: op.maxIterations, exitCondition: `Leaves when "${op.label}" no longer applies.`, exhaustedTarget: esc.id }];
      return g;
    }
    case 'remove_node': {
      const n = nodeOf(g, op.nodeId);
      if (n.type === 'input' || n.type === 'output') throw new GraphEditError('The case input and the final output cannot be removed');
      const ins = g.edges.filter((e) => e.to === n.id);
      const outs = g.edges.filter((e) => e.from === n.id);
      // Reconnect predecessors to the node's main continuation: the plain edge, the first decision outcome, or "responded".
      const main = outs.find((e) => !e.port) ?? outs.find((e) => e.port === HUMAN_RESPONDED) ?? outs.find((e) => e.port && e.port !== DECISION_ELSE && e.port !== DECISION_UNKNOWN && e.port !== HUMAN_TIMEOUT);
      const removedEdges = new Set([...ins, ...outs].map((e) => e.id));
      g.edges = g.edges.filter((e) => !removedEdges.has(e.id));
      if (main && main.to !== n.id) for (const e of ins) if (e.from !== n.id) g.edges.push({ ...e, to: main.to });
      // A loop whose return edge is gone is dropped (reconnected edges keep their id, so their loop stays).
      g.loops = g.loops.filter((l) => g.edges.some((e) => e.id === l.returnEdgeId) && l.exhaustedTarget !== n.id);
      g.nodes = g.nodes.filter((x) => x.id !== n.id).map((x) => (x.type === 'join' ? { ...x, requiredInputs: x.requiredInputs.filter((r) => r !== n.id), optionalInputs: x.optionalInputs.filter((r) => r !== n.id) } : x));
      if (n.type === 'agent_step' && !g.nodes.some((x) => x.type === 'agent_step' && x.inputRefs.includes(n.outputArtifact))) g.artifacts = g.artifacts.filter((a) => a.id !== n.outputArtifact);
      return g;
    }
  }
}

/** Applies several operations in order; the first that cannot apply stops the batch with its message. */
export function applyGraphOps(graph: G, ops: GraphOp[]): G {
  return ops.reduce((g, op) => applyGraphOp(g, op), graph);
}

/** Free text an operation adds (labels, instructions, prompts): used to check it came from the SME's own words. */
export function graphOpText(op: GraphOp): string[] {
  switch (op.op) {
    case 'rename_node':
      return [op.label];
    case 'set_instruction':
      return [op.instruction];
    case 'add_step_after':
    case 'add_parallel_step':
      return [op.label, op.instruction];
    case 'add_decision_after':
      return [op.question, op.yesLabel, op.noLabel];
    case 'add_human_step_after':
      return [op.label, op.actorRole, op.prompt];
    case 'add_correction_loop':
      return [op.label];
    case 'remove_node':
      return [];
  }
}
