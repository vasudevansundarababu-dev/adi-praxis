'use client';
import { useSyncExternalStore } from 'react';
import { layoutWorkflowGraph, type WorkflowGraph, type WorkflowNode } from '@praxis/shared';

const COL = 200;
const ROW = 118;
const W = 156;
const H = 60;
const PAD = 28;
/** Space above the main path for loop returns. */
const TOP = 46;

const KIND: Record<WorkflowNode['type'], string> = {
  input: 'Case input',
  agent_step: 'Agent step',
  decision: 'Decision',
  join: 'Join',
  human_step: 'Person in the case',
  external_system: 'External system',
  output: 'Final output',
  escalation: 'Escalation',
};

function useNarrow() {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia('(max-width: 735px)');
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => window.matchMedia('(max-width: 735px)').matches,
    () => false,
  );
}

/**
 * The connected workflow graph, left to right, drawn from stored graph data only (handover v2.1 ch. 05). The same
 * component renders below the Classic and Chatbot editors. At narrow widths, or on request, the same connections
 * render as an accessible list instead of shrinking the text.
 */
export function WorkflowGraphView({
  graph,
  selected,
  onSelect,
  problemNodes,
  asList,
}: {
  graph: WorkflowGraph;
  selected: string | null;
  onSelect(id: string): void;
  problemNodes: Set<string>;
  asList?: boolean;
}) {
  const narrow = useNarrow();
  const layout = layoutWorkflowGraph(graph);
  if (!layout || narrow || asList) return <GraphList graph={graph} selected={selected} onSelect={onSelect} problemNodes={problemNodes} cycle={!layout} />;

  const pos = new Map(layout.nodes.map((n) => [n.id, { x: PAD + n.col * COL, y: TOP + PAD + n.row * ROW }]));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const width = PAD * 2 + (layout.columns - 1) * COL + W;
  const height = TOP + PAD * 2 + (layout.rows - 1) * ROW + H;

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface" data-testid="workflow-graph">
      <svg role="group" aria-label="Workflow graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block text-fg">
        <defs>
          <marker id="wg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {layout.edges.map((e) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          let d: string;
          let lx: number;
          let ly: number;
          if (e.kind === 'return') {
            // Loops route above the main path so they never cross node boxes.
            const sx = a.x + W / 2;
            const tx = b.x + W / 2;
            const top = Math.min(a.y, b.y) - TOP + 8;
            d = `M ${sx} ${a.y} C ${sx} ${top}, ${tx} ${top}, ${tx} ${b.y - 2}`;
            lx = (sx + tx) / 2;
            ly = top + 12;
          } else {
            const sx = a.x + W;
            const sy = a.y + H / 2;
            const tx = b.x - 2;
            const ty = b.y + H / 2;
            const mx = (sx + tx) / 2;
            d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
            lx = mx;
            ly = (sy + ty) / 2 - 5;
          }
          return (
            <g key={e.id} className={e.kind === 'return' ? 'text-warning' : 'text-fg-muted'}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray={e.kind === 'return' ? '5 4' : undefined} markerEnd="url(#wg-arrow)" />
              {e.label && (
                <text x={lx} y={ly} textAnchor="middle" fontSize={11} fill="currentColor" className="select-none">
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {layout.nodes.map((ln) => {
          const n = byId.get(ln.id)!;
          const p = pos.get(ln.id)!;
          const isSel = selected === n.id;
          const bad = problemNodes.has(n.id);
          const stroke = bad ? 'var(--color-error, #b42318)' : isSel ? 'currentColor' : 'var(--color-line, #c9ccd1)';
          const shape =
            n.type === 'decision' ? (
              <polygon points={`${W / 2},0 ${W},${H / 2} ${W / 2},${H} 0,${H / 2}`} fill="var(--color-surface, #fff)" stroke={stroke} strokeWidth={isSel ? 2.5 : 1.5} />
            ) : (
              <rect
                width={W}
                height={H}
                rx={n.type === 'human_step' ? 28 : n.type === 'input' || n.type === 'output' || n.type === 'escalation' ? 4 : 8}
                fill="var(--color-surface, #fff)"
                stroke={stroke}
                strokeWidth={isSel ? 2.5 : 1.5}
                strokeDasharray={n.type === 'human_step' ? '6 3' : n.type === 'external_system' ? '2 3' : undefined}
              />
            );
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`${KIND[n.type]}: ${n.label}${bad ? ' (has problems)' : ''}`}
              data-node={n.id}
              className="cursor-pointer focus:outline-none [&:focus-visible>*:first-child]:stroke-[3]"
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
            >
              {shape}
              <text x={W / 2} y={n.type === 'decision' ? H / 2 - 4 : 22} textAnchor="middle" fontSize={10} fill="var(--color-fg-muted, #5b616e)">
                {KIND[n.type]}
              </text>
              <text x={W / 2} y={n.type === 'decision' ? H / 2 + 10 : 40} textAnchor="middle" fontSize={12} fill="currentColor">
                {clip(n.label, n.type === 'decision' ? 18 : 24)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Accessible list form of the same graph: every node and every labelled connection, in flow order. */
function GraphList({ graph, selected, onSelect, problemNodes, cycle }: { graph: WorkflowGraph; selected: string | null; onSelect(id: string): void; problemNodes: Set<string>; cycle: boolean }) {
  const layout = layoutWorkflowGraph(graph);
  const order = layout ? [...layout.nodes].sort((a, b) => a.col - b.col || a.row - b.row).map((n) => n.id) : graph.nodes.map((n) => n.id);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const loopEdges = new Set(graph.loops.map((l) => l.returnEdgeId));
  return (
    <div data-testid="workflow-graph-list">
      {cycle && <p className="mb-2 text-sm text-error">The workflow has a cycle that is not a declared loop, so it is shown as a list.</p>}
      <ol className="space-y-2">
        {order.map((id) => {
          const n = byId.get(id)!;
          const outs = graph.edges.filter((e) => e.from === id);
          return (
            <li key={id} className={`rounded-md border p-2 ${selected === id ? 'border-fg' : problemNodes.has(id) ? 'border-error' : 'border-line'}`}>
              <button type="button" aria-pressed={selected === id} onClick={() => onSelect(id)} className="text-left">
                <span className="block text-xs text-fg-muted">{KIND[n.type]}</span>
                <span className="font-medium">{n.label}</span>
              </button>
              {outs.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {outs.map((e) => (
                    <li key={e.id}>
                      {loopEdges.has(e.id) ? '↺ returns to ' : '→ '}
                      {byId.get(e.to)?.label ?? e.to}
                      {(e.label || e.port) && <span className="text-fg-muted"> ({e.label || e.port})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
