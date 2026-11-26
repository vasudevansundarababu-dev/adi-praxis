import { optionPlainLabel, optionWhenToChoose } from '@praxis/shared';
import { TEMPLATE_PROFILES, templateStartingGraph, type TemplateProfile, type TemplateProfileField } from '@praxis/shared';

/**
 * Help-bot knowledge for authoring v2.1 (owner, 12 Nov 2026): how authoring, review, approval and policy work, and
 * the decisions behind them, so Authors (SMEs), Experts, PMs and Admins get the same explanation. The per-template
 * guide is generated from the template profiles and starting workflows themselves, so it cannot drift from the
 * product. Sources: docs/authoring/*.md and docs/DECISIONS.md (Authoring v2.1 sections). Keep the prose in step.
 */
export const AUTHORING_GUIDE = `HOW A TASK IS BUILT. Each project uses one workflow template (for example KYC onboarding and refresh, Enhanced due diligence, or Q4 paid search query clustering). A task usually has eight sections: S1 Assignment and brief, S2 Evidence and parties (invented records the agent may read, each with a reference such as E1), S3 Environment and recorded tools, S4 Applicable project policies, S5 Expected work and process, S6 Allowed outcomes and values, S7 Rubric and S8 Check and submit. S5, S6 and S7 are private: authors and reviewers see them; the AI agent and downloads for the agent never do. KYC template version 1 uses six sections, W01 to W06, instead.

CLASSIC AND CHATBOT. The project decides whether authors use Classic (a form per section), Chatbot (a conversation) or Both. They are two views of the same task: switching keeps every keystroke. The Chatbot is a facilitator, not a writer: it places the author's own words into fields and asks the next question the template needs. It never writes case facts, answers, rationales or rubric conditions for you, and nothing changes until the author confirms. Other helpers do suggest wording: "Show an example" and "Check this" under the main Classic fields, suggested text for some fields, and "Draft the steps" in S5, which turns the author's own description into steps. The author decides what stays. Before writing, the author accepts the human-authorship terms for each task.

WORKFLOW GRAPH. Below both editors the task's workflow runs left to right: agent steps, decisions (each also routes "else" and "unknown" to escalation), person steps (a person inside the case, such as an approver; never the ADI Forge review), steps that run alongside each other and join, and correction loops with a limit (when the limit is reached the case escalates). Authors start from the template's workflow and edit it for their case. The status line says whether the workflow passes every check. Private reference material never reaches an agent step.

CHECKS AND SUBMIT. Every save checks the task against its template: required fields, allowed values, evidence references that exist, rubric weights (usually totalling 100) and, where the template asks, at least one critical line. Before submitting, the author presses "Run checks"; Submit is available only when the checks pass, each possible real data item is replaced or explained, and the author ticks that they used no real customer, employer or account information. When a task cannot be turned into the benchmark's format (for example a rubric line names an answer field that does not exist), it still submits, and the reviewer sees why the export is blocked.

TASK STATES. In the console a task is Open (no author yet), Assigned, In progress, Submitted, Rework, Approved or Rejected. The author sees Authoring, Authoring: returned for rework, Review pending: Expert review, Approval pending: PM approval, Approved, or Not accepted. An approved task stays in the dataset as it is. A PM or Admin can still correct it (which approves a new revision and keeps the earlier one) or send it back for rework.

REVIEW ROUTES. The project sets one of two routes when it is created. Author → PM/Admin: the PM or an Admin approves, sends back for rework with comments, or rejects. Author → Reviewer → PM/Admin: a Reviewer (an SME the PM or Admin assigns to the task, never its author) checks first in the SME app and approves it or sends it back; then the PM or Admin approves the exact version the Reviewer passed, sends it back, or rejects it; the PM may reject too. Every decision is tied to the exact submitted version: if the task changes after a pass, that pass no longer counts and the PM cannot approve until the new version is passed. In the earlier flow the first step was done by an Expert, a Validator assigned to the project, in the console; there the same person may be both Expert and PM, and both decisions are recorded separately. Comments are written per section.

EXPERT EDITS AND "MATERIAL" CHANGES. In the earlier flow's console review, an Expert may edit a submitted task, with a recorded reason. This creates a new version and runs the checks again. A material edit sends the task back to the author to confirm before it continues. Any change to the rubric or to the reference answer (KYC rubric and solution; template sections S5 expected work, S6 outcomes and S7 rubric) is always material, whatever the Expert marks (owner, 11 Nov 2026). Minor edits continue to PM approval. In the new flow, the PM or Admin uses "Correct this approved task" for small fixes instead.

GRADING AND CRITICAL CRITERIA. Each rubric line in S7 says what the agent should do, when it applies, how to score it, and its weight. Points are weight × level ÷ 4. Failing a critical criterion fails the whole task, whatever else the agent got right (owner, 12 Nov 2026): it is also sent to RL Gym as a must-pass rule. A line with zero weight is not the same as a critical one.

POLICY: WHAT AUTHORS SEE. Policies belong to the project. Authors, the Chatbot and the agent preview see only published rules that the agent may see and that are in force today. Evaluator-only rules (used to grade) and rules whose effective period has ended are never shown to authors or sent to the AI. Authors link a published rule to a step only if it applies, and say why. They never invent a rule or a limit: if a rule is missing, they ask, or propose the document.

PROPOSING A POLICY DOCUMENT (SMEs). If a task needs a bank or customer policy the project does not have, the SME uses "Propose a policy document" on the task page: they upload an invented or shareable copy (PDF, Word, text or Markdown, up to 10 MB), choose its kind (bank policy, customer policy, regulation or public standard, supporting reference), say why the task needs it, and confirm they may share it. It waits for review. ADI Forge flags, but never rejects, files it cannot read, documents that do not look like a policy (invoices, statements, marketing), possible real personal or account data, and text written to an AI. An Expert assigned to the project, the PM or an Admin accepts, returns or rejects it with a reason the SME sees. Accepting adds it to the project's documents; it becomes rules only after the PM extracts, reviews and publishes them. A file that cannot be read, or that may contain real data, cannot be accepted: it is returned for a readable, synthetic copy. Proposals are never shown to other SMEs, the Chatbot or the agent.

DECIDING POLICY PROPOSALS (Experts, PMs, Admins). Open "Policy documents proposed by SMEs" (from Task reviews, or the "Documents proposed by SMEs" link on the Policies tab). Each shows who proposed it and why, the file, and ADI Forge's flags as advice. Download the original and read ADI Forge's text (with suspected real data blacked out). Choose Accept (as a policy candidate or a supporting reference), Return to the SME, or Reject, with what the document is and a reason. A decision is final.

POLICY SOURCES ON THE REVIEW PAGE (earlier flow). On the console review page, "Policy sources" lists every rule the task is judged against: the copy frozen when the task was submitted, or the project's current published rules if none was frozen. Each shows its quoted source, document, version and page or line. Evaluator-only rules are labelled, rules not in force today are marked, and the steps the SME linked are shown. If the project published newer rules after the task was submitted, the page warns you: decide whether to return the task, check it again, or keep it on the older version.

EXPORT TO RL GYM. An approved task is exported in RL Gym's task format, with its workflow and the project's published rules. The private reference values become the expected answer; the evidence the agent reads never contains private material.

Q4 CLUSTERING IN RL REVIEW (Validators). For Q4 paid search tasks the RL review screen shows "Clustering F1 (ADI Forge)": a score of how closely the agent grouped the queries the way the reference does (whatever names it gave its groups), against a pass bar of 0.99. It is advice for your verdict, not a verdict. If RL Gym did not send the run's results file, the screen says the score is not available.

WHAT AI DOES AND DOES NOT DO. The AI drafts, checks, flags and suggests. People make every decision: accepting, sending back, rejecting and approving tasks, accepting policy proposals, approving policy rules, and benchmark verdicts.`;

