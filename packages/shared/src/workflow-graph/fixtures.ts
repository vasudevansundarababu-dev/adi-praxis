import { WORKFLOW_GRAPH_SCHEMA, type WorkflowGraphInput } from './schema';
import type { GraphErrorCode } from './validate';

/**
 * Cross-language fixtures for WorkflowGraph v1. Written to contracts/praxis/workflow-graph/fixtures/ so Anvil's
 * Python implementation checks the same cases (handover chapter 17 §12, "Contract" gate). Each invalid case names the
 * error codes it must produce. The on-disk files are regenerated from this module and a test fails on drift.
 */

/** Single-agent KYC-style flow with a decision, a business human step and a bounded correction loop. */
export function singleAgentKyc(): WorkflowGraphInput {
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA,
    templateId: 'kyc-onboarding-and-refresh',
    templateVersion: 1,
    agentMode: 'SINGLE',
    roles: [{ id: 'analyst', name: 'KYC analyst', responsibility: 'Assess identity and address evidence for the applicant', tools: ['document_check', 'request_info'], evidenceRefs: ['case_file'] }],
    artifacts: [
      { id: 'case_file', label: 'Applicant evidence (E1 identity, E2 address)', visibility: 'actor' },
      { id: 'evidence_review', label: 'Evidence review findings', visibility: 'actor' },
      { id: 'info_request', label: 'Request for missing information', visibility: 'actor' },
      { id: 'recommendation', label: 'Disposition and rationale', visibility: 'actor' },
      { id: 'reference_answer', label: 'Reference disposition', visibility: 'private_reference' },
    ],
    nodes: [
      { id: 'start', type: 'input', label: 'Case evidence', provides: ['case_file'] },
      { id: 'review', type: 'agent_step', label: 'Review evidence', roleId: 'analyst', instruction: 'Compare the identity and address records and list discrepancies with evidence IDs.', inputRefs: ['case_file'], outputArtifact: 'evidence_review' },
      {
        id: 'complete',
        type: 'decision',
        label: 'Evidence complete?',
        question: 'Is the evidence sufficient to assess the applicant?',
        conditions: [
          { id: 'yes', label: 'Complete', field: 'evidence_review.complete', op: 'eq', value: true },
          { id: 'no', label: 'Missing evidence', field: 'evidence_review.complete', op: 'eq', value: false },
        ],
      },
      { id: 'ask', type: 'agent_step', label: 'Request missing information', roleId: 'analyst', instruction: 'Write a request naming exactly which document is missing and why.', inputRefs: ['evidence_review'], outputArtifact: 'info_request' },
      { id: 'decide', type: 'agent_step', label: 'Recommend disposition', roleId: 'analyst', instruction: 'Recommend approve, reject, request information or escalate, citing evidence.', inputRefs: ['evidence_review'], outputArtifact: 'recommendation', rubricCriterionIds: ['C1'] },
      {
        id: 'lead',
        type: 'human_step',
        label: 'Case lead confirms',
        actorRole: 'Case lead',
        prompt: 'Confirm or return the recommendation.',
        responseSchema: [{ key: 'verdict', label: 'Verdict', type: 'choice', options: ['Confirm', 'Return'] }],
        permittedEvidence: ['case_file', 'recommendation'],
        timeoutMinutes: 1440,
      },
      { id: 'done', type: 'output', label: 'Final recommendation', deliverable: 'recommendation', completionCondition: 'A disposition with cited evidence exists.' },
      { id: 'escalate', type: 'escalation', label: 'Escalate to approver', reason: 'Evidence could not be completed within the allowed requests.' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'review', label: '' },
      { id: 'e2', from: 'review', to: 'complete', label: '' },
      { id: 'e3', from: 'complete', to: 'decide', port: 'yes', label: 'Complete' },
      { id: 'e4', from: 'complete', to: 'ask', port: 'no', label: 'Missing' },
      { id: 'e5', from: 'complete', to: 'escalate', port: 'else', label: 'Other' },
      { id: 'e6', from: 'complete', to: 'escalate', port: 'unknown', label: 'Unreadable' },
      { id: 'e7', from: 'ask', to: 'review', label: 'Re-review' },
      { id: 'e8', from: 'decide', to: 'lead', label: '' },
      { id: 'e9', from: 'lead', to: 'done', port: 'responded', label: 'Responded' },
      { id: 'e10', from: 'lead', to: 'escalate', port: 'timeout', label: 'No response' },
    ],
    loops: [{ id: 'info_loop', returnEdgeId: 'e7', maxIterations: 2, exitCondition: 'Evidence complete', exhaustedTarget: 'escalate' }],
    limits: { maxTransitions: 40 },
  };
}

