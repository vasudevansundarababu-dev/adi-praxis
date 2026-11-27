/**
 * Support Bot help pack (docs/SUPPORT-BOT.md): the business process behind each console and partner-portal area, in
 * plain language. Source: docs/SPEC.md, docs/FLOW2-SME.md, docs/TASK-KYC.md, docs/SME-SUPPLY.md and docs/DECISIONS.md.
 * Keep it in step with those documents when behaviour changes. Paragraphs are separated by blank lines.
 */
import { POLICY_PAGE_HELP, tutorialsEnabled, withoutTutorials } from '@praxis/shared';
import { AUTHORING_GUIDE } from './authoring-help';
import { CANDIDATE_GUIDE, SME_BENCHMARK_HELP, SME_GUIDE } from './sme-help';
import { STAFF_CONSOLE_GUIDE } from './staff-help';

export const HELP_VERSION = 'help/3.2 (27 Nov 2026: "To fix" and "Next problem" on the rule page) · help/3.1 (27 Nov 2026: Tutorials left out while TUTORIALS_ENABLED is off) · help/3.0 (27 Nov 2026: every console and SME app page rechecked against the code and rewritten in plain business English; SME help separate from staff help; current-flow console guide; earlier-flow areas labelled) · help/2.3 (26 Nov 2026: the Policy page, its checklist, facts and conditions, next actions, export) · help/2.2 (23 Nov 2026: Benchmark panel, procedure tool guide and follow-ups, AI unavailable) · help/2.1 (12 Nov 2026: authoring v2.1, review routes, policy proposals, template guides, generated job descriptions, KYC template v2, golden task packs)';

const COMMON = `ADI FORGE. ADI Forge is where subject-matter experts (SMEs) write and check realistic work tasks from a workflow template, such as KYC onboarding. Every task uses invented data only. Approved tasks go into a dataset that is only ever added to, never changed, and RL Gym (the separate benchmark platform) uses it to test AI agents. People make every decision: who is selected, which tasks are accepted, and who is paid. The AI only drafts, checks and suggests.

REQUIRED FIELDS. Required fields have a red asterisk (*). You cannot save a form until they are filled in. Every change is recorded in the audit log, with who made it and when.

INVENTED DATA ONLY. All task content is invented: made-up people, companies and numbers. Never enter real customer, employer or identity details. ADI Forge never stores identity images or ID numbers.`;

const STAFF_HELP_ALL = `${COMMON}

${STAFF_CONSOLE_GUIDE}

EARLIER FLOW AND HIDDEN AREAS. The paragraphs below describe pages from the earlier flow (applications, selection, requisitions) and areas that are hidden from the menu (certification, partners, payments). With the new flow on, PMs and Admins do not see them in the menu; Validators who are not PMs or Admins still use the Reviews pages. If someone asks about one of these, say it is part of the earlier flow or hidden today.

KYC TEMPLATE VERSIONS. The KYC template has two versions. Version 1 uses the KYC workbench (six sections, W01 to W06). Version 2 uses the account-opening form, which follows the Golden Bank KYC reference that RL Gym uses as a benchmark: product and state, parties and their roles (owner, parent, guardian, custodian, beneficiary), recorded tool responses, up to 3 follow-up rounds, a per-party assessment, one of four recommendations (ready for approval, request information, specialist review, not eligible for the requested product) and a rubric of 5-point checks (5 correct, 2 partly right, 0 wrong). Projects keep the template version they were created from. Rules must be cited by the exact published version: publish the project's rules before authors cite them.

GOLDEN TASK PACKS (Admin). A golden task pack is a file with a new authoring form and its worked cases. Admins upload it on the "Authoring forms and golden packs" page; ADI Forge checks the pack and stores nothing until every problem is fixed. Form names are never reused: upload a changed form under a new name. The template page shows which form each version uses; it cannot be changed in ADI Forge.

RL GYM TEMPLATES. RL Gym and Studio propose new templates and changes. Each release arrives as a template version that an Admin publishes; nothing goes live automatically. RL Gym then qualifies the published version for benchmarks, and the template page shows "RL Gym-ready for benchmarks", or that RL Gym revoked its qualification.

SEARCH. The main lists (Projects, Templates, Users and the earlier-flow lists) have a search bar above the table. Type a few letters of a name and the table narrows as you type; small typos are fine. From 4 characters it also matches by meaning, so "sanctions screening expert" finds related candidates without those exact words. You only find records you can already see. Names and emails are matched by letters only and are never sent to the AI. The policy rule searches work differently (see SEARCHING RULES).

PROJECTS IN THE EARLIER FLOW. In the earlier flow, after a project is submitted you run matching to rank candidates, publish the opportunity so candidates can apply, and assign selected candidates; when enough are assigned the project is Staffed and tasks are issued. Reviewers were Validators made "Expert" on the project. With the new flow on, you assign SMEs and Reviewers directly on the Assign screen instead.

APPLICATIONS (earlier flow, Validator). Candidates sign in, verify their identity, build a profile and apply. A Validator reads the profile against the published criteria and decides Selected, Not selected or Needs information, with reasons and a message to the candidate. The AI suitability assessment is a suggestion only. Selected candidates complete the onboarding checklist.

IDENTITY REVIEWS AND CONFLICTS (earlier flow, Validator). Identity reviews handle people who cannot use the automatic identity check (an approved alternative process, never labelled as automatically verified). Conflicts are declared employer or customer conflicts to resolve before a person can be assigned.

TASK REVIEWS IN THE EARLIER FLOW (Validator). On Task reviews, a Validator or Admin accepts a submitted task, asks for rework with notes, or rejects it with a reason. On the two-step route the Expert passes it first, then the PM approves the exact version passed. Likely duplicates and possible real data come first in the list.

RL REVIEWS (earlier flow, Validator). RL Gym sends agent runs for review. The Validator claims one, gives a pass or fail verdict per measure with comments (every fail and every disagreement needs a comment and a reason code), and submits. The verdict is recorded for good and sent to RL Gym. In the new flow this is the Benchmark review on the project's Benchmark tab.

SME SUPPLY, PARTNERS, CERTIFICATION AND PAYMENTS (hidden today). These areas exist but are hidden from the menu. Requisitions ask staffing partners for people; partners supply candidates; guidelines become a course and a certification test per tier (Annotator, Reviewer, Expert); and SMEs paid directly are paid weekly from rate cards, with every payment released and submitted by an Admin. A Validator decides written answers and certification reviews; the AI score is a suggestion only. Ask an Admin if you need one of these areas.

ADMIN PAGES. Admin has Users, Taxonomy (domains and skills), Terms (contributor, confidentiality and data-use terms), Failure codes (reason codes for reviews), API clients (access keys for connected systems such as RL Gym) and Candidate app sign-in.

${AUTHORING_GUIDE}

${POLICY_PAGE_HELP}`;

