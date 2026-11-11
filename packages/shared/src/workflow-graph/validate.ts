import {
  DECISION_ELSE,
  DECISION_UNKNOWN,
  HUMAN_RESPONDED,
  HUMAN_TIMEOUT,
  TERMINAL_NODE_TYPES,
  WorkflowGraph,
  type WorkflowEdge,
  type WorkflowNode,
} from './schema';

/**
 * Structural checks for a WorkflowGraph (handover v2.1 chapter 05 "Graph checks", chapter 17 §5).
 * Errors block submission and executable export; warnings are shown to the author and reviewer.
 * Every finding has a stable code so the same fixtures can be checked by Anvil's Python implementation.
 */
export const GRAPH_ERROR_CODES = [
  'SCHEMA',
  'DUPLICATE_ID',
  'UNKNOWN_REFERENCE',
  'NO_INPUT',
  'NO_TERMINAL',
  'UNREACHABLE_NODE',
  'NO_PATH_TO_TERMINAL',
  'TERMINAL_HAS_OUTGOING',
  'UNEXPECTED_PORT',
  'DUPLICATE_PORT',
  'DECISION_MISSING_ELSE',
  'DECISION_MISSING_UNKNOWN',
  'DECISION_BRANCH_MISSING',
  'DECISION_UNLABELLED_BRANCH',
  'DECISION_FIELD_UNKNOWN',
  'HUMAN_MISSING_RESPONDED',
  'HUMAN_MISSING_TIMEOUT',
  'JOIN_NO_REQUIRED_INPUTS',
  'JOIN_INPUT_NOT_PREDECESSOR',
  'JOIN_REQUIRED_MAY_NOT_ARRIVE',
  'UNDECLARED_CYCLE',
  'LOOP_RETURN_NOT_BACKWARD',
  'LOOP_DUPLICATE_RETURN_EDGE',
  'LOOP_NO_EXIT',
  'LOOP_EXHAUSTED_INSIDE_LOOP',
  'LOOP_EXHAUSTED_NO_TERMINAL',
  'ARTIFACT_NOT_AVAILABLE',
  'ARTIFACT_MULTIPLE_PRODUCERS',
  'FUTURE_EVIDENCE_EARLY',
  'PRIVATE_TO_ACTOR',
  'MODE_SINGLE_MULTIPLE_ROLES',
  'TOOL_NOT_ALLOWED',
  'LIMIT_TOO_LOW',
] as const;
export const GRAPH_WARNING_CODES = ['IGNORED_OUTPUT', 'MERGE_WITHOUT_JOIN', 'HUMAN_LOOKS_LIKE_PLATFORM_REVIEW', 'REFERENCE_NOT_CHECKED'] as const;
export type GraphErrorCode = (typeof GRAPH_ERROR_CODES)[number];
export type GraphWarningCode = (typeof GRAPH_WARNING_CODES)[number];

export interface GraphFinding<C extends string = GraphErrorCode | GraphWarningCode> {
  code: C;
  message: string;
  /** JSON-ish path into the graph, e.g. nodes.D1 or edges.E3. */
  path: string;
  nodeId?: string;
}

export interface GraphCheckResult {
  ok: boolean;
  graph: WorkflowGraph | null;
  errors: GraphFinding<GraphErrorCode>[];
  warnings: GraphFinding<GraphWarningCode>[];
}

/** Optional context: when given, references are resolved against it (template tools, approved rules, rubric). */
export interface GraphCheckContext {
  tools?: Iterable<string>;
  policyRuleVersionIds?: Iterable<string>;
  rubricCriterionIds?: Iterable<string>;
}

const PLATFORM_REVIEW = /\b(praxis|platform|expert review(er)?|pm approval|project manager|task review(er)?)\b/i;

