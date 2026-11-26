import { describe, expect, it } from 'vitest';
import { rankParagraphs } from '../src/support/assistant';
import { AUTHORING_GUIDE } from '../src/support/authoring-help';
import { BENCHMARK_HELP, PARTNER_HELP, SME_HELP, STAFF_HELP } from '../src/support/help-pack';
import { CANDIDATE_GUIDE, SME_BENCHMARK_HELP, SME_GUIDE } from '../src/support/sme-help';
import { STAFF_CONSOLE_GUIDE } from '../src/support/staff-help';

/**
 * The help-text audit (owner, 26 Nov 2026: "recheck every page help text … make it easy for them"; "use as much as
 * simple english and business english especially in Authoring and Candidate"). Plain words for SMEs, no internal
 * names anywhere, and two real questions per page, per audience, that the offline bot answers from the right paragraph.
 */
const headingsOf = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim().split('. ')[0]!);
const top = (help: string, q: string, n = 2) => rankParagraphs(help, q, n).map((p) => p.split('. ')[0]!.trim());

describe('help text is plain and safe', () => {
  it('never uses the internal names, in any audience', () => {
    for (const [name, text] of Object.entries({ SME_HELP, STAFF_HELP })) expect(text, name).not.toMatch(/Praxis|Anvil|ADI-Labs|praxis\.|anvil\./);
  });

  it('SME help uses no engineering words', () => {
    // Bank words such as ID, account and proof of address are fine; system words are not.
    expect(SME_HELP).not.toMatch(/\b(API|schema|JSON|enum|payload|grader|worker|queue|append-only|sha256|SHA-256|output field|reference output)\b/i);
    expect(SME_HELP).not.toMatch(/\bids?\b/); // lower-case "id" is the system word; "ID" (a document) is the bank word
  });

  it('every SME and staff entry starts with its heading, and the SME help has no staff-only guide', () => {
    for (const text of [SME_GUIDE, SME_BENCHMARK_HELP, CANDIDATE_GUIDE, STAFF_CONSOLE_GUIDE]) for (const h of headingsOf(text)) expect(h, h).toMatch(/^[A-Z0-9][A-Z0-9 ,"'\-–→/&]*( \([^)]*\))?$/);
    expect(SME_HELP).not.toContain(AUTHORING_GUIDE);
    expect(BENCHMARK_HELP).toBe(SME_BENCHMARK_HELP);
  });

  it('the stale statements are gone from the staff help', () => {
    expect(STAFF_HELP).not.toContain('Templates are drafted, then published');
    expect(STAFF_HELP).not.toContain('they use the JSON editor');
    expect(STAFF_HELP).not.toContain('Validate" checks one approved task');
    expect(STAFF_HELP).not.toMatch(/\(Home, Projects, Reviews, Certification, Partners, Payments, Admin\)/);
    expect(STAFF_HELP).toContain('templates are made and changed only in Studio');
  });
});

// Two real questions per page, per audience. The offline bot must rank the right paragraph in its top two.
const SME_QUESTIONS: [string, string, string][] = [
  ['Home', 'What should I do next on my home page?', 'YOUR HOME PAGE'],
  ['Home', 'What does Rework mean on my task list?', 'TASK STATUS ON YOUR HOME PAGE'],
  ['Task page', 'What does Approval pending: PM approval mean?', 'TASK STATUS ON THE TASK PAGE'],
  ['Task page', 'What goes in each of the eight sections?', 'THE EIGHT SECTIONS'],
  ['Task page', 'Does my work save automatically?', 'SAVING YOUR WORK'],
  ['Task page', 'Why can I not paste text into the task?', 'TYPING YOUR OWN WORDS'],
  ['Task page', 'Can I use real customer data?', 'INVENTED DATA ONLY'],
  ['Task page', 'How do I submit my task?', 'CHECK AND SUBMIT'],
  ['Task page', 'What is the rubric and what does critical mean?', 'S7 RUBRIC'],
  ['Task page', 'Which tool do I pick for a procedure step?', 'S5 PROCEDURE STEPS AND TOOLS'],
  ['Task page', 'How do I write a conditional follow-up?', 'CONDITIONAL FOLLOW-UPS (S5)'],
  ['Task page', 'What do Show an example and Check this do?', 'AI HELPERS AND YOUR WORDS'],
  ['Task page', 'Should I use Classic or the Chatbot?', 'CLASSIC AND CHATBOT'],
  ['Task page', 'Where do the bank rules for my task come from?', 'RULES FOR THIS TASK'],
  ['Task page', 'How do I propose a policy document?', 'PROPOSING A POLICY DOCUMENT'],
  ['Task page', 'Can I write my task on my phone?', 'USING A PHONE'],
  ['Benchmark panel', 'When should I pick an edge-case family?', 'FOCUS ON EDGE-CASE FAMILY (optional)'],
  ['Benchmark panel', 'What is archetype and complexity?', 'ARCHETYPE AND COMPLEXITY (S1)'],
  ['Benchmark panel', 'How do I raise a need for a new situation?', 'RAISE A NEED'],
  ['Benchmark panel', 'Can I change the benchmark fields after I submit?', 'SAVE BENCHMARK FIELDS'],
  ['Review page', 'How do I send a task back for rework as a reviewer?', 'REVIEWING A TASK (Reviewer)'],
  ['Review page', 'What happens when I approve a task I reviewed?', 'REVIEWING A TASK (Reviewer)'],
  ['Rework', 'How do I fix rework and resubmit?', 'FIXING REWORK'],
  ['Rework', 'Why did my task come back after the expert changed my rubric?', 'WHEN A REVIEWER CHANGES YOUR TASK'],
  ['Run reviews', 'What verdict do I choose on a run review?', 'RUN REVIEWS'],
  ['Run reviews', 'What does Dispute: the task needs correction do?', 'RUN REVIEWS'],
  ['Edge-case outcomes', 'How do I answer a batch of edge-case outcomes?', 'EDGE-CASE OUTCOMES'],
  ['Edge-case outcomes', 'Why do my edge-case outcome answers matter?', 'EDGE-CASE OUTCOMES'],
  ['Payments', 'When do I get paid?', 'PAYMENTS'],
  ['Payments', 'What happens if a payment fails?', 'PAYMENTS'],
  ['AI unavailable', 'The AI helper says it is unavailable, what do I do?', 'WHEN AN AI HELPER IS UNAVAILABLE'],
  ['Sign in', 'How do I sign in?', 'SIGNING IN'],
  ['Opportunities', 'How do I apply for an opportunity?', 'OPPORTUNITIES AND APPLYING'],
  ['Verify', 'Why do I need to verify my identity?', 'VERIFY YOUR IDENTITY'],
  ['Profile', 'How do I build my SME profile?', 'YOUR SME PROFILE'],
  ['Application status', 'What does More information requested mean on my application?', 'YOUR APPLICATION STATUS'],
  ['Onboarding', 'What is on the onboarding checklist?', 'ONBOARDING'],
  ['Certification', 'How many attempts do I get at the certification test?', 'CERTIFICATION'],
];

const STAFF_QUESTIONS: [string, string, string][] = [
  ['Menu', 'Where is the Reviews menu?', 'MENU'],
  ['Roles', 'What is the difference between a Reviewer and a Validator?', 'ROLES'],
  ['Home', 'What do the tiles on Home mean?', 'HOME'],
  ['Bell', 'What does the bell show?', 'THE BELL'],
  ['Projects list', 'What do the project statuses mean?', 'PROJECTS LIST'],
  ['New project', 'How do I create a new project?', 'CREATING A NEW PROJECT'],
  ['New project', 'What is TPT?', 'CREATING A NEW PROJECT'],
  ['Project page', 'How do I pause or cancel a project?', 'PROJECT PAGE'],
  ['Dashboard', 'What does the Next step banner on the Dashboard mean?', 'DASHBOARD TAB'],
  ['Resource assignments', 'Who is on the Resource assignments tab?', 'RESOURCE ASSIGNMENTS TAB'],
  ['Assign', 'How do I assign a Reviewer to a task?', 'ASSIGNING PEOPLE'],
  ['Tasks tab', 'What does Open mean on the Tasks tab?', 'TASKS TAB'],
  ['Export', 'When can I export to RL Gym?', 'VALIDATE AND EXPORT (Tasks tab)'],
  ['Export', 'What does Validate do?', 'VALIDATE AND EXPORT (Tasks tab)'],
  ['Task page', 'Why can I not decide on this task?', 'THE TASK PAGE'],
  ['Task page', 'What does the approve checklist need?', 'DECIDING ON A TASK'],
  ['Task page', 'How do I correct an approved task myself?', 'CORRECTING AN APPROVED TASK'],
  ['Task page', 'How do I send an approved task back to the author?', 'SENDING AN APPROVED TASK BACK'],
  ['Benchmark tab', 'What are held tasks?', 'BENCHMARK TAB'],
  ['Benchmark tab', 'How do I send edge-case outcomes to an SME?', 'EDGE-CASE OUTCOMES (Benchmark tab)'],
  ['Benchmark tab', 'What do I do with SME needs?', 'SME NEEDS (Benchmark tab)'],
  ['Benchmark tab', 'Who decides the benchmark review episodes?', 'BENCHMARK REVIEW (Benchmark tab)'],
  ['Policies tab', 'How do I publish the rule set?', 'POLICIES TAB (other projects)'],
  ['Rules search', 'Why does the rule search not find my typo?', 'SEARCHING RULES'],
  ['Policy proposals', 'Where do I decide policy documents proposed by SMEs?', 'DECIDING POLICY PROPOSALS (Experts, PMs, Admins)'],
  ['Policy page', 'What is a fact', 'WHAT IS A FACT'],
  ['Policy page', 'what does Set when it applies mean', 'NEXT ACTION "SET WHEN IT APPLIES"'],
  ['Templates', 'How do I change a template?', 'TEMPLATES'],
  ['Templates', 'What does Retire do on a template?', 'TEMPLATES'],
  ['Users', 'How do I reset a user password?', 'USERS (Admin)'],
  ['Candidate sign-in', 'What does Offline sign-in mean for the candidate app?', 'CANDIDATE APP SIGN-IN (Admin)'],
  ['Approved exports', 'What is on Approved exports?', 'APPROVED EXPORTS (Admin)'],
  ['Review routes', 'Can the PM reject a task?', 'REVIEW ROUTES'],
  ['Earlier flow', 'How do I decide an application?', 'APPLICATIONS (earlier flow, Validator)'],
];

describe('the offline bot answers two real questions per page from the right paragraph', () => {
  it.each(SME_QUESTIONS)('SME · %s: %s', (_page, q, heading) => expect(top(SME_HELP, q)).toContain(heading));
  it.each(STAFF_QUESTIONS)('Staff · %s: %s', (_page, q, heading) => expect(top(STAFF_HELP, q)).toContain(heading));
});
