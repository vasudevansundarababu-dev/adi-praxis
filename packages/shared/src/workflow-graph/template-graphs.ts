import { WORKFLOW_GRAPH_SCHEMA, type WorkflowGraphInput } from './schema';

/**
 * Starting workflows for the Wave 1, 2 and 3 templates. An SME starts from the template's workflow with an explicit
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
  /** The person step is reached only when the result matches (owner, 12 Nov): e.g. an override was proposed. */
  humanWhen?: { question: string; label: string; field: string; op: 'eq' | 'in'; value: string | string[]; otherwiseLabel: string; otherwise: { op: 'eq' | 'neq'; value: string } };
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
    if (p.humanWhen) {
      const w = p.humanWhen;
      nodes.push({
        id: 'needs_person',
        type: 'decision',
        label: w.question,
        question: w.question,
        conditions: [
          { id: 'yes', label: w.label, field: w.field, op: w.op, value: w.value },
          { id: 'no', label: w.otherwiseLabel, field: w.field, op: w.otherwise.op, value: w.otherwise.value },
        ],
      });
      edges.push(
        { id: 'e8', from: 'conclude', to: 'needs_person', label: '' },
        { id: 'e11', from: 'needs_person', to: 'human', port: 'yes', label: w.label },
        { id: 'e12', from: 'needs_person', to: 'done', port: 'no', label: w.otherwiseLabel },
        { id: 'e13', from: 'needs_person', to: 'escalate', port: 'else', label: 'Other' },
        { id: 'e14', from: 'needs_person', to: 'escalate', port: 'unknown', label: 'Unclear' },
      );
    } else {
      edges.push({ id: 'e8', from: 'conclude', to: 'human', label: '' });
    }
    edges.push(
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
  // Wave 2. The tool catalogue of these templates is not qualified yet (task.md open questions), so roles list none.
  'Adverse media review': {
    templateId: 'adverse-media-review',
    role: { name: 'Adverse media analyst', responsibility: 'Decide whether media is about the customer and whether it matters', tools: [] },
    evidence: 'Customer identifiers, media extracts and source metadata',
    review: { label: 'Assess media', instruction: 'Match each extract to the customer identifiers; judge source reliability and separate allegations from established facts, citing evidence IDs.', output: 'Match and source assessment' },
    missing: { question: 'Identity resolved?', label: 'Request identifiers', instruction: 'Ask for the specific identifier or source detail needed to resolve the match.' },
    conclude: { label: 'Recommend outcome', instruction: 'State the match status and relevance, then recommend an outcome with rationale.', output: 'Match status and recommendation' },
    // Owner, 12 Nov: an "escalate" recommendation goes to a compliance reviewer.
    human: { label: 'Compliance reviewer decides', actorRole: 'Compliance reviewer', prompt: 'Confirm or dismiss the escalated adverse media.', choices: ['Confirm', 'Dismiss'] },
    humanWhen: { question: 'Escalation recommended?', label: 'Escalate', field: 'result.recommendation', op: 'eq', value: 'escalate', otherwiseLabel: 'Close or request information', otherwise: { op: 'neq', value: 'escalate' } },
    outputLabel: 'Adverse media recommendation',
    escalation: 'The match or its relevance cannot be resolved with the available evidence.',
  },
  'Enhanced due diligence': {
    templateId: 'enhanced-due-diligence',
    role: { name: 'EDD analyst', responsibility: 'Carry out enhanced checks on a higher-risk relationship', tools: [] },
    evidence: 'High-risk case, funds, wealth, ownership and adverse findings',
    review: { label: 'Perform enhanced checks', instruction: 'Check source of funds, source of wealth, ownership and adverse findings; record each evidence status with evidence IDs.', output: 'Enhanced check findings' },
    missing: { question: 'Evidence sufficient?', label: 'Request evidence', instruction: 'Ask for exactly the missing or conflicting evidence and say why it is needed.' },
    conclude: { label: 'Assess risk and recommend', instruction: 'Assess the relationship risk and recommend a next action with rationale and a hand-off.', output: 'Risk assessment, recommendation and hand-off' },
    human: { label: 'Approver decides', actorRole: 'Authorised approver', prompt: 'Approve or decline the relationship on the EDD recommendation.', choices: ['Approve', 'Decline'] },
    outputLabel: 'EDD recommendation',
    escalation: 'The relationship cannot be assessed with the available evidence.',
  },
  'Customer risk rating': {
    templateId: 'customer-risk-rating',
    role: { name: 'Risk rating analyst', responsibility: 'Assess risk factors and propose a rating under the versioned methodology', tools: [] },
    evidence: 'Customer profile, risk factors and rating methodology',
    review: { label: 'Assess risk factors', instruction: 'Assess each factor the methodology names against the evidence, citing evidence IDs.', output: 'Factor assessments' },
    missing: { question: 'Factors supported?', label: 'Request factor evidence', instruction: 'Ask for the specific evidence a risk factor needs.' },
    conclude: { label: 'Propose rating', instruction: 'Calculate the rating where the methodology supports it; propose the risk and any override with rationale.', output: 'Proposed risk, override and rationale' },
    // Owner, 12 Nov: a proposed override needs a senior compliance approver.
    human: { label: 'Senior compliance approver decides', actorRole: 'Senior compliance approver', prompt: 'Approve or decline the proposed override of the calculated rating.', choices: ['Approve', 'Decline'] },
    humanWhen: { question: 'Override proposed?', label: 'Override proposed', field: 'result.override', op: 'in', value: ['proposed_increase', 'proposed_decrease'], otherwiseLabel: 'No override', otherwise: { op: 'eq', value: 'none' } },
    outputLabel: 'Proposed risk rating',
    escalation: 'The rating cannot be determined with the available evidence.',
  },
  // Wave 3. As in Wave 2, the tool catalogue is not qualified yet (task.md open questions), so roles list none.
  'Q4 Global Paid Search Query Clustering': {
    templateId: 'q4-global-paid-search-query-clustering',
    role: { name: 'Paid search analyst', responsibility: 'Cluster search queries and label their intent under the brief', tools: [] },
    evidence: 'Query dataset, product brief, locale and channel constraints',
    review: { label: 'Cluster and label queries', instruction: 'Group the queries into clusters under the brief’s rules; label each query’s intent and assign, exclude or flag it, citing evidence IDs.', output: 'Clusters and query labels' },
    missing: { question: 'Brief sufficient?', label: 'Request clarification', instruction: 'Ask for the specific brief, locale or channel detail needed to place the ambiguous queries.' },
    conclude: { label: 'Finalise clusters', instruction: 'State the clusters, query assignments, intent labels, exclusions and ambiguous queries with rationale.', output: 'Clusters, assignments, exclusions and rationale' },
    human: null,
    outputLabel: 'Query clustering',
    escalation: 'The queries cannot be clustered with the available brief and constraints.',
  },
  'Fraud-risk/compliance handoffs': {
    templateId: 'fraud-risk-and-compliance-handoffs',
    role: { name: 'Fraud-compliance handoff analyst', responsibility: 'Establish the facts and route the case to the right team with a complete handoff', tools: [] },
    evidence: 'Fraud alert, transaction records, case timeline, roles and escalation policy',
    review: { label: 'Assess the case', instruction: 'Establish the facts from the records and timeline; identify fraud indicators and compliance concerns, keeping facts apart from suspicions and citing evidence IDs.', output: 'Facts, fraud indicators and compliance concerns' },
    missing: { question: 'Facts established?', label: 'Request information', instruction: 'Ask for the specific record or timeline detail needed to establish the facts.' },
    conclude: { label: 'Prepare handoff', instruction: 'Choose the handoff route under the escalation policy, assemble the handoff package and recommend a next action with rationale.', output: 'Handoff route, package and recommendation' },
    // Owner, 12 Nov: the receiving team accepts or returns the handoff.
    human: { label: 'Receiving team accepts handoff', actorRole: 'Receiving fraud or compliance team', prompt: 'Accept the handoff package, or return it saying what is missing.', choices: ['Accept', 'Return'] },
    outputLabel: 'Handoff package',
    escalation: 'The case cannot be routed with the available evidence.',
  },
  'Compliance monitoring': {
    templateId: 'compliance-monitoring',
    role: { name: 'Compliance monitoring analyst', responsibility: 'Test the records against each obligation in the monitoring scope', tools: [] },
    evidence: 'Monitoring scope, records, obligations and monitoring period',
    review: { label: 'Assess obligations', instruction: 'Map each obligation in scope to the records for the monitoring period and record its result with evidence IDs.', output: 'Obligation-to-evidence assessment' },
    missing: { question: 'Evidence sufficient?', label: 'Request records', instruction: 'Ask for exactly the missing records and say which obligation needs them.' },
    conclude: { label: 'Rate and propose follow-up', instruction: 'State the exceptions, their severity and the proposed follow-up with rationale.', output: 'Result, exceptions, severity and follow-up' },
    human: null,
    outputLabel: 'Monitoring result',
    escalation: 'The obligations cannot be assessed with the available records.',
  },
};

/** Every template with a starting workflow (Waves 1 to 3). */
export const STARTING_GRAPH_TEMPLATES = Object.keys(PATTERNS);
export const WAVE1_GRAPH_TEMPLATES = STARTING_GRAPH_TEMPLATES.slice(0, 5);
export const WAVE2_GRAPH_TEMPLATES = STARTING_GRAPH_TEMPLATES.slice(5, 8);
export const WAVE3_GRAPH_TEMPLATES = STARTING_GRAPH_TEMPLATES.slice(8);

/** The template's starting workflow, or null when the template has none yet. */
export function templateStartingGraph(workflowName: string, templateVersion = 1): WorkflowGraphInput | null {
  const key = Object.keys(PATTERNS).find((k) => normalise(k) === normalise(workflowName));
  return key ? reviewPattern(PATTERNS[key]!, templateVersion) : null;
}

const normalise = (s: string) => s.toLowerCase().replace(/[–—]/g, '-').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
