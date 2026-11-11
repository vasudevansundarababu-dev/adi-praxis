/**
 * Support Bot help pack (docs/SUPPORT-BOT.md): the business process behind each console and partner-portal area, in
 * plain language. Source: docs/SPEC.md, docs/FLOW2-SME.md, docs/TASK-KYC.md, docs/SME-SUPPLY.md and docs/DECISIONS.md.
 * Keep it in step with those documents when behaviour changes. Paragraphs are separated by blank lines.
 */
import { AUTHORING_GUIDE } from './authoring-help';

export const HELP_VERSION = 'help/2.1 (12 Nov 2026: authoring v2.1, review routes, policy proposals, template guides, generated job descriptions)';

const COMMON = `ADI Praxis is where subject-matter experts (SMEs) write and review realistic, fully synthetic work tasks from domain workflow templates (for example Banking / KYC onboarding). Approved tasks go into an append-only Approved Task Dataset that the separate RL Gym platform uses. People make every decision — selection, task acceptance, certification, payment approval. AI only drafts, checks and recommends.

Required fields are marked with a red asterisk (*). A form cannot be saved until they are filled in. Every change is recorded in the audit log with who made it and when.

All task content is synthetic: invented people, companies and identifiers only. Never enter real customer, employer or identity data. Identity images and ID numbers are never stored in Praxis.`;