/** Owner decisions per template that the generated field list cannot show (docs/authoring/TEMPLATE-PROFILES.md). */
const TEMPLATE_NOTES: Record<string, string> = {
  'adverse-media-review':
    'Rate every media source high, medium, low or unknown with a reason (owner, 12 Nov 2026). An "escalate" recommendation goes to a person step, "Compliance reviewer decides" (Confirm or Dismiss); close and request_information go straight to the output.',
  'enhanced-due-diligence':
    'The overall risk rating (low, medium, high, very high) is graded beside the recommendation; the written risk assessment stays in S5. The business hand-off is required, and the workflow ends with "Approver decides" (Approve or Decline).',
  'customer-risk-rating':
    'Rate each risk factor low, medium or high. There are no weights or formula in ADI Forge: your methodology evidence (S2) decides the overall rating. If you propose an override (increase or decrease), write the override rationale; the workflow sends it to "Senior compliance approver decides" (Approve or Decline). No override goes straight to the output.',
  'q4-global-paid-search-query-clustering':
    'Every query is graded (owner, 12 Nov 2026). List each query once in Query assignments — at most 20 per task; split bigger sets into more tasks. Each query becomes output fields q01_intent, q01_assignment and q01_cluster. RL Gym grades intent and assignment for every query (together half the score; your own rubric criteria share the other half). Cluster names are the agent\'s own, so clustering is scored by ADI Forge as pairwise F1 against your clusters on returned runs, with a pass bar of 0.99. Use "none" as the cluster of an excluded query.',
  'fraud-risk-and-compliance-handoffs':
    'Fraud indicators come from a fixed list (account_takeover, money_mule, synthetic_identity, first_party_fraud, authorised_push_payment_scam, card_fraud, insider_fraud, other) and compliance concerns from another (suspicious_activity_report, sanctions, customer_due_diligence, data_protection, conduct_risk, other); describe each with its evidence, and say what "other" is. The handoff package is the hand-off, so the general business hand-off field is not shown. The workflow ends with "Receiving team accepts handoff" (Accept or Return).',
  'compliance-monitoring':
    'Give each exception its own severity (low, medium, high, critical) with evidence; the overall severity in S6 is the graded one — usually the highest, or as you judge and explain. Use undetermined only when the evidence cannot settle it.',
};

