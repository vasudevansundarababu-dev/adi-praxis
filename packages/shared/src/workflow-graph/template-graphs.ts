import { WORKFLOW_GRAPH_SCHEMA, type WorkflowGraphInput } from './schema';

/**
 * Starting workflows for the Wave 1 templates. An SME starts from the template's workflow with an explicit
 * "Start from the template workflow" action, then edits it for the assigned case. These describe the template's
 * process shape only: they hold no case facts, answers or rubric judgements.
 */
interface Pattern {
  templateId: string;
  role: { name: string; responsibility: string; tools: string[] };
  evidence: string;
  review: { label: string; instruction: string; output: string };
  missing: { question: string; label: string; instruction: string };
  conclude: { label: string; instruction: string; output: string };
  human: { label: string; actorRole: string; prompt: string; choices: [string, string] } | null;
  outputLabel: string;
  escalation: string;
}

function reviewPattern(p: Pattern, templateVersion = 1): WorkflowGraphInput {
  const nodes: WorkflowGraphInput['nodes'] = [
    { id: 'start', type: 'input', label: 'Case inputs', provides: ['case_inputs'] },
    { id: 'review', type: 'agent_step', label: p.review.label, roleId: 'agent', instruction: p.review.instruction, inputRefs: ['case_inputs'], outputArtifact: 'findings' },
    {
      id: 'sufficient',
      type: 'decision',
      label: p.missing.question,
      question: p.missing.question,
      conditions: [
        { id: 'yes', label: 'Sufficient', field: 'findings.sufficient', op: 'eq', value: true },
        { id: 'no', label: 'Something missing', field: 'findings.sufficient', op: 'eq', value: false },
      ],
    },
    { id: 'request', type: 'agent_step', label: p.missing.label, roleId: 'agent', instruction: p.missing.instruction, inputRefs: ['findings'], outputArtifact: 'request' },
    { id: 'conclude', type: 'agent_step', label: p.conclude.label, roleId: 'agent', instruction: p.conclude.instruction, inputRefs: ['findings'], outputArtifact: 'result' },
    { id: 'done', type: 'output', label: p.outputLabel, deliverable: 'result', completionCondition: 'output.json holds every required field with an allowed value.' },
    { id: 'escalate', type: 'escalation', label: 'Escalate', reason: p.escalation },
  ];
  const edges: WorkflowGraphInput['edges'] = [
    { id: 'e1', from: 'start', to: 'review', label: '' },
    { id: 'e2', from: 'review', to: 'sufficient', label: '' },
    { id: 'e3', from: 'sufficient', to: 'conclude', port: 'yes', label: 'Sufficient' },
    { id: 'e4', from: 'sufficient', to: 'request', port: 'no', label: 'Missing' },
    { id: 'e5', from: 'sufficient', to: 'escalate', port: 'else', label: 'Other' },
    { id: 'e6', from: 'sufficient', to: 'escalate', port: 'unknown', label: 'Unclear' },
    { id: 'e7', from: 'request', to: 'review', label: 'Re-review' },
  ];
  if (p.human) {
    nodes.push({
      id: 'human',
      type: 'human_step',
      label: p.human.label,
      actorRole: p.human.actorRole,
      prompt: p.human.prompt,
      responseSchema: [{ key: 'decision', label: 'Decision', type: 'choice', options: [...p.human.choices] }],
      permittedEvidence: ['case_inputs', 'result'],
      timeoutMinutes: 1440,
    });
    edges.push(
      { id: 'e8', from: 'conclude', to: 'human', label: '' },
      { id: 'e9', from: 'human', to: 'done', port: 'responded', label: 'Responded' },
      { id: 'e10', from: 'human', to: 'escalate', port: 'timeout', label: 'No response' },
    );
  } else {
    edges.push({ id: 'e8', from: 'conclude', to: 'done', label: '' });
  }
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA,
    templateId: p.templateId,
    templateVersion,
    agentMode: 'SINGLE',
    roles: [{ id: 'agent', name: p.role.name, responsibility: p.role.responsibility, tools: p.role.tools, evidenceRefs: ['case_inputs'] }],
    artifacts: [
      { id: 'case_inputs', label: p.evidence, visibility: 'actor' },
      { id: 'findings', label: p.review.output, visibility: 'actor' },
      { id: 'request', label: 'Request for missing information', visibility: 'actor' },
      { id: 'result', label: p.conclude.output, visibility: 'actor' },
    ],
    nodes,
    edges,
    loops: [{ id: 'missing_info', returnEdgeId: 'e7', maxIterations: 2, exitCondition: 'The inputs are sufficient to conclude.', exhaustedTarget: 'escalate' }],
    limits: { maxTransitions: 40 },
  };
}