export const STAFF_HELP = `${COMMON}

ROLES. Admin alone is sufficient for Praxis project creation, preparation, staffing, task acceptance, exports, certification and payment workflow actions. No separate PM, Validator or Finance sign-off is needed. Legacy roles remain for compatibility and audit history. Admin cannot remove their own Admin role. Candidate and partner accounts remain separate.

MENU. The top row has groups (Home, Projects, Reviews, Certification, Partners, Payments, Admin). Choosing a group shows its pages on the second row. You only see the pages your role can use.

TEMPLATES (Admin, PM). A template describes a domain workflow: domain, workflow name, primary work, verification criteria, the human gate, default time per task (TPT, minutes), skills and task modes (Authoring, Annotation, RL review). Templates are drafted, then published; projects can only use published templates. Changing a template later does not change projects already submitted — they keep a snapshot.

SEARCH. Every main list (Projects, Templates, Applications/candidates, Requisitions, Users, Partners) has a search bar above the table. Type a few letters of a name and the table narrows as you type (small typos are fine); the best matches appear as links you can open with the arrow keys and Enter. From 4 characters it also matches by meaning, so \"sanctions screening expert\" finds related candidates even without those exact words. You only ever find records you can already see in that list. Names and emails are matched by letters only and are never sent to the AI model.

PROJECTS — FLOW 1 (Admin). 1) The job description is generated from the template when you create the project: the template's skills are mandatory (you can add skills but not remove them), and the demographic profile, minimum education and years of experience come from the Demographics step (defaults: 5 years, Bachelor's or equivalent). You set the title, responsibilities, pay per task and location; submit is blocked until pay is set. If the review route is SME -> Expert -> PM, a reviewer job description is generated too: same skills, demographics and education, 5 more years of experience. Both are frozen at submit and drive recruitment: the job post's required criteria, and "Fill from project JD" on a requisition (the reviewer JD for Expert and Reviewer-SME tiers). You can still pick or write your own JD instead, but it must include the template's skills. Reviewers get their own public job post: on the project's Opportunity page, open the \"Expert reviewers\" tab, check the post (built from the reviewer JD) and publish it. Applicants go through the usual candidate review; when one is selected and their identity is verified, click \"Make Expert\" to make them the project's Expert. An Admin creates their Validator account (a PM can assign someone who already has one). 2) Create the project: pick a published template, name it, set the distinct-task target (how many distinct approved tasks you need), the maximum tasks per expert, TPT, start and end dates, the job description, and optional demographic filters (for example country IN or GB; "required" filters exclude people who do not match, preferred ones only rank). 3) Submit the project: it snapshots the template, JD and filters. 4) Run matching to rank available candidates. 5) Publish the opportunity so candidates can apply. 6) Assign candidates; when enough are assigned the project becomes STAFFED and tasks are issued. The campaign closes automatically when the project is staffed.

APPLICATIONS — FLOW 2 (Validator). Candidates sign in with Google, verify identity (Stripe Identity), build a profile with the profile assistant, and apply to an opportunity. A Validator reads the confirmed profile against the published criteria and decides Selected, Not selected or Needs information, with reasons and a message to the candidate. The AI suitability assessment is a recommendation only. Selected candidates complete the onboarding checklist (C07): confirm scope, accept terms, declare conflicts, read guidance, set preferences — and, for SME-supply requisitions, pass the certification and set up payment, which complete automatically.

IDENTITY REVIEWS AND CONFLICTS (Validator). Identity reviews handle people who cannot use the automated check (approved alternative process — never labelled "Stripe verified"). Conflicts are declared employer or customer conflicts to resolve before assignment.

TASKS — FLOW 3. Assigned SMEs author tasks from the project's template in Classic, Chatbot or both (the project decides), with the workflow graph below; they can also draft from an uploaded document or an interview, autosave, and submit. Automatic checks flag likely real identifiers and near-duplicates. Review follows the project's route (see REVIEW ROUTES below): on SME → PM a Validator or Admin accepts, requests rework with specific notes, or rejects with a reason code; on SME → Expert → PM the Expert passes first and the PM approves. Accepted tasks are written to the append-only Approved Task Dataset and cannot be changed.

RL REVIEWS — FLOW 4 (Validator). RL Gym sends agent runs for review. The Validator claims one, gives a PASS or FAIL verdict per metric with comments (every FAIL and every disagreement needs a comment and a reason code), and submits. The verdict becomes an append-only RL review record delivered to RL Gym.

SME SUPPLY — REQUISITIONS (PM, Admin). A requisition asks partners (and optionally the public careers page) for people: project, domain, tier (Annotator, Reviewer, Expert), headcount, start date, duration, hours per week, location, jurisdictions, languages, minimum requirements (years, qualifications, licence required), allowed partners, direct channel on/off, submission deadline, maximum per partner, and the pay route. Pay route DIRECT means Praxis pays the SME (payment set-up is on their checklist); VIA_PARTNER means the partner pays its own people. The project needs its SME-supply switch on. States: Draft → Open → Paused → Filled → Closed. Link a guidelines package (for the course and certification) and a rate card (for direct pay). Submissions show the automatic requirement screen; only a Validator can confirm "not met".

PARTNERS (Admin). Onboard a partner with its business verification, allowed domains and tiers, contacts and fee terms (fee per certified candidate, currency, terms version). Add partner portal users. Partners manage their own API clients and webhooks in the portal. Ownership: the first valid submission owns a person for 12 months; after it ends a 90-day cool-off applies. Duplicate messages never name the owning partner.

GUIDELINES AND CERTIFICATION (Admin, Validator). Upload a guidelines version (PDF, DOCX, Markdown or text, up to 10 MB) to a package (domain + task family). Generation runs in the background: knowledge map, then per tier a course, a blueprint and item families, all citing guideline sections. Review and approve: edit or reject knowledge items; approve each tier's course; check the blueprint (item count, time limit, pass rules, competency weights totalling 100) and approve it; approve every item family after checking its samples — each sample shows its derived answer and the four checks (answer rule, independent solve, citation supports it, difficulty in band). Families that fail repeatedly are flagged and must be edited before approval. One Admin decision is sufficient for every tier, including Expert. Then publish the tier. Published tiers cannot be edited; upload a new version instead. Tier defaults: Annotator 25 questions, 40 minutes, 80%; Reviewer 35 questions, 60 minutes, 85% and 80% of planted errors found; Expert 20 questions plus an authoring task, 120 minutes, 85%, and it needs a Reviewer certificate in the domain.

CERTIFICATION REVIEWS (Validator, Admin). Written answers show the model's score as a recommendation only — you decide the score from 0 to 1. One Admin grade finalizes written answers, including Expert authoring tasks and pending legacy confirmations. After a third failed attempt a certification comes to review: certify, not certified, or allow another retake, with a reason. Healthcare Experts upload a licence (number, issuing body, certificate) for a Validator to confirm before certification.

PAYMENTS (Finance, PM, Admin). Rate cards are versioned (USD or INR, a price per task type); a new version never changes past earnings. Each accepted task on a direct-pay requisition earns exactly one ledger entry at the linked rate card price. Earnings can never be edited or deleted; Finance corrects with a reversal. Pay runs are weekly (Monday to Sunday, built on Mondays): one payment per SME and currency. Held (not paid, reported): payee not ready, account suspended, a dispute or fraud hold, suspended standing. Balances under USD 10 or INR 500 carry forward. Admin steps: build → release → submit explicitly to the payout provider. Release replaces PM/Finance sign-offs, is audited, sends no money, and cannot be done by a recipient in that run. Legacy Finance routes remain compatible. Provider updates mark payments Paid, Failed or Returned; failed and returned money is owed again next run. Daily reconciliation lists every mismatch with the provider's report as a payout exception for Finance to resolve with a note. Partner fees: one entry per certified candidate at the partner's fee terms; monthly statements are shown to the partner; payment happens outside Praxis.

ADMIN. Users: invite staff, set roles, disable access. Taxonomy: domains and skills. Terms: publish contributor, confidentiality/IP and data-use terms (placeholder terms block onboarding in production). Failure codes: reason codes for RL reviews. API clients: machine access keys (for example RL Gym).

${AUTHORING_GUIDE}`;

