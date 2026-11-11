'use client';
import { checkWorkflowGraph } from '@praxis/shared';
import { useState } from 'react';
import { WorkflowGraphView } from './workflow-graph-view';

/**
 * The reviewer sees the same workflow graph the author built, beneath the task, read-only (handover v2.1 ch. 17 §4).
 * Selecting a node shows its details. Expert review and PM approval are platform steps, not graph nodes.
 */
export function ReviewGraph({ graph: raw }: { graph: unknown }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [asList, setAsList] = useState(false);
  const r = checkWorkflowGraph(raw);
  if (!r.graph) return <p role="alert" className="text-sm text-error">The workflow graph cannot be read: {r.errors[0]?.message}</p>;
  const node = r.graph.nodes.find((n) => n.id === selected);
  return (
    <section aria-labelledby="review-flow-h" className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="review-flow-h" className="text-lg font-semibold">Workflow · {r.graph.nodes.length} steps · {r.graph.agentMode === 'SINGLE' ? 'Single agent' : 'Multi agent'}</h2>
        <button type="button" className="text-sm text-link underline" onClick={() => setAsList((v) => !v)}>{asList ? 'Show as graph' : 'Show as list'}</button>
        <span className={`text-xs ${r.ok ? 'text-fg-muted' : 'text-error'}`}>{r.ok ? 'Passes every workflow check' : `${r.errors.length} workflow problem${r.errors.length === 1 ? '' : 's'}`}</span>
      </div>
      {node && <pre tabIndex={0} aria-label={`Details of ${node.label}`} className="max-h-60 overflow-auto rounded-md border border-line p-2 text-xs">{JSON.stringify(node, null, 2)}</pre>}
      <WorkflowGraphView graph={r.graph} selected={selected} onSelect={setSelected} problemNodes={new Set(r.errors.map((e) => e.nodeId).filter((x): x is string => !!x))} asList={asList} />
      {r.errors.length > 0 && <ul className="text-sm text-error">{r.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>}
    </section>
  );
}
