import { DECISION_ELSE, DECISION_UNKNOWN, HUMAN_TIMEOUT, type WorkflowGraph } from './schema';
import { topoOrder } from './validate';

export interface LaidOutNode {
  id: string;
  col: number;
  row: number;
}
export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** forward: left to right; return: a declared loop going back (drawn above the main path). */
  kind: 'forward' | 'return';
}
export interface GraphLayout {
  columns: number;
  rows: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

/** Exception routes branch downward from the main path. */
const SIDE_PORTS = new Set<string>([DECISION_ELSE, DECISION_UNKNOWN, HUMAN_TIMEOUT]);

/**
 * Deterministic left-to-right layout computed from graph data alone (handover chapter 05: the preview is a projection
 * of stored graph data, never a second source). Column = longest path from an input, ignoring loop return edges;
 * row = the predecessor's row, or one lower for exception routes, moved down until free.
 * Returns null for a graph with an undeclared cycle (the checker reports it).
 */
export function layoutWorkflowGraph(g: WorkflowGraph): GraphLayout | null {
  const returnEdges = new Set(g.loops.map((l) => l.returnEdgeId));
  const forward = g.edges.filter((e) => !returnEdges.has(e.id));
  const ids = g.nodes.map((n) => n.id);
  const known = new Set(ids);
  const next = (id: string) => forward.filter((e) => e.from === id && known.has(e.to)).map((e) => e.to);
  const order = topoOrder(ids, next);
  if (!order) return null;

  const col = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const id of order) for (const t of next(id)) col.set(t, Math.max(col.get(t)!, col.get(id)! + 1));

  const row = new Map<string, number>();
  const taken = new Set<string>();
  for (const id of order) {
    const incoming = forward.filter((e) => e.to === id && row.has(e.from));
    const main = incoming.find((e) => !e.port || !SIDE_PORTS.has(e.port));
    const first = main ?? incoming[0];
    let r = first ? row.get(first.from)! + (first.port && SIDE_PORTS.has(first.port) ? 1 : 0) : 0;
    while (taken.has(`${col.get(id)}:${r}`)) r += 1;
    taken.add(`${col.get(id)}:${r}`);
    row.set(id, r);
  }

  return {
    columns: Math.max(0, ...col.values()) + 1,
    rows: Math.max(0, ...row.values()) + 1,
    nodes: ids.map((id) => ({ id, col: col.get(id)!, row: row.get(id)! })),
    edges: g.edges
      .filter((e) => known.has(e.from) && known.has(e.to))
      .map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label || e.port || '', kind: returnEdges.has(e.id) ? 'return' : 'forward' })),
  };
}
