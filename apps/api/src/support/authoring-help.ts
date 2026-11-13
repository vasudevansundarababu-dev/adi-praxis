import { TEMPLATE_PROFILES, templateStartingGraph, type TemplateProfile, type TemplateProfileField } from '@praxis/shared';

/**
 * Help-bot knowledge for authoring v2.1 (owner, 12 Nov 2026): how authoring, review, approval and policy work, and
 * the decisions behind them, so Authors (SMEs), Experts, PMs and Admins get the same explanation. The per-template
 * guide is generated from the template profiles and starting workflows themselves, so it cannot drift from the
 * product. Sources: docs/authoring/*.md and docs/DECISIONS.md (Authoring v2.1 sections). Keep the prose in step.
 */
export const AUTHORING_GUIDE = `AUTHORING V2.1 — HOW A TASK IS BUILT. Each project uses one workflow template (for example KYC onboarding and refresh, Enhanced due diligence, Q4 paid search query clustering). A task has eight sections: S1 Brief (title, trigger, business context, deliverable), S2 Evidence (synthetic records the agent may read, each with an ID like E1), S3 Environment and tools (recorded tool responses, if any), S4 Policy (citations of published project rules), S5 Expected work (the reference steps, findings and template deliverables — private, the agent never sees them), S6 Allowed outcomes (the graded output values — private), S7 Rubric (criteria with weights totalling 100, at least one critical — private) and S8 Checks and submission. Private sections are visible to the author and reviewers only; the agent and downloads never get them.

CLASSIC AND CHATBOT. The project decides whether authors use Classic (a form per section), Chatbot (a conversation) or Both. They are two views of the same task: switching keeps every keystroke, and reload keeps everything. The Chatbot is a facilitator, not a writer: it only places the author's own words into fields and asks the next question the template needs. It never writes case facts, answers, rationales or rubric conditions for you, and nothing changes until you confirm a proposal. Before using the Chatbot you accept the authorship statement once.

WORKFLOW GRAPH. Below both editors the task's workflow is shown left to right: agent steps, decisions (diamonds; every decision has an "Other" and an "Unclear" route to escalation), person steps (a person inside the case, such as an approver — never the Praxis review), parallel steps that join, and correction loops with a limit (when the limit is reached the case escalates). Start from the template's workflow and edit it for your case: in Classic select a step and add a step, decision, person step, parallel step or correction loop, or remove a step; in the Chatbot describe the change in your own words and confirm it. The status line says whether the workflow passes every check. Private reference material never flows to an agent step.

CHECKS AND SUBMIT. Every save checks the task against its template: required fields, allowed values, evidence IDs that exist, weights totalling 100, at least one critical criterion, list limits (for example at most 20 queries in Q4). Submit is blocked until the checks pass, and the message names the section and field. At submission Praxis also compiles the task into Anvil's format; if it cannot (for example a criterion names an output field that does not exist), the task still submits and the reviewer sees the exact "export blocked" reason.

TASK STATES. Authoring (you are writing it or reworking it), Review pending / Approval pending (it is with the Expert or the PM), Approved (accepted into the append-only dataset; it can never be edited) — and Rejected.

REVIEW ROUTES. The project sets one of two routes. SME → PM: the project's Validator or an Admin accepts, asks for rework with comments, or rejects. SME → Expert → PM (owner decisions, 11 Nov 2026): first an Expert (a Validator assigned to the project) passes, returns with comments, edits, or rejects; then the PM (or an Admin) approves the exact version the Expert passed, returns it, or rejects it — the PM may reject too. Every decision is bound to the exact submitted version and its content: if the task changes after a pass, that pass is void and the PM cannot approve until the Expert passes the new version. The same person may be both Expert and PM; both decisions are recorded separately. Comments can be pinned to a section, a field or a graph step.

EXPERT EDITS AND "MATERIAL" CHANGES. An Expert may edit a submitted task with a recorded reason; this creates a new version and re-runs the checks. A material edit sends the task back to the author to reconfirm before it continues. Any change to the rubric or to the reference answer (KYC rubric and solution; template sections S5 expected work, S6 outcomes and S7 rubric) is always material, whatever the Expert marks (owner, 11 Nov 2026). Minor edits continue to PM approval. There is no field-by-field edit form for Experts; they use the JSON editor.

GRADING AND CRITICAL CRITERIA. Each S7 criterion names an output field, a comparison and the expected value, and carries a weight; weights total 100. Failing a critical criterion fails the whole task, whatever else the agent got right (owner, 12 Nov 2026): Praxis exports each critical criterion to Anvil also as a hard-failure rule. A zero-weight criterion is not the same as a critical one.

POLICY: WHAT AUTHORS SEE. Policies belong to the project. Authors, the Chatbot and the agent preview see only published rules that are agent-visible and in force today. Evaluator-only rules (used to grade) and rules whose effective period has ended are never shown to authors or sent to the model. Link a published rule to a step only if it applies, and say why. Never invent a rule or a threshold: if the rule you need is missing, ask, or propose the document.

PROPOSING A POLICY DOCUMENT (SMEs). If your task needs a bank or customer policy the project does not have, use "Propose a policy document" on the task page: upload a synthetic copy (PDF, Word, text or Markdown, up to 10 MB), choose its kind (bank policy, customer policy, regulation or public standard, supporting reference), say why the task needs it, and confirm it is synthetic or that you may share it. It waits for review. Praxis flags — but never rejects — files it cannot read, documents that do not look like a policy (invoices, statements, marketing), possible real personal or account data, and text addressed to an AI. An Expert assigned to the project, the PM or an Admin accepts, returns or rejects it with a reason you see. Accepting adds it to the project's documents; it becomes rules only after the PM extracts, reviews and publishes them. A file that cannot be read, or that may contain real data, cannot be accepted: it is returned for a readable, synthetic copy. Proposals are never visible to other SMEs, the Chatbot or the agent.

DECIDING POLICY PROPOSALS (Experts, PMs, Admins). Open Reviews → Task reviews → "Policy documents proposed by SMEs". Each shows who proposed it and why, the file and its sha256, and Praxis's flags as advice. Download the original and read Praxis's text (redacted where real data was suspected). Choose Accept (as a policy candidate or supporting reference), Return to the SME, or Reject, with what the document is and a reason. A decision is final.

POLICY SOURCES ON THE REVIEW PAGE (Experts, PMs). Under the graph, "Policy sources" lists every rule the task is judged against — its frozen snapshot from submission, or the project's current published rules if none was frozen — each with its quoted source, document, version, page or line and hash. Evaluator-only rules are labelled, rules not in force today are marked, the task's own rule changes and the steps the SME linked are shown. If the project published newer rules after the snapshot, the page warns you: decide whether to return the task, revalidate it, or keep it on the older version.

EXPORT TO ANVIL. An approved task exports in Anvil's task format (praxis.anvil.task.v1) with its workflow graph and the project's policy manifest. Private reference values become the reference output; the agent's evidence never contains private material.

Q4 CLUSTERING IN RL REVIEW (Validators). For Q4 paid search tasks the RL review screen shows "Clustering F1 (Praxis)": how closely the agent grouped the queries the way the reference does (pairwise F1, whatever names the agent gave its clusters), against the catalogue's 0.99 bar. It is advice for your verdict, not a verdict. If RL Gym did not send the run's output.json, the screen says the score is not available.

WHAT AI DOES AND DOES NOT DO. Models draft, check, flag and recommend. People make every decision: accepting, returning, rejecting, approving, accepting a policy proposal, and RL verdicts.`;