/** Multi-agent KYB-style flow: parallel specialists, a branch-aware join, consolidation and human referral. */
export function multiAgentKyb(): WorkflowGraphInput {
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA,
    templateId: 'kyb-and-beneficial-ownership',
    templateVersion: 1,
    agentMode: 'MULTI',
    roles: [
      { id: 'ownership', name: 'Ownership analyst', responsibility: 'Resolve the ownership chain', tools: ['registry_lookup'], evidenceRefs: ['case_file'] },
      { id: 'screening', name: 'Screening analyst', responsibility: 'Screen controlling parties', tools: ['sanctions_pep_screening'], evidenceRefs: ['case_file'] },
      { id: 'lead_analyst', name: 'Lead analyst', responsibility: 'Consolidate findings and recommend', tools: [], evidenceRefs: [] },
    ],
    artifacts: [
      { id: 'case_file', label: 'Entity evidence', visibility: 'actor' },
      { id: 'ownership_map', label: 'Ownership map', visibility: 'actor' },
      { id: 'screening_results', label: 'Screening results', visibility: 'actor' },
      { id: 'consolidated', label: 'Consolidated findings', visibility: 'actor' },
      { id: 'referral', label: 'Referral note', visibility: 'actor' },
      { id: 'rubric_key', label: 'Rubric answer key', visibility: 'private_rubric' },
    ],
    nodes: [
      { id: 'start', type: 'input', label: 'Case evidence', provides: ['case_file'] },
      { id: 'own', type: 'agent_step', label: 'Map ownership', roleId: 'ownership', instruction: 'Build the ownership chain to natural persons with percentages.', inputRefs: ['case_file'], outputArtifact: 'ownership_map' },
      { id: 'screen', type: 'agent_step', label: 'Screen parties', roleId: 'screening', instruction: 'Screen every controlling party and record outcomes.', inputRefs: ['case_file'], outputArtifact: 'screening_results' },
      { id: 'join', type: 'join', label: 'Both specialists done', requiredInputs: ['own', 'screen'], optionalInputs: [] },
      { id: 'consolidate', type: 'agent_step', label: 'Consolidate', roleId: 'lead_analyst', instruction: 'Combine both results into findings and a risk view.', inputRefs: ['ownership_map', 'screening_results'], outputArtifact: 'consolidated' },
      {
        id: 'refer',
        type: 'decision',
        label: 'Human referral needed?',
        question: 'Do the findings need a case lead decision?',
        conditions: [
          { id: 'refer_yes', label: 'Refer', field: 'consolidated.risk', op: 'eq', value: 'HIGH' },
          { id: 'refer_no', label: 'No referral', field: 'consolidated.risk', op: 'in', value: ['LOW', 'MEDIUM'] },
        ],
      },
      { id: 'note', type: 'agent_step', label: 'Write referral', roleId: 'lead_analyst', instruction: 'Write the referral note for the case lead.', inputRefs: ['consolidated'], outputArtifact: 'referral' },
      {
        id: 'lead',
        type: 'human_step',
        label: 'Case lead decides',
        actorRole: 'Case lead',
        prompt: 'Decide on the referral.',
        responseSchema: [{ key: 'decision', label: 'Decision', type: 'choice', options: ['Approve', 'Reject'] }],
        permittedEvidence: ['referral'],
        timeoutMinutes: 2880,
      },
      { id: 'done', type: 'output', label: 'Final outcome', deliverable: 'consolidated', completionCondition: 'Findings and outcome are recorded.' },
      { id: 'escalate', type: 'escalation', label: 'Escalate', reason: 'No decision could be reached.' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'own', label: '' },
      { id: 'e2', from: 'start', to: 'screen', label: '' },
      { id: 'e3', from: 'own', to: 'join', label: '' },
      { id: 'e4', from: 'screen', to: 'join', label: '' },
      { id: 'e5', from: 'join', to: 'consolidate', label: '' },
      { id: 'e6', from: 'consolidate', to: 'refer', label: '' },
      { id: 'e7', from: 'refer', to: 'note', port: 'refer_yes', label: 'High risk' },
      { id: 'e8', from: 'refer', to: 'done', port: 'refer_no', label: 'Low or medium' },
      { id: 'e9', from: 'refer', to: 'escalate', port: 'else', label: 'Other' },
      { id: 'e10', from: 'refer', to: 'escalate', port: 'unknown', label: 'Unknown risk' },
      { id: 'e11', from: 'note', to: 'lead', label: '' },
      { id: 'e12', from: 'lead', to: 'done', port: 'responded', label: 'Decided' },
      { id: 'e13', from: 'lead', to: 'escalate', port: 'timeout', label: 'No response' },
    ],
    loops: [],
    limits: { maxTransitions: 30 },
  };
}

