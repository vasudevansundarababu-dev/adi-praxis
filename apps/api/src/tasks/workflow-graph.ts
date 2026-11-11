import { agentGraphProjection, checkWorkflowGraph, graphHashInput, WorkflowGraph, type TaskCheck } from '@praxis/shared';
import { sha256 } from '../lib/crypto';

/**
 * The task's authored workflow graph (handover v2.1 ch. 05, 17 §5), stored as `output.workflowGraph`.
 * Optional in Wave 1: when present it must pass every structural check before submission. Drafts may be incomplete.
 */
export const GRAPH_SECTION = 'GRAPH';

export function graphOf(output: unknown): unknown {
  return output && typeof output === 'object' ? (output as { workflowGraph?: unknown }).workflowGraph : undefined;
}

export function graphChecks(output: unknown, template: { agentMode: 'SINGLE' | 'MULTI' }): TaskCheck[] {
  const raw = graphOf(output);
  if (raw === undefined || raw === null) return [];
  const r = checkWorkflowGraph(raw);
  const checks: TaskCheck[] = r.errors.map((e, i) => ({ id: `graph.${e.code.toLowerCase()}.${i}`, section: GRAPH_SECTION, ok: false, message: `Workflow: ${e.message}` }));
  checks.push(...r.warnings.map((w, i) => ({ id: `graph.${w.code.toLowerCase()}.${i}`, section: GRAPH_SECTION, ok: false, severity: 'warning' as const, message: `Workflow: ${w.message}` })));
  if (r.graph && r.graph.agentMode !== template.agentMode) {
    checks.push({ id: 'graph.agent_mode', section: GRAPH_SECTION, ok: false, message: `Workflow: this template is ${template.agentMode === 'SINGLE' ? 'single' : 'multi'}-agent; the agent mode is set by the template` });
  }
  if (!checks.some((c) => !c.ok && c.severity !== 'warning')) checks.unshift({ id: 'graph.valid', section: GRAPH_SECTION, ok: true, message: 'Workflow passes every structural check' });
  return checks;
}

/** Agent-facing view of the graph; private and future material removed server-side. Null when absent or invalid. */
export function graphAgentView(output: unknown) {
  const parsed = WorkflowGraph.safeParse(graphOf(output));
  return parsed.success ? agentGraphProjection(parsed.data) : null;
}

/** Content hash of a valid graph (RFC 8785 + SHA-256, layout excluded). */
export function graphContentHash(output: unknown): string | null {
  const parsed = WorkflowGraph.safeParse(graphOf(output));
  return parsed.success ? sha256(graphHashInput(parsed.data)) : null;
}