/** Owner decisions per template that the generated field list cannot show (docs/authoring/TEMPLATE-PROFILES.md). */
const TEMPLATE_NOTES: Record<string, string> = {
  'adverse-media-review':
    'Rate every media source high, medium, low or unknown with a reason (owner, 12 Nov 2026). An "escalate" recommendation goes to a person step, "Compliance reviewer decides" (Confirm or Dismiss); close and request_information go straight to the output.',
  'enhanced-due-diligence':
    'The overall risk rating (low, medium, high, very_high) is graded beside the recommendation; the written risk assessment stays in S5. The business hand-off is required, and the workflow ends with "Approver decides" (Approve or Decline).',
  'customer-risk-rating':
    'Rate each risk factor low, medium or high. There are no weights or formula in Praxis: your methodology evidence (S2) decides the overall rating. If you propose an override (increase or decrease), write the override rationale; the workflow sends it to "Senior compliance approver decides" (Approve or Decline). No override goes straight to the output.',
  'q4-global-paid-search-query-clustering':
    'Every query is graded (owner, 12 Nov 2026). List each query once in Query assignments — at most 20 per task; split bigger sets into more tasks. Each query becomes output fields q01_intent, q01_assignment and q01_cluster. Anvil grades intent and assignment for every query (together half the score; your own rubric criteria share the other half). Cluster names are the agent\'s own, so clustering is scored by Praxis as pairwise F1 against your clusters on returned runs, with a pass bar of 0.99. Use "none" as the cluster of an excluded query.',
  'fraud-risk-and-compliance-handoffs':
    'Fraud indicators come from a fixed list (account_takeover, money_mule, synthetic_identity, first_party_fraud, authorised_push_payment_scam, card_fraud, insider_fraud, other) and compliance concerns from another (suspicious_activity_report, sanctions, customer_due_diligence, data_protection, conduct_risk, other); describe each with its evidence, and say what "other" is. The handoff package is the hand-off, so the general business hand-off field is not shown. The workflow ends with "Receiving team accepts handoff" (Accept or Return).',
  'compliance-monitoring':
    'Give each exception its own severity (low, medium, high, critical) with evidence; the overall severity in S6 is the graded one — usually the highest, or as you judge and explain. Use undetermined only when the evidence cannot settle it.',
};

