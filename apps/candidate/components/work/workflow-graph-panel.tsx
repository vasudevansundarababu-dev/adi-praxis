'use client';
import { useEffect, useMemo, useState } from 'react';
import { checkWorkflowGraph, type WorkflowGraph, type WorkflowGraphInput, type WorkflowNode } from '@praxis/shared';
import { WorkflowGraphView } from './workflow-graph-view';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';

/**
 * Flow preview below both editors (handover v2.1 ch. 04, 05). One graph per task, stored in output.workflowGraph.
 * Classic can edit node content; Chatbot shows the same graph read-only. Edits go through the editor's autosave via
 * the praxis:patch-output event, so there is one writer and one revision sequence.
 */
export function WorkflowGraphPanel({
  taskId,
  graph: stored,
  startingGraph,
  agentMode,
  editable,
}: {
  taskId: string;
  graph: unknown;
  startingGraph: WorkflowGraphInput | null;
  agentMode: 'SINGLE' | 'MULTI';
  editable: boolean;
}) {
  const [draft, setDraft] = useState<unknown>(stored);
  const [selected, setSelected] = useState<string | null>(null);
  const [asList, setAsList] = useState(false);
  useEffect(() => setDraft(stored), [stored]);

  const result = useMemo(() => (draft ? checkWorkflowGraph(draft) : null), [draft]);
  const graph = result?.graph ?? null;
  const problemNodes = useMemo(() => new Set((result?.errors ?? []).map((e) => e.nodeId).filter((x): x is string => !!x)), [result]);

  const save = (next: WorkflowGraphInput | WorkflowGraph) => {
    setDraft(next);
    window.dispatchEvent(new CustomEvent('praxis:patch-output', { detail: { taskId, patch: { workflowGraph: next } } }));
  };

  if (!draft) {
    return (
      <section aria-labelledby="flow-h" className="mt-6 space-y-2 rounded-md border border-line p-3">
        <h2 id="flow-h" className="font-medium">Workflow</h2>
        <p className="text-sm text-fg-muted">Agent mode: {agentMode === 'SINGLE' ? 'Single agent' : 'Multi agent'} (set by the template).</p>
        {startingGraph ? (
          editable ? (
            <button type="button" className="rounded border border-line p-2" onClick={() => save(structuredClone(startingGraph))}>
              Start from the template workflow
            </button>
          ) : (
            <p className="text-sm">No workflow yet. Switch to Classic to start from the template workflow.</p>
          )
        ) : (
          <p className="text-sm">This template has no workflow graph yet.</p>
        )}
      </section>
    );
  }

  if (!graph) {
    return (
      <section aria-labelledby="flow-h" className="mt-6 space-y-2 rounded-md border border-error p-3">
        <h2 id="flow-h" className="font-medium">Workflow</h2>
        <p role="alert" className="text-sm text-error">The saved workflow cannot be read: {result?.errors[0]?.message ?? 'unknown problem'}.</p>
        {editable && startingGraph && (
          <button type="button" className="rounded border border-line p-2" onClick={() => save(structuredClone(startingGraph))}>
            Replace with the template workflow
          </button>
        )}
      </section>
    );
  }

  const node = graph.nodes.find((n) => n.id === selected) ?? null;
  return (
    <section aria-labelledby="flow-h" className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="flow-h" className="font-medium">
          Workflow · {graph.nodes.length} steps · {agentMode === 'SINGLE' ? 'Single agent' : 'Multi agent'}
        </h2>
        <button type="button" className="text-sm text-link underline" onClick={() => setAsList((v) => !v)}>
          {asList ? 'Show as graph' : 'Show as list'}
        </button>
        <span className={`text-xs ${result!.ok ? 'text-fg-muted' : 'text-error'}`} aria-live="polite">
          {result!.ok ? 'Passes every workflow check' : `${result!.errors.length} problem${result!.errors.length === 1 ? '' : 's'} to fix before submitting`}
        </span>
      </div>
      {node && <NodeEditor key={node.id} graph={graph} node={node} editable={editable} onChange={save} onClose={() => setSelected(null)} />}
      <WorkflowGraphView graph={graph} selected={selected} onSelect={setSelected} problemNodes={problemNodes} asList={asList} />
      {(result!.errors.length > 0 || result!.warnings.length > 0) && (
        <ul className="space-y-1 text-sm" aria-label="Workflow problems">
          {result!.errors.map((e, i) => (
            <li key={`e${i}`} className="text-error">
              {e.nodeId ? (
                <button type="button" className="underline" onClick={() => setSelected(e.nodeId!)}>
                  {e.message}
                </button>
              ) : (
                e.message
              )}
            </li>
          ))}
          {result!.warnings.map((w, i) => (
            <li key={`w${i}`} className="text-warning">
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-muted">A person inside the case appears as a dashed rounded step. Expert review and PM approval of this task happen outside the workflow.</p>
    </section>
  );
}

/** Edit the selected node's content above the graph. Structure stays valid: ids and connections are not edited here. */
function NodeEditor({ graph, node, editable, onChange, onClose }: { graph: WorkflowGraph; node: WorkflowNode; editable: boolean; onChange(g: WorkflowGraph): void; onClose(): void }) {
  const set = (patch: Partial<WorkflowNode>) => onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? ({ ...n, ...patch } as WorkflowNode) : n)) });
  const loop = graph.loops.find((l) => graph.edges.find((e) => e.id === l.returnEdgeId)?.from === node.id);
  const canInsert = node.type === 'agent_step' && graph.edges.filter((e) => e.from === node.id && !graph.loops.some((l) => l.returnEdgeId === e.id)).length === 1;
  const insertAfter = () => {
    const n = graph.nodes.length + 1;
    let id = `step${n}`;
    while (graph.nodes.some((x) => x.id === id)) id = `${id}x`;
    const nextEdge = graph.edges.find((e) => e.from === node.id && !graph.loops.some((l) => l.returnEdgeId === e.id))!;
    const prev = node as Extract<WorkflowNode, { type: 'agent_step' }>;
    onChange({
      ...graph,
      artifacts: [...graph.artifacts, { id: `${id}_out`, label: 'New step result', visibility: 'actor' }],
      nodes: [...graph.nodes, { id, type: 'agent_step', label: 'New step', roleId: prev.roleId, instruction: 'Describe the observable work this step does.', inputRefs: [prev.outputArtifact], outputArtifact: `${id}_out`, policyRuleVersionIds: [], rubricCriterionIds: [] }],
      edges: [...graph.edges.map((e) => (e.id === nextEdge.id ? { ...e, from: id } : e)), { id: `${id}_in`, from: node.id, to: id, label: '' }],
    });
  };
  return (
    <div className="rounded-md border border-line p-3" aria-label={`Edit ${node.label}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{node.label}</h3>
        <button type="button" className="text-sm text-link underline" onClick={onClose}>
          Close
        </button>
      </div>
      <fieldset disabled={!editable} className="mt-2 space-y-2">
        <label className="block text-sm">
          Name
          <input className={input} value={node.label} onChange={(e) => set({ label: e.target.value })} />
        </label>
        {node.type === 'agent_step' && (
          <label className="block text-sm">
            Instruction (what the agent does; never the answer or rubric)
            <textarea className={input} rows={3} value={node.instruction} onChange={(e) => set({ instruction: e.target.value })} />
          </label>
        )}
        {node.type === 'decision' && (
          <>
            <label className="block text-sm">
              Question
              <input className={input} value={node.question} onChange={(e) => set({ question: e.target.value })} />
            </label>
            {node.conditions.map((c, i) => (
              <div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_1fr]">
                <label className="block text-sm">
                  Outcome
                  <input className={input} value={c.label} onChange={(e) => set({ conditions: node.conditions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                </label>
                <label className="block text-sm">
                  Field
                  <input className={input} value={c.field} onChange={(e) => set({ conditions: node.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })} />
                </label>
                <label className="block text-sm">
                  Test
                  <select className={input} value={c.op} onChange={(e) => set({ conditions: node.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof c.op } : x)) })}>
                    {['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'present', 'absent'].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Value
                  <input className={input} value={c.value === undefined ? '' : String(c.value)} onChange={(e) => set({ conditions: node.conditions.map((x, j) => (j === i ? { ...x, value: parseValue(e.target.value) } : x)) })} />
                </label>
              </div>
            ))}
            <p className="text-xs text-fg-muted">Every decision also routes “else” and “unknown”. These routes are part of the workflow and cannot be removed here.</p>
          </>
        )}
        {node.type === 'human_step' && (
          <>
            <label className="block text-sm">
              Person in the case (not the Praxis reviewer)
              <input className={input} value={node.actorRole} onChange={(e) => set({ actorRole: e.target.value })} />
            </label>
            <label className="block text-sm">
              What they are asked
              <textarea className={input} rows={2} value={node.prompt} onChange={(e) => set({ prompt: e.target.value })} />
            </label>
            <label className="block text-sm">
              Minutes before the timeout route
              <input type="number" min={1} className={input} value={node.timeoutMinutes} onChange={(e) => set({ timeoutMinutes: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          </>
        )}
        {node.type === 'output' && (
          <label className="block text-sm">
            Completion condition
            <input className={input} value={node.completionCondition} onChange={(e) => set({ completionCondition: e.target.value })} />
          </label>
        )}
        {node.type === 'escalation' && (
          <label className="block text-sm">
            Why the case escalates
            <input className={input} value={node.reason} onChange={(e) => set({ reason: e.target.value })} />
          </label>
        )}
        {loop && (
          <label className="block text-sm">
            Maximum times this correction loop may repeat
            <input
              type="number"
              min={1}
              max={50}
              className={input}
              value={loop.maxIterations}
              onChange={(e) => onChange({ ...graph, loops: graph.loops.map((l) => (l.id === loop.id ? { ...l, maxIterations: Math.min(50, Math.max(1, Number(e.target.value) || 1)) } : l)) })}
            />
          </label>
        )}
        {canInsert && editable && (
          <button type="button" className="rounded border border-line p-2 text-sm" onClick={insertAfter}>
            Add a step after this one
          </button>
        )}
      </fieldset>
    </div>
  );
}

function parseValue(v: string): string | number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}
