import { z } from 'zod';

/**
 * WorkflowGraph v1 (handover v2.1 chapters 05 and 17 §5): the declarative workflow an SME authors for a task.
 * It is data only. Nothing in it is executed by Praxis; Anvil's runner interprets it after its own qualification.
 * The wire identifier is provisional until Anvil allocates the final one; it must never reuse
 * praxis.anvil.task.v1/v2/v3.
 */
export const WORKFLOW_GRAPH_SCHEMA = 'praxis.workflow_graph.v1-proposed' as const;

export const WORKFLOW_NODE_TYPES = ['input', 'agent_step', 'decision', 'join', 'human_step', 'output', 'escalation'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

/** Terminal node kinds: a trial ends here. Escalation is a terminal that is not a successful completion. */
export const TERMINAL_NODE_TYPES: readonly WorkflowNodeType[] = ['output', 'escalation'];

/** Global defence-in-depth cap on transitions per trial, on top of each loop's own limit. */
export const MAX_TRANSITIONS_CEILING = 1000;
export const MAX_LOOP_ITERATIONS = 50;

const GraphId = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/, 'Use letters, digits, dot, dash or underscore, starting with a letter');
const Text = (max = 4000) => z.string().trim().min(1).max(max);
const Ids = z.array(GraphId).max(200).default([]);

/** Who may see an artifact. Private material stays with the verifier until an authorised reveal. */
export const ARTIFACT_VISIBILITIES = ['actor', 'private_reference', 'private_rubric'] as const;
export type ArtifactVisibility = (typeof ARTIFACT_VISIBILITIES)[number];

export const WorkflowRole = z
  .object({
    id: GraphId,
    name: Text(200),
    responsibility: Text(),
    /** Template-approved tool keys this role may call. */
    tools: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    /** Artifacts this role may read. */
    evidenceRefs: Ids,
  })
  .strict();
export type WorkflowRole = z.infer<typeof WorkflowRole>;

export const WorkflowArtifact = z
  .object({
    id: GraphId,
    label: Text(200),
    /** Optional name of the artifact's declared schema (template-defined); used for handoff compatibility. */
    schemaRef: z.string().trim().min(1).max(200).optional(),
    visibility: z.enum(ARTIFACT_VISIBILITIES).default('actor'),
    /** Future evidence: revealed only when the trial reaches this node. */
    revealAtNodeId: GraphId.optional(),
  })
  .strict();
export type WorkflowArtifact = z.infer<typeof WorkflowArtifact>;

export const CONDITION_OPS = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'present', 'absent'] as const;
export const DecisionCondition = z
  .object({
    /** Also the edge port for this branch. */
    id: GraphId,
    label: Text(200),
    /** Typed predicate over a captured artifact field; never prose evaluated as code. */
    field: z.string().trim().min(1).max(200),
    op: z.enum(CONDITION_OPS),
    value: z.union([z.string().max(500), z.number().finite(), z.boolean(), z.array(z.union([z.string().max(500), z.number().finite()])).max(50)]).optional(),
  })
  .strict();
export type DecisionCondition = z.infer<typeof DecisionCondition>;

/** Reserved decision ports. Every decision routes else and unknown explicitly. */
export const DECISION_ELSE = 'else' as const;
export const DECISION_UNKNOWN = 'unknown' as const;
export const HUMAN_RESPONDED = 'responded' as const;
export const HUMAN_TIMEOUT = 'timeout' as const;

export const HumanResponseField = z
  .object({
    key: GraphId,
    label: Text(200),
    type: z.enum(['choice', 'text', 'number']),
    options: z.array(Text(200)).max(50).optional(),
  })
  .strict()
  .refine((f) => f.type !== 'choice' || (f.options?.length ?? 0) >= 2, { message: 'A choice needs at least two options', path: ['options'] });

const NodeBase = {
  id: GraphId,
  label: Text(200),
  policyRuleVersionIds: Ids,
  rubricCriterionIds: Ids,
};

export const WorkflowNode = z.discriminatedUnion('type', [
  z.object({ ...NodeBase, type: z.literal('input'), provides: Ids }).strict(),
  z
    .object({
      ...NodeBase,
      type: z.literal('agent_step'),
      roleId: GraphId,
      instruction: Text(),
      inputRefs: Ids,
      outputArtifact: GraphId,
    })
    .strict(),
  z
    .object({
      ...NodeBase,
      type: z.literal('decision'),
      question: Text(1000),
      conditions: z.array(DecisionCondition).min(1).max(20),
    })
    .strict(),
  z
    .object({
      ...NodeBase,
      type: z.literal('join'),
      /** Predecessor nodes whose outputs must all exist before continuing. */
      requiredInputs: Ids,
      optionalInputs: Ids,
    })
    .strict(),
  z
    .object({
      ...NodeBase,
      type: z.literal('human_step'),
      /** The business person inside the case (e.g. case lead). Never platform Expert/PM review. */
      actorRole: Text(200),
      prompt: Text(),
      responseSchema: z.array(HumanResponseField).min(1).max(20),
      permittedEvidence: Ids,
      timeoutMinutes: z.number().int().min(1).max(60 * 24 * 30),
    })
    .strict(),
  z
    .object({
      ...NodeBase,
      type: z.literal('output'),
      deliverable: GraphId,
      completionCondition: Text(1000),
    })
    .strict(),
  z.object({ ...NodeBase, type: z.literal('escalation'), reason: Text(1000) }).strict(),
]);
export type WorkflowNode = z.infer<typeof WorkflowNode>;

export const WorkflowEdge = z
  .object({
    id: GraphId,
    from: GraphId,
    to: GraphId,
    /** Decision branch (condition id, else, unknown) or human outcome (responded, timeout). */
    port: GraphId.optional(),
    label: z.string().trim().max(200).default(''),
  })
  .strict();
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

export const WorkflowLoop = z
  .object({
    id: GraphId,
    /** The edge that returns to an earlier node. Every cycle must close through a declared loop edge. */
    returnEdgeId: GraphId,
    maxIterations: z.number().int().min(1).max(MAX_LOOP_ITERATIONS),
    exitCondition: Text(1000),
    /** Where the case goes when the limit is reached: must stop or escalate, never succeed silently. */
    exhaustedTarget: GraphId,
  })
  .strict();
export type WorkflowLoop = z.infer<typeof WorkflowLoop>;

export const WorkflowGraph = z
  .object({
    schemaVersion: z.literal(WORKFLOW_GRAPH_SCHEMA),
    templateId: Text(200),
    templateVersion: z.number().int().min(1),
    agentMode: z.enum(['SINGLE', 'MULTI']),
    roles: z.array(WorkflowRole).min(1).max(20),
    artifacts: z.array(WorkflowArtifact).max(200).default([]),
    nodes: z.array(WorkflowNode).min(2).max(200),
    edges: z.array(WorkflowEdge).max(500),
    loops: z.array(WorkflowLoop).max(50).default([]),
    limits: z.object({ maxTransitions: z.number().int().min(1).max(MAX_TRANSITIONS_CEILING) }).strict(),
    /** Presentation only; never changes semantics and is excluded from the content hash. */
    layout: z.record(GraphId, z.object({ x: z.number(), y: z.number() })).optional(),
  })
  .strict();
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;
export type WorkflowGraphInput = z.input<typeof WorkflowGraph>;