const PRIVATE = new Set(['private_reference', 'private_rubric']);

function fieldLine(f: TemplateProfileField, indent = '  '): string {
  const req = f.required === true ? ' (required)' : f.required ? ' (required in some cases)' : '';
  const vis = f.visibility && PRIVATE.has(f.visibility) ? ' [private]' : '';
  const opts = f.options?.length ? ` — values: ${f.options.map((o) => o.value).join(', ')}` : '';
  const max = f.maxItems ? ` — at most ${f.maxItems}` : '';
  const sub = f.itemFields?.length ? `\n${f.itemFields.map((x) => fieldLine(x, `${indent}  `)).join('\n')}` : '';
  return `${indent}- ${f.label}${req}${vis}${opts}${max}: ${f.help}${sub}`;
}

/** A plain-language guide to one template: sections and fields, graded outputs, the starting workflow and decisions. */
export function templateGuide(profile: TemplateProfile): string {
  const graph = templateStartingGraph(profile.catalogWorkflowName, 1, profile.profileId);
  const people = graph?.nodes.filter((n) => n.type === 'human_step').map((n) => `"${n.label}" (${(n as { actorRole?: string }).actorRole ?? 'a person'})`) ?? [];
  const outputs = profile.sections.find((s) => s.key === 'S6')!.fields.filter((f) => f.outputField);
  return [
    `TEMPLATE GUIDE: ${profile.catalogWorkflowName} (${profile.templateId}). Agent mode: ${profile.agentMode === 'SINGLE' ? 'one agent' : 'several agents'}. Field contract: ${profile.contractStatus === 'confirmed' ? 'confirmed' : 'requires domain confirmation'}.`,
    TEMPLATE_NOTES[profile.profileId] ?? '',
    outputs.length ? `Graded outputs (S6): ${outputs.map((f) => `${f.outputField} = ${(f.options ?? []).map((o) => o.value).join(' / ') || f.type}`).join('; ')}.` : '',
    graph ? `Starting workflow: ${graph.nodes.filter((n) => n.type !== 'input' && n.type !== 'output' && n.type !== 'escalation').map((n) => n.label).join(' → ')}.${people.length ? ` Person steps: ${people.join(', ')}.` : ' No person steps.'}` : '',
    ...profile.sections.filter((s) => s.fields.length).map((s) => `${s.key} ${s.title}:\n${s.fields.map((f) => fieldLine(f)).join('\n')}`),
  ]
    .filter(Boolean)
    .join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES: Record<string, string[]> = {
  'kyc-onboarding-and-refresh': ['kyc'],
  'kyb-and-beneficial-ownership': ['kyb', 'beneficial ownership'],
  'aml-transaction-monitoring-alerts': ['aml', 'transaction monitoring'],
  'adverse-media-review': ['adverse media'],
  'enhanced-due-diligence': ['edd', 'enhanced due diligence'],
  'customer-risk-rating': ['crr', 'customer risk rating', 'risk rating'],
  'q4-global-paid-search-query-clustering': ['q4', 'paid search', 'query clustering'],
  'fraud-risk-and-compliance-handoffs': ['fraud', 'handoff'],
  'compliance-monitoring': ['compliance monitoring'],
  'omnichannel-creative-and-locale-compliance': ['omnichannel', 'locale compliance'],
};

/**
 * The templates a question or the record on screen is about: a catalogue name in the record, or a name or common
 * short form in the question. At most two, so the context stays small.
 */
export function templatesFor(question: string, record: unknown): TemplateProfile[] {
  const recordText = norm(JSON.stringify(record ?? ''));
  const q = ` ${norm(question)} `;
  const hits = TEMPLATE_PROFILES.filter((p) => {
    const names = [p.catalogWorkflowName, p.handoverName ?? ''].filter(Boolean).map(norm);
    if (names.some((n) => recordText.includes(n))) return true;
    return [...names, ...(ALIASES[p.profileId] ?? [])].some((n) => q.includes(` ${norm(n)} `));
  });
  return hits.slice(0, 2);
}