const PRIVATE = new Set(['private_reference', 'private_rubric']);

function fieldLine(f: TemplateProfileField, indent = '  '): string {
  const req = f.required === true ? ' (required)' : f.required ? ' (required in some cases)' : '';
  const vis = f.visibility && PRIVATE.has(f.visibility) ? ' (private: the AI agent never sees it)' : '';
  // D-027: plain labels only (never codes), with when to choose each where known.
  const opts = f.options?.length ? ` — choices: ${f.options.map((o) => { const when = optionWhenToChoose(o.value); return `${optionPlainLabel(o)}${when ? ` (${when})` : ''}`; }).join('; ')}` : '';
  const max = f.maxItems ? ` — at most ${f.maxItems}` : '';
  const sub = f.itemFields?.length ? `\n${f.itemFields.map((x) => fieldLine(x, `${indent}  `)).join('\n')}` : '';
  const ex = f.example ? ` Example from the template: "${f.example}"` : '';
  return `${indent}- ${f.label}${req}${vis}${opts}${max}: ${f.help}${ex}${sub}`;
}

/** A plain-language guide to one template: sections and fields, graded outputs, the starting workflow and decisions. */
export function templateGuide(profile: TemplateProfile): string {
  const graph = templateStartingGraph(profile.catalogWorkflowName, 1, profile.profileId);
  const people = graph?.nodes.filter((n) => n.type === 'human_step').map((n) => `"${n.label}" (${(n as { actorRole?: string }).actorRole ?? 'a person'})`) ?? [];
  const outputs = profile.sections.find((s) => s.key === 'S6')!.fields.filter((f) => f.outputField);
  return [
    `TEMPLATE GUIDE: ${profile.catalogWorkflowName}. The AI works on it as ${profile.agentMode === 'SINGLE' ? 'one agent' : 'several agents'}. The template's fields are ${profile.contractStatus === 'confirmed' ? 'confirmed by the domain owner' : 'still to be confirmed by the domain owner'}.`,
    TEMPLATE_NOTES[profile.profileId] ?? '',
    outputs.length ? `Answers the task is scored on (S6): ${outputs.map((f) => `${f.label} = ${(f.options ?? []).map((o) => optionPlainLabel(o)).join(' / ') || 'free text'}`).join('; ')}.` : '',
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
