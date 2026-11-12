import { WORKFLOW_GRAPH_SCHEMA, type WorkflowGraphInput } from './schema';

/**
 * Golden Task2 (Marketing): campaign planning and weekly intent optimisation, five agents (owner's handoff v1.1,
 * 12 Nov 2026; docs/authoring/MARKETING-TASK2.md). This is the authored starting workflow in Praxis's own graph
 * schema. It maps the handoff's graph proposal without inventing runtime support:
 * - the five agents are roles with their own tool scopes;
 * - intent and performance analysis run in parallel and meet at a join;
 * - Task3 media production is an external system, never a sixth agent;
 * - the campaign approver is a simulated person in the case, never a real human approval;
 * - the controller's weekly release and "apply" are not agent steps: the weekly cycle is the loop back to intake;
 * - revisions are bounded at two rounds, the campaign at twelve weeks; exhausting either escalates.
 */

/** Tool scopes per role (handoff agents/*.json). Reads common to every role come first. */
export const MARKETING_T2_COMMON_READS = ['context.read', 'campaigns.read', 'products.read', 'offers.read', 'capabilities.read', 'policies.read', 'source_documents.read', 'budget_summaries.read', 'operations.status.read', 'handoffs.assigned.read'] as const;
export const MARKETING_T2_ROLE_TOOLS = {
  campaign_orchestrator: ['plans.write', 'handoffs.assign', 'disagreements.record', 'readiness.request', 'approval_requests.submit'],
  intent_analyst: ['questions.read', 'observations.read', 'intent.write', 'investigations.write'],
  performance_budget_analyst: ['reports.query', 'ledger.read', 'budget.read', 'forecasts.request', 'experiments.propose', 'budget_proposals.write'],
  brief_delivery_coordinator: ['briefs.write', 'production_requests.submit', 'delivery_manifests.read', 'asset_refs.read'],
  campaign_policy_reviewer: ['evidence.read', 'campaign_findings.write', 'review_assessments.write'],
} as const;
export const MARKETING_T2_TOOLS: string[] = [...new Set([...MARKETING_T2_COMMON_READS, ...Object.values(MARKETING_T2_ROLE_TOOLS).flat()])];

const tools = (role: keyof typeof MARKETING_T2_ROLE_TOOLS) => [...MARKETING_T2_COMMON_READS, ...MARKETING_T2_ROLE_TOOLS[role]];