export function checkWorkflowGraph(input: unknown, ctx: GraphCheckContext = {}): GraphCheckResult {
  const parsed = WorkflowGraph.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      graph: null,
      errors: parsed.error.issues.map((i) => ({ code: 'SCHEMA', message: i.message, path: i.path.join('.') })),
      warnings: [],
    };
  }
  const g = parsed.data;
  const errors: GraphFinding<GraphErrorCode>[] = [];
  const warnings: GraphFinding<GraphWarningCode>[] = [];
  const err = (code: GraphErrorCode, message: string, path: string, nodeId?: string) => errors.push({ code, message, path, ...(nodeId ? { nodeId } : {}) });
  const warn = (code: GraphWarningCode, message: string, path: string, nodeId?: string) => warnings.push({ code, message, path, ...(nodeId ? { nodeId } : {}) });

  // ── Identity ──
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err('DUPLICATE_ID', `Two ${kind} share the id ${id}`, `${kind}.${id}`);
      seen.add(id);
    }
  };
  dup('roles', g.roles.map((r) => r.id));
  dup('artifacts', g.artifacts.map((a) => a.id));
  dup('nodes', g.nodes.map((n) => n.id));
  dup('edges', g.edges.map((e) => e.id));
  dup('loops', g.loops.map((l) => l.id));

  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const roles = new Map(g.roles.map((r) => [r.id, r]));
  const artifacts = new Map(g.artifacts.map((a) => [a.id, a]));
  const edges = new Map(g.edges.map((e) => [e.id, e]));
  const isPrivate = (id: string) => (artifacts.get(id)?.visibility ?? 'actor') !== 'actor';

  const ref = (ok: boolean, what: string, id: string, path: string, nodeId?: string) => {
    if (!ok) err('UNKNOWN_REFERENCE', `${what} ${id} does not exist`, path, nodeId);
  };

  // ── References ──
  for (const r of g.roles) for (const a of r.evidenceRefs) ref(artifacts.has(a), 'Artifact', a, `roles.${r.id}.evidenceRefs`);
  for (const a of g.artifacts) if (a.revealAtNodeId) ref(nodes.has(a.revealAtNodeId), 'Node', a.revealAtNodeId, `artifacts.${a.id}.revealAtNodeId`);
  for (const e of g.edges) {
    ref(nodes.has(e.from), 'Node', e.from, `edges.${e.id}.from`);
    ref(nodes.has(e.to), 'Node', e.to, `edges.${e.id}.to`);
  }
  for (const n of g.nodes) {
    const p = `nodes.${n.id}`;
    if (n.type === 'input') n.provides.forEach((a) => ref(artifacts.has(a), 'Artifact', a, `${p}.provides`, n.id));
    if (n.type === 'agent_step') {
      ref(roles.has(n.roleId), 'Role', n.roleId, `${p}.roleId`, n.id);
      n.inputRefs.forEach((a) => ref(artifacts.has(a), 'Artifact', a, `${p}.inputRefs`, n.id));
      ref(artifacts.has(n.outputArtifact), 'Artifact', n.outputArtifact, `${p}.outputArtifact`, n.id);
    }
    if (n.type === 'human_step') n.permittedEvidence.forEach((a) => ref(artifacts.has(a), 'Artifact', a, `${p}.permittedEvidence`, n.id));
    if (n.type === 'output') ref(artifacts.has(n.deliverable), 'Artifact', n.deliverable, `${p}.deliverable`, n.id);
    if (n.type === 'join') [...n.requiredInputs, ...n.optionalInputs].forEach((x) => ref(nodes.has(x), 'Node', x, `${p}.inputs`, n.id));
  }
  for (const l of g.loops) {
    ref(edges.has(l.returnEdgeId), 'Edge', l.returnEdgeId, `loops.${l.id}.returnEdgeId`);
    ref(nodes.has(l.exhaustedTarget), 'Node', l.exhaustedTarget, `loops.${l.id}.exhaustedTarget`);
  }
  const known = (it: Iterable<string> | undefined) => (it ? new Set(it) : null);
  const tools = known(ctx.tools);
  const rules = known(ctx.policyRuleVersionIds);
  const rubric = known(ctx.rubricCriterionIds);
  for (const r of g.roles) for (const t of r.tools) if (tools && !tools.has(t)) err('TOOL_NOT_ALLOWED', `Tool ${t} is not approved for this template`, `roles.${r.id}.tools`);
  for (const n of g.nodes) {
    for (const id of n.policyRuleVersionIds) {
      if (rules && !rules.has(id)) err('UNKNOWN_REFERENCE', `Policy rule version ${id} is not an approved rule for this project`, `nodes.${n.id}.policyRuleVersionIds`, n.id);
    }
    for (const id of n.rubricCriterionIds) {
      if (rubric && !rubric.has(id)) err('UNKNOWN_REFERENCE', `Rubric criterion ${id} is not in this task's rubric`, `nodes.${n.id}.rubricCriterionIds`, n.id);
    }
  }
  if (!rules && g.nodes.some((n) => n.policyRuleVersionIds.length)) warn('REFERENCE_NOT_CHECKED', 'Policy rule references were not checked against approved rules', 'nodes');
  if (!rubric && g.nodes.some((n) => n.rubricCriterionIds.length)) warn('REFERENCE_NOT_CHECKED', 'Rubric references were not checked against the rubric', 'nodes');

  if (g.agentMode === 'SINGLE' && g.roles.length > 1) err('MODE_SINGLE_MULTIPLE_ROLES', 'A single-agent template has exactly one role', 'roles');
  if (g.limits.maxTransitions < g.nodes.length) err('LIMIT_TOO_LOW', `The transition limit (${g.limits.maxTransitions}) is below the number of nodes (${g.nodes.length})`, 'limits.maxTransitions');

  // If references are broken, structural analysis below would only add noise.
  if (errors.some((e) => e.code === 'DUPLICATE_ID' || e.code === 'UNKNOWN_REFERENCE')) return { ok: false, graph: g, errors, warnings };

  // ── Ports and terminals ──
  const out = new Map<string, WorkflowEdge[]>(g.nodes.map((n) => [n.id, []]));
  const inc = new Map<string, WorkflowEdge[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) {
    out.get(e.from)!.push(e);
    inc.get(e.to)!.push(e);
  }
  const isTerminal = (n: WorkflowNode) => TERMINAL_NODE_TYPES.includes(n.type);
  for (const n of g.nodes) {
    const p = `nodes.${n.id}`;
    const outs = out.get(n.id)!;
    if (isTerminal(n)) {
      if (outs.length) err('TERMINAL_HAS_OUTGOING', `${n.label} ends the workflow, so it cannot lead anywhere`, p, n.id);
      continue;
    }
    const allowed =
      n.type === 'decision' ? new Set([...n.conditions.map((c) => c.id), DECISION_ELSE, DECISION_UNKNOWN]) : n.type === 'human_step' ? new Set([HUMAN_RESPONDED, HUMAN_TIMEOUT]) : null;
    const seenPorts = new Set<string>();
    for (const e of outs) {
      if (!allowed) {
        if (e.port) err('UNEXPECTED_PORT', `Edge ${e.id} has a branch port, but ${n.label} is not a decision or human step`, `edges.${e.id}.port`, n.id);
        continue;
      }
      if (!e.port || !allowed.has(e.port)) {
        err('UNEXPECTED_PORT', `Edge ${e.id} from ${n.label} must name one of: ${[...allowed].join(', ')}`, `edges.${e.id}.port`, n.id);
        continue;
      }
      if (seenPorts.has(e.port)) err('DUPLICATE_PORT', `${n.label} has two edges for "${e.port}"; each outcome has one destination`, `edges.${e.id}.port`, n.id);
      seenPorts.add(e.port);
      if (n.type === 'decision' && !e.label.trim()) err('DECISION_UNLABELLED_BRANCH', `The "${e.port}" branch of ${n.label} needs a label`, `edges.${e.id}.label`, n.id);
    }
    if (n.type === 'decision') {
      for (const c of n.conditions) if (!seenPorts.has(c.id)) err('DECISION_BRANCH_MISSING', `${n.label}: the "${c.label}" outcome has no destination`, p, n.id);
      if (!seenPorts.has(DECISION_ELSE)) err('DECISION_MISSING_ELSE', `${n.label} needs an "else" route for outcomes that match no condition`, p, n.id);
      if (!seenPorts.has(DECISION_UNKNOWN)) err('DECISION_MISSING_UNKNOWN', `${n.label} needs an "unknown" route for missing or unreadable results`, p, n.id);
    } else if (n.type === 'human_step') {
      if (!seenPorts.has(HUMAN_RESPONDED)) err('HUMAN_MISSING_RESPONDED', `${n.label} needs a route for when the person responds`, p, n.id);
      if (!seenPorts.has(HUMAN_TIMEOUT)) err('HUMAN_MISSING_TIMEOUT', `${n.label} needs a route for when no response arrives in time`, p, n.id);
      if (PLATFORM_REVIEW.test(n.actorRole)) {
        warn('HUMAN_LOOKS_LIKE_PLATFORM_REVIEW', `${n.label}: a human step is a person inside the case, not Praxis Expert review or PM approval`, p, n.id);
      }
    }
  }

  const inputs = g.nodes.filter((n) => n.type === 'input');
  if (!inputs.length) err('NO_INPUT', 'The workflow needs an input node where the case starts', 'nodes');
  if (!g.nodes.some(isTerminal)) err('NO_TERMINAL', 'The workflow needs an output or escalation node where it ends', 'nodes');

  // ── Cycles: every cycle must close through a declared loop return edge ──
  const returnEdges = new Set<string>();
  for (const l of g.loops) {
    if (returnEdges.has(l.returnEdgeId)) err('LOOP_DUPLICATE_RETURN_EDGE', `Two loops use the return edge ${l.returnEdgeId}`, `loops.${l.id}`);
    returnEdges.add(l.returnEdgeId);
  }
  const dagOut = (id: string) => out.get(id)!.filter((e) => !returnEdges.has(e.id)).map((e) => e.to);
  const order = topoOrder(g.nodes.map((n) => n.id), dagOut);
  if (!order) {
    for (const id of cycleMembers(g.nodes.map((n) => n.id), dagOut)) {
      err('UNDECLARED_CYCLE', `${nodes.get(id)!.label} is on a cycle that is not a declared, bounded loop`, `nodes.${id}`, id);
    }
    return { ok: false, graph: g, errors, warnings };
  }
  const reachFrom = (starts: string[], next: (id: string) => string[], blocked?: string) => {
    const seen = new Set<string>();
    const stack = starts.filter((s) => s !== blocked);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const t of next(id)) if (t !== blocked && !seen.has(t)) stack.push(t);
    }
    return seen;
  };
  const allOut = (id: string) => out.get(id)!.map((e) => e.to);
  const allIn = (id: string) => inc.get(id)!.map((e) => e.from);
  const dagIn = (id: string) => inc.get(id)!.filter((e) => !returnEdges.has(e.id)).map((e) => e.from);
  const dagAncestors = (id: string) => {
    const a = reachFrom([id], dagIn);
    a.delete(id);
    return a;
  };

  // ── Reachability ──
  const reachable = reachFrom(inputs.map((n) => n.id), allOut);
  const reachesTerminal = reachFrom(g.nodes.filter(isTerminal).map((n) => n.id), allIn);
  for (const n of g.nodes) {
    if (!reachable.has(n.id)) err('UNREACHABLE_NODE', `${n.label} cannot be reached from the case input`, `nodes.${n.id}`, n.id);
    else if (!reachesTerminal.has(n.id)) err('NO_PATH_TO_TERMINAL', `${n.label} never leads to an output or escalation`, `nodes.${n.id}`, n.id);
  }

  // ── Loops ──
  for (const l of g.loops) {
    const e = edges.get(l.returnEdgeId)!;
    const p = `loops.${l.id}`;
    // The return edge must point back to a DAG ancestor of its source.
    if (!dagAncestors(e.from).has(e.to) && e.from !== e.to) {
      err('LOOP_RETURN_NOT_BACKWARD', `Loop ${l.id}: edge ${e.id} does not return to an earlier step`, p);
      continue;
    }
    const fromStart = reachFrom([e.to], dagOut);
    const toEnd = reachFrom([e.from], dagIn);
    const body = new Set([...fromStart].filter((x) => toEnd.has(x)));
    const exits = [...body].some((b) => out.get(b)!.some((x) => !body.has(x.to) && x.id !== e.id));
    if (!exits) err('LOOP_NO_EXIT', `Loop ${l.id} has no way out other than repeating`, p);
    if (body.has(l.exhaustedTarget)) err('LOOP_EXHAUSTED_INSIDE_LOOP', `Loop ${l.id}: when the limit is reached the case must leave the loop`, `${p}.exhaustedTarget`);
    else if (!reachesTerminal.has(l.exhaustedTarget)) {
      err('LOOP_EXHAUSTED_NO_TERMINAL', `Loop ${l.id}: the exhausted route must stop or escalate`, `${p}.exhaustedTarget`);
    }
  }

  // ── Joins and merges ──
  for (const n of g.nodes) {
    const preds = new Set(allIn(n.id));
    if (n.type === 'join') {
      if (!n.requiredInputs.length) err('JOIN_NO_REQUIRED_INPUTS', `${n.label} must say which inputs it waits for`, `nodes.${n.id}.requiredInputs`, n.id);
      for (const r of [...n.requiredInputs, ...n.optionalInputs]) {
        if (!preds.has(r)) err('JOIN_INPUT_NOT_PREDECESSOR', `${n.label} waits for ${r}, which does not lead into it`, `nodes.${n.id}`, n.id);
      }
      // Non-choice nodes fan out to every successor (parallel); decisions and human steps take one branch.
      // A required input is ambiguous when some branch of an earlier choice reaches the join without it.
      const joinAncestors = dagAncestors(n.id);
      for (const r of n.requiredInputs) {
        const rAncestors = dagAncestors(r);
        // Only a choice that r depends on (an ancestor of r) can skip r; choices in a parallel strand cannot.
        const skipped = g.nodes.some(
          (d) =>
            (d.type === 'decision' || d.type === 'human_step') &&
            joinAncestors.has(d.id) &&
            rAncestors.has(d.id) &&
            out.get(d.id)!.some((b) => {
              if (returnEdges.has(b.id)) return false;
              const fromBranch = reachFrom([b.to], dagOut);
              return fromBranch.has(n.id) && !fromBranch.has(r);
            }),
        );
        if (skipped) err('JOIN_REQUIRED_MAY_NOT_ARRIVE', `${n.label} requires ${r}, but some branches reach it without ${r}; mark it optional or restructure`, `nodes.${n.id}.requiredInputs`, n.id);
      }
    } else if (dagIn(n.id).length > 1 && !isTerminal(n)) {
      warn('MERGE_WITHOUT_JOIN', `${n.label} has several incoming routes; if they can run together, use a join`, `nodes.${n.id}`, n.id);
    }
  }

  // ── Artifacts and visibility ──
  const producers = new Map<string, string[]>();
  const produce = (a: string, node: string) => producers.set(a, [...(producers.get(a) ?? []), node]);
  for (const n of g.nodes) {
    if (n.type === 'input') n.provides.forEach((a) => produce(a, n.id));
    if (n.type === 'agent_step') produce(n.outputArtifact, n.id);
  }
  for (const [a, ps] of producers) {
    if (new Set(ps).size > 1) err('ARTIFACT_MULTIPLE_PRODUCERS', `${a} is produced by ${ps.join(' and ')}; give each step its own output`, `artifacts.${a}`);
  }
  const consumed = new Set<string>();
  const availableAt = (nodeId: string, a: string) => {
    const before = dagAncestors(nodeId);
    return (producers.get(a) ?? []).some((p) => before.has(p));
  };
  const checkReveal = (nodeId: string, a: string, path: string) => {
    const at = artifacts.get(a)?.revealAtNodeId;
    if (at && at !== nodeId && !dagAncestors(nodeId).has(at)) err('FUTURE_EVIDENCE_EARLY', `${a} is only revealed at ${at}, which comes later`, path, nodeId);
  };
  for (const n of g.nodes) {
    const p = `nodes.${n.id}`;
    if (n.type === 'agent_step') {
      for (const a of n.inputRefs) {
        consumed.add(a);
        if (isPrivate(a)) err('PRIVATE_TO_ACTOR', `${n.label} reads ${a}, which is private to the verifier`, `${p}.inputRefs`, n.id);
        else if (!availableAt(n.id, a)) err('ARTIFACT_NOT_AVAILABLE', `${n.label} reads ${a}, which no earlier step provides`, `${p}.inputRefs`, n.id);
        checkReveal(n.id, a, `${p}.inputRefs`);
      }
      if (isPrivate(n.outputArtifact)) err('PRIVATE_TO_ACTOR', `${n.label} writes ${n.outputArtifact}, but agent output cannot be private reference material`, `${p}.outputArtifact`, n.id);
      const role = roles.get(n.roleId)!;
      for (const a of role.evidenceRefs) if (isPrivate(a)) err('PRIVATE_TO_ACTOR', `Role ${role.name} can see ${a}, which is private`, `roles.${role.id}.evidenceRefs`, n.id);
    }
    if (n.type === 'human_step') {
      for (const a of n.permittedEvidence) {
        consumed.add(a);
        if (isPrivate(a)) err('PRIVATE_TO_ACTOR', `${n.label} shows ${a}, which is private`, `${p}.permittedEvidence`, n.id);
        checkReveal(n.id, a, `${p}.permittedEvidence`);
      }
    }
    if (n.type === 'decision') {
      for (const c of n.conditions) {
        const a = c.field.split('.')[0]!;
        consumed.add(a);
        if (!artifacts.has(a)) err('DECISION_FIELD_UNKNOWN', `${n.label}: "${c.field}" must start with an artifact id`, `${p}.conditions.${c.id}`, n.id);
        else if (!availableAt(n.id, a)) err('ARTIFACT_NOT_AVAILABLE', `${n.label} decides on ${a}, which no earlier step provides`, `${p}.conditions.${c.id}`, n.id);
      }
    }
    if (n.type === 'output') {
      consumed.add(n.deliverable);
      if (isPrivate(n.deliverable)) err('PRIVATE_TO_ACTOR', `${n.label} delivers ${n.deliverable}, which is private`, `${p}.deliverable`, n.id);
      else if (!availableAt(n.id, n.deliverable)) err('ARTIFACT_NOT_AVAILABLE', `${n.label} delivers ${n.deliverable}, which no earlier step produces`, `${p}.deliverable`, n.id);
    }
  }
  for (const n of g.nodes) {
    // An output carried back through a loop's return edge feeds the next iteration, so it is not ignored.
    const carriedBack = out.get(n.id)!.some((e) => returnEdges.has(e.id));
    if (n.type === 'agent_step' && !consumed.has(n.outputArtifact) && !carriedBack) {
      warn('IGNORED_OUTPUT', `Nothing uses the result of ${n.label}`, `nodes.${n.id}.outputArtifact`, n.id);
    }
  }

  return { ok: errors.length === 0, graph: g, errors, warnings };
}

/** Kahn's algorithm; null when a cycle remains. Ties keep the authored node order, so layouts are stable. */
export function topoOrder(ids: string[], next: (id: string) => string[]): string[] | null {
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const t of next(id)) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of next(id)) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  return order.length === ids.length ? order : null;
}

/** Nodes that sit on some cycle (strongly connected components larger than one node, or self-loops). */
function cycleMembers(ids: string[], next: (id: string) => string[]): string[] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const result: string[] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of next(v)) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || next(v).includes(v)) result.push(...comp);
    }
  };
  for (const id of ids) if (!idx.has(id)) visit(id);
  return ids.filter((id) => result.includes(id));
}