const PATTERNS: Record<string, Pattern> = {
  'KYC onboarding and refresh': {
    templateId: 'kyc-onboarding-and-refresh',
    role: { name: 'KYC analyst', responsibility: 'Assess the applicant’s identity, address and risk evidence', tools: ['document_check', 'registry_lookup', 'sanctions_pep_screening', 'risk_calculator', 'request_info'] },
    evidence: 'Customer file and evidence documents',
    review: { label: 'Review evidence', instruction: 'Check each document and party against the customer file; record discrepancies with evidence IDs.', output: 'Evidence findings' },
    missing: { question: 'Evidence sufficient?', label: 'Request information', instruction: 'Ask for exactly the missing or stale document and say why it is needed.' },
    conclude: { label: 'Recommend disposition', instruction: 'Recommend a disposition and risk rating with rationale citing evidence.', output: 'Disposition, risk rating and rationale' },
    human: { label: 'Approver decides', actorRole: 'Authorised approver', prompt: 'Approve or decline the recommended disposition.', choices: ['Approve', 'Decline'] },
    outputLabel: 'KYC recommendation',
    escalation: 'The case cannot be concluded with the available evidence.',
  },
  'KYB and beneficial ownership': {
    templateId: 'kyb-and-beneficial-ownership',
    role: { name: 'KYB analyst', responsibility: 'Resolve the ownership chain and identify beneficial owners', tools: ['registry_lookup', 'document_check', 'sanctions_pep_screening', 'request_info'] },
    evidence: 'Entity records and ownership documents',
    review: { label: 'Map ownership', instruction: 'Trace ownership to natural persons with percentages and control, citing records.', output: 'Ownership map' },
    missing: { question: 'Ownership resolved?', label: 'Request ownership details', instruction: 'Ask for the specific undisclosed owner or document.' },
    conclude: { label: 'Recommend outcome', instruction: 'Identify beneficial owners and recommend an outcome with rationale.', output: 'Beneficial owners and recommendation' },
    human: null,
    outputLabel: 'KYB recommendation',
    escalation: 'Ownership cannot be resolved within the allowed requests.',
  },
  'AML transaction-monitoring alerts': {
    templateId: 'aml-transaction-monitoring-alerts',
    role: { name: 'AML alert analyst', responsibility: 'Triage monitoring alerts and decide which to escalate', tools: ['transaction_history', 'customer_profile', 'request_info'] },
    evidence: 'Alerts, transactions and customer profile',
    review: { label: 'Triage alerts', instruction: 'Review each alert against the transaction pattern and customer profile.', output: 'Alert assessments' },
    missing: { question: 'Context sufficient?', label: 'Request context', instruction: 'Ask for the specific missing transaction or profile detail.' },
    conclude: { label: 'Disposition alerts', instruction: 'Close or escalate each alert and write a case summary.', output: 'Alert dispositions and case summary' },
    human: { label: 'Investigator decides', actorRole: 'AML investigator', prompt: 'Accept or return the escalation set.', choices: ['Accept', 'Return'] },
    outputLabel: 'Alert dispositions',
    escalation: 'The alerts cannot be dispositioned with the available context.',
  },
  'Omnichannel Creative & Locale Compliance': {
    templateId: 'omnichannel-creative-and-locale-compliance',
    role: { name: 'Creative compliance reviewer', responsibility: 'Check creative variants against locale and brand rules', tools: [] },
    evidence: 'Creative brief, variants and locale rules',
    review: { label: 'Review creative', instruction: 'Check each variant for locale, language, currency and claim compliance.', output: 'Compliance findings' },
    missing: { question: 'Rules and assets complete?', label: 'Request assets', instruction: 'Ask for the missing locale rule or asset.' },
    conclude: { label: 'Select compliant variants', instruction: 'Select compliant variants and state required changes.', output: 'Selected variants and required changes' },
    human: null,
    outputLabel: 'Compliance decision',
    escalation: 'Compliance cannot be determined from the available rules.',
  },
  'Launch of Noise Cancelling Phone': {
    templateId: 'noise-cancelling-headphones-launch',
    role: { name: 'Launch marketing planner', responsibility: 'Plan launch spend, creative and keywords within policy', tools: [] },
    evidence: 'Launch brief, budget and candidate creative',
    review: { label: 'Assess brief', instruction: 'Work out budget pacing, compliant headlines and keyword intent from the brief.', output: 'Plan inputs' },
    missing: { question: 'Brief complete?', label: 'Request brief details', instruction: 'Ask for the specific missing budget or creative detail.' },
    conclude: { label: 'Draft launch plan', instruction: 'Set weekly spend, headline and keyword intent; flag approvals needed.', output: 'Launch plan' },
    human: { label: 'Manager approves event', actorRole: 'Marketing manager', prompt: 'Approve or reject the customer-facing launch event.', choices: ['Approve', 'Reject'] },
    outputLabel: 'Launch plan',
    escalation: 'The plan cannot meet policy with the given brief.',
  },
};

export const WAVE1_GRAPH_TEMPLATES = Object.keys(PATTERNS);

/** The template's starting workflow, or null when the template has none yet. */
export function templateStartingGraph(workflowName: string, templateVersion = 1): WorkflowGraphInput | null {
  const key = Object.keys(PATTERNS).find((k) => normalise(k) === normalise(workflowName));
  return key ? reviewPattern(PATTERNS[key]!, templateVersion) : null;
}

const normalise = (s: string) => s.toLowerCase().replace(/[–—]/g, '-').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