type Mutate = (g: WorkflowGraphInput) => void;
const node = (g: WorkflowGraphInput, id: string) => g.nodes.find((n) => n.id === id)! as Record<string, unknown>;
const dropEdge = (g: WorkflowGraphInput, id: string) => {
  g.edges = g.edges.filter((e) => e.id !== id);
};

export interface InvalidCase {
  name: string;
  description: string;
  base: 'single' | 'multi';
  expect: GraphErrorCode[];
  mutate: Mutate;
}

export const INVALID_CASES: InvalidCase[] = [
  { name: 'decision-without-else', description: 'A decision with no else route', base: 'single', expect: ['DECISION_MISSING_ELSE'], mutate: (g) => dropEdge(g, 'e5') },
  { name: 'decision-without-unknown', description: 'A decision with no unknown route', base: 'single', expect: ['DECISION_MISSING_UNKNOWN'], mutate: (g) => dropEdge(g, 'e6') },
  { name: 'loop-undeclared', description: 'A cycle that is not a declared loop', base: 'single', expect: ['UNDECLARED_CYCLE'], mutate: (g) => { g.loops = []; } },
  { name: 'loop-exhausted-inside', description: 'Exhausted route stays inside the loop', base: 'single', expect: ['LOOP_EXHAUSTED_INSIDE_LOOP'], mutate: (g) => { g.loops![0]!.exhaustedTarget = 'review'; } },
  { name: 'loop-no-exit', description: 'A loop whose body has no way out', base: 'single', expect: ['LOOP_NO_EXIT'], mutate: (g) => {
    g.edges.push({ id: 'e20', from: 'ask', to: 'ask2', label: '' }, { id: 'e21', from: 'ask2', to: 'ask', label: 'again' });
    g.nodes.push({ id: 'ask2', type: 'agent_step', label: 'Ask again', roleId: 'analyst', instruction: 'Ask again.', inputRefs: ['info_request'], outputArtifact: 'evidence_review_2' });
    g.artifacts!.push({ id: 'evidence_review_2', label: 'Second request', visibility: 'actor' });
    g.loops!.push({ id: 'spin', returnEdgeId: 'e21', maxIterations: 3, exitCondition: 'never', exhaustedTarget: 'escalate' });
    dropEdge(g, 'e7');
    g.loops = g.loops!.filter((l) => l.id !== 'info_loop');
  } },
  { name: 'loop-return-forward', description: 'A loop return edge that goes forward', base: 'single', expect: ['LOOP_RETURN_NOT_BACKWARD'], mutate: (g) => { g.loops!.push({ id: 'bad', returnEdgeId: 'e8', maxIterations: 2, exitCondition: 'n/a', exhaustedTarget: 'escalate' }); } },
  { name: 'unreachable-node', description: 'A node not reachable from the input', base: 'single', expect: ['UNREACHABLE_NODE'], mutate: (g) => { g.nodes.push({ id: 'orphan', type: 'escalation', label: 'Orphan', reason: 'Never reached' }); } },
  { name: 'dead-end', description: 'A step that never reaches a terminal', base: 'single', expect: ['NO_PATH_TO_TERMINAL'], mutate: (g) => { dropEdge(g, 'e8'); } },
  { name: 'no-terminal', description: 'No output or escalation node', base: 'multi', expect: ['NO_TERMINAL'], mutate: (g) => {
    g.nodes = g.nodes.filter((n) => n.type !== 'output' && n.type !== 'escalation');
    g.edges = g.edges.filter((e) => !['done', 'escalate'].includes(e.to));
  } },
  { name: 'join-required-on-optional-branch', description: 'A join requires an input that only arrives on one decision branch', base: 'multi', expect: ['JOIN_REQUIRED_MAY_NOT_ARRIVE'], mutate: (g) => {
    g.edges.push({ id: 'e30', from: 'note', to: 'join2', label: '' }, { id: 'e31', from: 'refer', to: 'join2', port: 'refer_no', label: 'Low or medium' }, { id: 'e32', from: 'join2', to: 'done', label: '' });
    g.edges = g.edges.filter((e) => !['e8', 'e11'].includes(e.id));
    g.nodes.push({ id: 'join2', type: 'join', label: 'Wait for referral', requiredInputs: ['note', 'refer'], optionalInputs: [] });
  } },
  { name: 'private-to-actor', description: 'An agent step reads the private rubric key', base: 'multi', expect: ['PRIVATE_TO_ACTOR'], mutate: (g) => { (node(g, 'consolidate').inputRefs as string[]).push('rubric_key'); } },
  { name: 'single-mode-two-roles', description: 'Single-agent template with two roles', base: 'single', expect: ['MODE_SINGLE_MULTIPLE_ROLES'], mutate: (g) => { g.roles.push({ id: 'second', name: 'Second', responsibility: 'Extra', tools: [], evidenceRefs: [] }); } },
  { name: 'human-without-timeout', description: 'A human step with no timeout route', base: 'single', expect: ['HUMAN_MISSING_TIMEOUT'], mutate: (g) => dropEdge(g, 'e10') },
  { name: 'artifact-not-available', description: 'A step reads an artifact produced later', base: 'single', expect: ['ARTIFACT_NOT_AVAILABLE'], mutate: (g) => { (node(g, 'review').inputRefs as string[]).push('recommendation'); } },
  { name: 'unknown-role', description: 'An agent step names a role that does not exist', base: 'single', expect: ['UNKNOWN_REFERENCE'], mutate: (g) => { node(g, 'decide').roleId = 'ghost'; } },
  { name: 'unbounded-loop-limit', description: 'A loop with no positive iteration limit', base: 'single', expect: ['SCHEMA'], mutate: (g) => { g.loops![0]!.maxIterations = 0; } },
  { name: 'executable-text-is-rejected', description: 'Extra fields such as code are rejected by the strict schema', base: 'single', expect: ['SCHEMA'], mutate: (g) => { node(g, 'review').code = 'import os; os.system("rm -rf /")'; } },
];

export function buildInvalidCase(c: InvalidCase): WorkflowGraphInput {
  const g = structuredClone(c.base === 'single' ? singleAgentKyc() : multiAgentKyb());
  c.mutate(g);
  return g;
}