export function marketingTask2Graph(templateVersion = 2): WorkflowGraphInput {
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA,
    templateId: 'noise-cancelling-headphones-launch',
    templateVersion,
    agentMode: 'MULTI',
    roles: [
      { id: 'orchestrator', name: 'Campaign Orchestrator', responsibility: 'Coordinate the twelve-week campaign on released evidence; reconcile permissible options; submit exact campaign and spending approval requests. Never generate media, self-approve or override a mandatory blocker.', tools: tools('campaign_orchestrator'), evidenceRefs: ['campaign_context', 'released_evidence'] },
      { id: 'intent', name: 'Intent Analyst', responsibility: 'Distinguish research, purchase, support and ambiguous intent; assess weekly change, coverage and exposure confounders. Corpus frequency is not search volume.', tools: tools('intent_analyst'), evidenceRefs: ['campaign_context', 'released_evidence'] },
      { id: 'performance', name: 'Performance and Budget Analyst', responsibility: 'Reconcile daily and weekly reports; keep caps, reservations, commitments and actuals apart; propose bounded tests or a hold.', tools: tools('performance_budget_analyst'), evidenceRefs: ['campaign_context', 'released_evidence'] },
      { id: 'brief', name: 'Creative Brief and Delivery Coordinator', responsibility: 'Turn justified opportunities into supported briefs and Task3 work orders; verify delivery versions, rights and costs. Never generate media or certify assets.', tools: tools('brief_delivery_coordinator'), evidenceRefs: ['campaign_context'] },
      { id: 'policy', name: 'Campaign Policy Reviewer', responsibility: 'Independently check targeting, claims, offers, tracking and readiness; return exact findings and escalate unknown applicability.', tools: tools('campaign_policy_reviewer'), evidenceRefs: ['campaign_context'] },
    ],
    artifacts: [
      { id: 'campaign_context', label: 'Assignment, product, offers, budget authority and bound policies', visibility: 'actor' },
      { id: 'released_evidence', label: 'Evidence released for the current reporting window', visibility: 'actor' },
      { id: 'assignments', label: 'Analysis assignments for this cycle', visibility: 'actor' },
      { id: 'intent_assessment', label: 'Intent assessment', visibility: 'actor' },
      { id: 'performance_assessment', label: 'Performance and budget assessment', visibility: 'actor' },
      { id: 'campaign_plan', label: 'Campaign plan or weekly decision', visibility: 'actor' },
      { id: 'production_request', label: 'Creative brief and Task3 work order', visibility: 'actor' },
      { id: 'delivery_manifest', label: 'Task3 delivery manifest (exact asset versions, rights, costs)', visibility: 'actor' },
      { id: 'campaign_findings', label: 'Policy findings and readiness recommendation', visibility: 'actor' },
      { id: 'approval_request', label: 'Approval request for exact versions and scope', visibility: 'actor' },
      { id: 'approval_status', label: 'Approval status read back', visibility: 'actor' },
      { id: 'weekly_review', label: 'Weekly review: action or hold, with reasoning', visibility: 'actor' },
      { id: 'closeout_report', label: 'Campaign close-out report', visibility: 'actor' },
      { id: 'reference_outcomes', label: 'Reference decisions and alternate outcomes (Anvil evaluator only)', visibility: 'private_reference' },
    ],
    nodes: [
      { id: 'start', type: 'input', label: 'Campaign context and released evidence', provides: ['campaign_context', 'released_evidence'] },
      { id: 'intake', type: 'agent_step', label: 'Intake and assign analyses', roleId: 'orchestrator', instruction: 'Read the released window and assign the intent and performance analyses with exact evidence versions, scope and due point.', inputRefs: ['campaign_context', 'released_evidence'], outputArtifact: 'assignments' },
      { id: 'intent_step', type: 'agent_step', label: 'Assess intent', roleId: 'intent', instruction: 'Classify released questions by intent and assess weekly change, separating real intent change from collection, spam, translation or outage effects.', inputRefs: ['assignments', 'released_evidence'], outputArtifact: 'intent_assessment' },
      { id: 'performance_step', type: 'agent_step', label: 'Assess performance and budget', roleId: 'performance', instruction: 'Reconcile reports and the ledger; state caps, reservations, commitments and actuals once each; flag uncertainty and missing metrics as null, not zero.', inputRefs: ['assignments', 'released_evidence'], outputArtifact: 'performance_assessment' },
      { id: 'analyses', type: 'join', label: 'Both analyses complete', requiredInputs: ['intent_step', 'performance_step'], optionalInputs: [] },
      { id: 'decide', type: 'agent_step', label: 'Decide the cycle', roleId: 'orchestrator', instruction: 'Choose new or revised creative, a targeting or budget change, or a supported hold, within authority, citing both analyses.', inputRefs: ['intent_assessment', 'performance_assessment'], outputArtifact: 'campaign_plan' },
      {
        id: 'route',
        type: 'decision',
        label: 'What does the cycle need?',
        question: 'Does the decision need creative work, a policy review of a change, or a hold?',
        conditions: [
          { id: 'creative', label: 'New or revised creative', field: 'campaign_plan.action', op: 'eq', value: 'creative' },
          { id: 'change', label: 'Reuse, targeting or budget change', field: 'campaign_plan.action', op: 'eq', value: 'change' },
          { id: 'hold', label: 'Supported hold', field: 'campaign_plan.action', op: 'eq', value: 'hold' },
        ],
      },
      { id: 'brief_step', type: 'agent_step', label: 'Write brief and work order', roleId: 'brief', instruction: 'Write a supported brief and the Task3 work order: intent evidence, locale and placement, supported claims, brand and offer versions, formats, cost ceiling and due date.', inputRefs: ['campaign_plan'], outputArtifact: 'production_request' },
      { id: 'task3', type: 'external_system', label: 'Task3 media production', system: 'Task3 media production and DAM (environment fixture)', request: 'Produce the assets in the work order and return exact DAM versions, rights, review records and costs.', sendsRefs: ['production_request'], returnsArtifact: 'delivery_manifest' },
      { id: 'policy_step', type: 'agent_step', label: 'Policy and readiness review', roleId: 'policy', instruction: 'Check targeting, claims, offers, tracking and readiness against the bound policies; return exact findings and escalate unknown applicability.', inputRefs: ['campaign_plan', 'delivery_manifest'], outputArtifact: 'campaign_findings' },
      {
        id: 'findings',
        type: 'decision',
        label: 'Any blocking finding?',
        question: 'Do the policy findings clear the package, or need a creative or planning revision?',
        conditions: [
          { id: 'clear', label: 'No mandatory blocker', field: 'campaign_findings.outcome', op: 'eq', value: 'clear' },
          { id: 'creative_fix', label: 'Creative finding', field: 'campaign_findings.outcome', op: 'eq', value: 'creative_finding' },
          { id: 'plan_fix', label: 'Planning or funding finding', field: 'campaign_findings.outcome', op: 'eq', value: 'planning_finding' },
        ],
      },
      { id: 'request', type: 'agent_step', label: 'Submit approval request', roleId: 'orchestrator', instruction: 'Submit an approval request for the exact versions, scope and spend. Never self-approve.', inputRefs: ['campaign_plan', 'campaign_findings'], outputArtifact: 'approval_request' },
      {
        id: 'approver',
        type: 'human_step',
        label: 'Campaign approver (simulated)',
        actorRole: 'Campaign and spending approver (simulated by the environment)',
        prompt: 'Approve, request a revision, or reject the request for these exact versions and scope.',
        responseSchema: [{ key: 'decision', label: 'Decision', type: 'choice', options: ['Approve', 'Request revision', 'Reject'] }],
        permittedEvidence: ['approval_request'],
        timeoutMinutes: 2880,
        simulated: true,
      },
      { id: 'status', type: 'agent_step', label: 'Read the approval status', roleId: 'orchestrator', instruction: 'Look up the operation status after the request; never assume an approval.', inputRefs: ['approval_request'], outputArtifact: 'approval_status' },
      {
        id: 'approved',
        type: 'decision',
        label: 'Approved?',
        question: 'What did the approver decide for these exact versions?',
        conditions: [
          { id: 'approved_yes', label: 'Approved', field: 'approval_status.decision', op: 'eq', value: 'approved' },
          { id: 'revise', label: 'Revision requested', field: 'approval_status.decision', op: 'eq', value: 'revision_requested' },
        ],
      },
      { id: 'weekly', type: 'agent_step', label: 'Weekly review', roleId: 'orchestrator', instruction: 'Record the weekly action or hold with its reasoning and the evidence versions used.', inputRefs: ['campaign_plan'], outputArtifact: 'weekly_review' },
      {
        id: 'campaign_over',
        type: 'decision',
        label: 'Campaign over?',
        question: 'Has the final report after the twelfth week been released?',
        conditions: [
          { id: 'next_week', label: 'Next reporting window', field: 'weekly_review.campaign_complete', op: 'eq', value: false },
          { id: 'final', label: 'Final report released', field: 'weekly_review.campaign_complete', op: 'eq', value: true },
        ],
      },
      { id: 'closeout', type: 'agent_step', label: 'Close out the campaign', roleId: 'orchestrator', instruction: 'Write the close-out: outcomes against the objective, spend by category counted once, and what remains unresolved.', inputRefs: ['weekly_review'], outputArtifact: 'closeout_report' },
      { id: 'done', type: 'output', label: 'Campaign closed', deliverable: 'closeout_report', completionCondition: 'The close-out report exists with weekly reviews for every released window.' },
      { id: 'awaiting_authority', type: 'escalation', label: 'Awaiting authority (correct hold)', reason: 'Approval pending, rejected or unresolved, or the revision or campaign limit was reached: stop and escalate without fabricating approval.' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'intake', label: '' },
      { id: 'e2', from: 'intake', to: 'intent_step', label: '' },
      { id: 'e3', from: 'intake', to: 'performance_step', label: '' },
      { id: 'e4', from: 'intent_step', to: 'analyses', label: '' },
      { id: 'e5', from: 'performance_step', to: 'analyses', label: '' },
      { id: 'e6', from: 'analyses', to: 'decide', label: '' },
      { id: 'e7', from: 'decide', to: 'route', label: '' },
      { id: 'e8', from: 'route', to: 'brief_step', port: 'creative', label: 'Creative' },
      { id: 'e9', from: 'route', to: 'policy_step', port: 'change', label: 'Change' },
      { id: 'e10', from: 'route', to: 'weekly', port: 'hold', label: 'Hold' },
      { id: 'e11', from: 'route', to: 'awaiting_authority', port: 'else', label: 'Other' },
      { id: 'e12', from: 'route', to: 'awaiting_authority', port: 'unknown', label: 'Unreadable' },
      { id: 'e13', from: 'brief_step', to: 'task3', label: '' },
      { id: 'e14', from: 'task3', to: 'policy_step', label: 'Delivered' },
      { id: 'e15', from: 'policy_step', to: 'findings', label: '' },
      { id: 'e16', from: 'findings', to: 'request', port: 'clear', label: 'Clear' },
      { id: 'e17', from: 'findings', to: 'brief_step', port: 'creative_fix', label: 'Revise creative' },
      { id: 'e18', from: 'findings', to: 'decide', port: 'plan_fix', label: 'Revise plan' },
      { id: 'e19', from: 'findings', to: 'awaiting_authority', port: 'else', label: 'Other' },
      { id: 'e20', from: 'findings', to: 'awaiting_authority', port: 'unknown', label: 'Unreadable' },
      { id: 'e21', from: 'request', to: 'approver', label: '' },
      { id: 'e22', from: 'approver', to: 'status', port: 'responded', label: 'Responded' },
      { id: 'e23', from: 'approver', to: 'awaiting_authority', port: 'timeout', label: 'No response' },
      { id: 'e24', from: 'status', to: 'approved', label: '' },
      { id: 'e25', from: 'approved', to: 'weekly', port: 'approved_yes', label: 'Approved' },
      { id: 'e26', from: 'approved', to: 'decide', port: 'revise', label: 'Revise' },
      { id: 'e27', from: 'approved', to: 'awaiting_authority', port: 'else', label: 'Rejected or pending' },
      { id: 'e28', from: 'approved', to: 'awaiting_authority', port: 'unknown', label: 'Unknown' },
      { id: 'e29', from: 'weekly', to: 'campaign_over', label: '' },
      { id: 'e30', from: 'campaign_over', to: 'intake', port: 'next_week', label: 'Next week' },
      { id: 'e31', from: 'campaign_over', to: 'closeout', port: 'final', label: 'Final report' },
      { id: 'e32', from: 'campaign_over', to: 'awaiting_authority', port: 'else', label: 'Other' },
      { id: 'e33', from: 'campaign_over', to: 'awaiting_authority', port: 'unknown', label: 'Unknown' },
      { id: 'e34', from: 'closeout', to: 'done', label: '' },
    ],
    loops: [
      { id: 'creative_revision', returnEdgeId: 'e17', maxIterations: 2, exitCondition: 'Policy review clears the creative', exhaustedTarget: 'awaiting_authority' },
      { id: 'plan_revision', returnEdgeId: 'e18', maxIterations: 2, exitCondition: 'Policy review clears the plan', exhaustedTarget: 'awaiting_authority' },
      { id: 'approval_revision', returnEdgeId: 'e26', maxIterations: 2, exitCondition: 'The approver approves the exact versions', exhaustedTarget: 'awaiting_authority' },
      { id: 'weekly_cycle', returnEdgeId: 'e30', maxIterations: 12, exitCondition: 'The final report after week 12 is released', exhaustedTarget: 'awaiting_authority' },
    ],
    limits: { maxTransitions: 400 },
  };
}