export const PARTNER_HELP = `${COMMON}

THE PARTNER PORTAL. You supply candidates for requisitions ADI Forge opens to you. You track their progress, but you never act for candidates: they sign in, verify their identity, train and take their certification themselves.

REQUISITIONS. Each requisition shows the domain, tier (Annotator, Reviewer or Expert), headcount, dates, hours, location, languages and minimum requirements, plus a guidelines summary and the course outline once published. Train your candidates on the guidelines summary before you submit them. Pay route: "Direct" means ADI Forge pays the SME; "Via partner" means you pay your people.

SUBMIT A CANDIDATE. Required: full name, email (the invite goes there), country (two-letter code such as IN), years of experience, an experience summary, and both confirmations — that you trained them on the guidelines summary, and that they agreed to be put forward and contacted. Optional: your own reference, phone, qualifications, languages, employment history. Do not include ID numbers or customer data. Submissions from the portal are live: the candidate is emailed an invite at once (it lasts 7 days, with a reminder on day 3).

DUPLICATES AND OWNERSHIP. The first valid submission of a person owns them for 12 months while it is active. If someone is already registered, your submission is refused without naming who owns them. When ownership ends, a 90-day cool-off applies. You can put the same person forward for other requisitions you own them for.

CANDIDATE TRACKER. Each candidate shows their states: submission, requirement screen, identity, selection, certification and standing, with a history. Only an ADI Forge Validator can confirm "not met". Selection is always a person's decision. You may withdraw a candidate you submitted (the cool-off then applies).

CERTIFICATION. After selection, candidates complete a course and a timed certification test for their tier, with a selfie check each attempt. A failed test can be retaken after 48 hours; after three attempts a person decides. You see progress states, never questions or answers.

STATEMENTS. You owe a fee for each certified candidate you supplied, at your agreed fee terms. Statements are issued monthly with one line per certified candidate (your candidate id and your reference). Payment happens outside the portal; contact ADI Forge about any line.

API AND WEBHOOKS. Create API clients per environment: Sandbox (simulated candidates, nothing emailed) or Live. The client secret is shown once — store it safely; rotate it if exposed. Webhooks send signed events (header Praxis-Signature with a timestamp and HMAC) for every state change; the signing secret is shown once. Deliveries retry for about 8 attempts and can be replayed. Call the Partner API on the API host (path /partner/v1), not the portal address.`;


/** SMEs (authors) in the candidate app: how to author, what happens in review, and policy. */
/**
 * D-020 (owner, 23 Nov 2026): plain-English Help for the task's Benchmark panel, the procedure's tool guide and
 * follow-ups, and what to do when an AI helper is unavailable. Written for the author: what it is and what to do.
 */
export const BENCHMARK_HELP = SME_BENCHMARK_HELP;

const SME_HELP_ALL = `ADI FORGE. ADI Forge is where bankers and other experts like you write realistic work cases ("tasks") from a project's template. Each task is used to test AI agents on real-world work. People make every decision about your task: your reviewer, the project manager or an admin. The AI helpers only suggest and check; you write the task.

${SME_GUIDE}

${BENCHMARK_HELP}

${CANDIDATE_GUIDE}`;

/** Owner, 27 Nov 2026: with TUTORIALS_ENABLED off the help never points people to the Tutorials page. */
const gate = (text: string) => (tutorialsEnabled() ? text : withoutTutorials(text));
export const STAFF_HELP = gate(STAFF_HELP_ALL);
export const SME_HELP = gate(SME_HELP_ALL);