export const PARTNER_HELP = `${COMMON}

THE PARTNER PORTAL. You supply candidates for requisitions ADI Praxis opens to you. You track their progress, but you never act for candidates: they sign in, verify their identity, train and take their certification themselves.

REQUISITIONS. Each requisition shows the domain, tier (Annotator, Reviewer or Expert), headcount, dates, hours, location, languages and minimum requirements, plus a guidelines summary and the course outline once published. Train your candidates on the guidelines summary before you submit them. Pay route: "Direct" means ADI Praxis pays the SME; "Via partner" means you pay your people.

SUBMIT A CANDIDATE. Required: full name, email (the invite goes there), country (two-letter code such as IN), years of experience, an experience summary, and both confirmations — that you trained them on the guidelines summary, and that they agreed to be put forward and contacted. Optional: your own reference, phone, qualifications, languages, employment history. Do not include ID numbers or customer data. Submissions from the portal are live: the candidate is emailed an invite at once (it lasts 7 days, with a reminder on day 3).

DUPLICATES AND OWNERSHIP. The first valid submission of a person owns them for 12 months while it is active. If someone is already registered, your submission is refused without naming who owns them. When ownership ends, a 90-day cool-off applies. You can put the same person forward for other requisitions you own them for.

CANDIDATE TRACKER. Each candidate shows their states: submission, requirement screen, identity, selection, certification and standing, with a history. Only an ADI Praxis Validator can confirm "not met". Selection is always a person's decision. You may withdraw a candidate you submitted (the cool-off then applies).

CERTIFICATION. After selection, candidates complete a course and a timed certification test for their tier, with a selfie check each attempt. A failed test can be retaken after 48 hours; after three attempts a person decides. You see progress states, never questions or answers.

STATEMENTS. You owe a fee for each certified candidate you supplied, at your agreed fee terms. Statements are issued monthly with one line per certified candidate (your candidate id and your reference). Payment happens outside the portal; contact ADI Praxis about any line.

API AND WEBHOOKS. Create API clients per environment: Sandbox (simulated candidates, nothing emailed) or Live. The client secret is shown once — store it safely; rotate it if exposed. Webhooks send signed events (header Praxis-Signature with a timestamp and HMAC) for every state change; the signing secret is shown once. Deliveries retry for about 8 attempts and can be replayed. Call the Partner API on the API host (path /partner/v1), not the portal address.`;


/** SMEs (authors) in the candidate app: how to author, what happens in review, and policy. */
export const SME_HELP = `ADI Praxis is where subject-matter experts like you write realistic, fully synthetic work tasks from a project's workflow template. Approved tasks go into an append-only dataset used to train and test AI agents. People make every decision about your task — the Expert, the PM or an Admin. AI only organises your words, checks and recommends; it never writes your answers.

All task content must be synthetic: invented people, companies, accounts and identifiers only. Never enter real customer, employer or identity data. Praxis flags possible real data (for example a valid IBAN or card number) and blocks it.

YOUR TASKS. Your home page lists your projects and tasks. Open a task to author it. It autosaves; reopening keeps everything. When the checks pass, submit it. You can see its state at the top: Authoring, Review pending or Approval pending, Approved, or Rejected. If it comes back for rework you see the reviewer's comments, pinned to the section, field or workflow step they concern; fix them and resubmit. If an Expert made a material change (anything in the rubric or the reference answer), the task comes back for you to reconfirm.

PAYMENT. You earn once per accepted task, at the project's rate; rework and resubmission do not create a second earning.

${AUTHORING_GUIDE}`;
