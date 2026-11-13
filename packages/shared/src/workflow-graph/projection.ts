import type { WorkflowGraph, WorkflowNode } from './schema';

/**
 * The agent-visible projection of a graph (handover chapter 17 §5): allowed evidence, tools, role instructions and
 * declared handoffs only. Private reference and rubric artifacts, future evidence, rubric bindings and decision
 * predicates are removed. The server applies this to every agent-facing payload; hiding in the UI is not enough.
 */
export function agentGraphProjection(g: WorkflowGraph) {
  const hidden = new Set(g.artifacts.filter((a) => a.visibility !== 'actor' || a.revealAtNodeId).map((a) => a.id));
  const keep = (ids: string[]) => ids.filter((id) => !hidden.has(id));
  const node = (n: WorkflowNode) => {
    const base = { id: n.id, type: n.type, label: n.label, policyRuleVersionIds: n.policyRuleVersionIds };
    switch (n.type) {
      case 'input':
        return { ...base, provides: keep(n.provides) };
      case 'agent_step':
        return { ...base, roleId: n.roleId, instruction: n.instruction, inputRefs: keep(n.inputRefs), outputArtifact: n.outputArtifact };
      case 'decision':
        return { ...base, question: n.question, outcomes: n.conditions.map((c) => ({ id: c.id, label: c.label })) };
      case 'join':
        return { ...base, requiredInputs: n.requiredInputs, optionalInputs: n.optionalInputs };
      case 'human_step':
        return { ...base, actorRole: n.actorRole, prompt: n.prompt, responseSchema: n.responseSchema, permittedEvidence: keep(n.permittedEvidence), timeoutMinutes: n.timeoutMinutes, ...(n.simulated ? { simulated: true } : {}) };
      case 'external_system':
        return { ...base, system: n.system, request: n.request, sendsRefs: keep(n.sendsRefs), returnsArtifact: n.returnsArtifact };
      case 'output':
        return { ...base, deliverable: n.deliverable, completionCondition: n.completionCondition };
      case 'escalation':
        return { ...base, reason: n.reason };
    }
  };
  return {
    schemaVersion: g.schemaVersion,
    templateId: g.templateId,
    templateVersion: g.templateVersion,
    agentMode: g.agentMode,
    roles: g.roles.map((r) => ({ ...r, evidenceRefs: keep(r.evidenceRefs) })),
    artifacts: g.artifacts.filter((a) => !hidden.has(a.id)).map(({ id, label, schemaRef }) => ({ id, label, ...(schemaRef ? { schemaRef } : {}) })),
    nodes: g.nodes.map(node),
    edges: g.edges.map(({ id, from, to, port, label }) => ({ id, from, to, ...(port ? { port } : {}), label })),
    loops: g.loops.map(({ id, returnEdgeId, maxIterations, exhaustedTarget }) => ({ id, returnEdgeId, maxIterations, exhaustedTarget })),
    limits: g.limits,
  };
}

/**
 * RFC 8785 (JCS) canonical JSON for plain JSON values: keys sorted by UTF-16 code units, no whitespace, ECMAScript
 * number formatting. Hash = lowercase hex SHA-256 of the UTF-8 bytes (computed by the caller, so this module stays
 * usable in the browser).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot encode a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
}

/** What the graph content hash covers: everything except presentation layout. */
export function graphHashInput(g: WorkflowGraph): string {
  const { layout: _layout, ...content } = g;
  void _layout;
  return canonicalJson(content);
}
