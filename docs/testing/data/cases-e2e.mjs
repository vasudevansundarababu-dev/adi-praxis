// End-to-end journeys across personas. Run these first each cycle: they prove the whole product works together.
const c = (id, title, o) => ({ id, title, persona: 'Several', category: 'E2E', ...o });

export const CASES = [
  c('TC-E2E-001', 'Full journey: a new expert is recruited, onboarded, drafts a KYC task from an interview, and it is accepted into the dataset', {
    priority: 'P1',
    pre: 'Three browser profiles (see README "Several roles at once"): PM, Reviewer, SME. The Reviewer is assigned to your project. Your project is published, STAFFING, and has a free place.',
    steps: [
      'SME: open the candidate app, sign in with the mock form as sme.<you>.e2e1@example.test, tick 18+, continue.',
      'SME: Verify identity → Start verification → on the simulated page choose "Verified (18 or over)".',
      'SME: Opportunities → your project → "Apply: build my SME profile". Answer the six questions (tap chips where offered). Review and submit.',
      'Reviewer: Applications → the new application. Read the AI recommendation and reasons. Choose "Select for this pool", write a reason and a message, keep the approved scope, Record decision.',
      'SME: open the application status page → Start onboarding. Complete all 7 steps. In Work preferences choose India and Asia/Kolkata.',
      'PM: Projects → your project → Staffing → Re-run match. Find the SME and click Assign.',
      'SME: Home → the assignment card → Accept → Open workbench. Open the first task.',
      'SME: W00 → "Answer a short interview". Answer all 8 questions. → "Draft my task". Wait for the draft (about 1 minute with the real AI).',
      'SME: visit W01–W05. Read each section, fix anything unrealistic, click "I\'ve checked this section" on each.',
      'SME: W06 → Run checks → tick the synthetic-data declaration → Submit for review.',
      'Reviewer: Task reviews → the task. Read "How this task was made", the checks and similar tasks. Answer the checklist. Accept.',
      'Admin (optional): call GET /api/v1/dataset/records?projectId=<id> and GET /api/v1/dataset/verification.',
    ],
    expected: [
      'Every step succeeds without an error page or a console error.',
      'The SME always sees where they are on the journey (Profile → Review → Onboarding → Tasks) and what to do next.',
      'The draft fills W01–W05 with invented names and SYN- identifiers, contains the slot\'s edge case, and passes the automated checks once confirmed.',
      'After Accept, exactly one dataset record exists for the task, with provenance "drafted: true", and chain verification reports no breaks.',
      'Total SME time from sign-in to submitted task: note it in the run log (target under 45 minutes).',
    ],
    decisions: ['D-M4-01', 'D-M4-02', 'D-FB-01', 'D-M4C-05', 'D-M4C-06', 'D-M9-01', 'D-M9-03', 'D-M9-05', 'D-M5-09', 'D-M9-14'],
  }),
  c('TC-E2E-002', 'Full journey from a document: an expert drafts a task from their own procedure notes', {
    priority: 'P1',
    pre: 'An onboarded SME with an accepted assignment and an untouched KYC task. Sample file docs/testing/samples/kyc-procedure-notes.txt.',
    steps: [
      'SME: open the task (it opens on W00) → "Start from a document".',
      'Choose the sample file, tick the declaration, Upload.',
      'Draft my task. Wait for "Writing your draft…" to finish; the page reloads.',
      'Check and confirm W01–W05, then submit from W06.',
      'Reviewer: open the task, open the source file from "How this task was made", accept or request rework.',
    ],
    expected: [
      'The upload shows the file name, size and "characters read"; no warning (the sample has no real identifiers).',
      'The draft reflects the procedure (ownership over 25%, escalation of high risk) but with invented parties.',
      'The Reviewer can download the same file; the PM cannot (see TC-SEC-012).',
    ],
    decisions: ['D-M9-01', 'D-M9-02', 'D-M9-04', 'D-M9-05'],
  }),
  c('TC-E2E-003', 'Rework loop: the Reviewer asks for changes, the expert fixes them, the Reviewer sees what changed', {
    priority: 'P1',
    pre: 'A submitted KYC task.',
    steps: [
      'Reviewer: open the task → decision "Request rework". Add a comment pinned to W04 ("The near match must be cleared on date of birth") and a note. Submit.',
      'SME: open the task. Read the reviewer\'s message on W01, follow the link to W04, change the step, resubmit from W06.',
      'Reviewer: open the task again.',
    ],
    expected: [
      'The SME sees the comment on W01 and pinned on W04; the task is editable again (status "Changes requested").',
      'On resubmit, the Reviewer sees "Resubmitted after rework. Changed since the last version: W04 …" and the version number increased.',
    ],
    decisions: ['D-M5-12'],
  }),
  c('TC-E2E-004', 'Not selected, then asks for a review of the decision', {
    priority: 'P2',
    pre: 'A submitted application.',
    steps: [
      'Reviewer: choose "Not selected for this pool" with a task-related reason and a respectful message.',
      'SME: open the status page. Read the message. Use the option to request a review of the decision, with a short explanation.',
      'Reviewer: Applications → the application now shows as review requested → Reopen for decision → Select.',
    ],
    expected: [
      'The SME\'s message is respectful and specific; it never judges the person.',
      'The earlier decision stays on record in the decision history; the new decision is added, not overwritten.',
    ],
    decisions: ['D-M4C-05', 'D-M6-01'],
  }),
  c('TC-E2E-005', 'RL review loop: RL Gym sends a result, a Reviewer judges it, RL Gym pulls the verdict', {
    priority: 'P1',
    pre: 'At least one accepted task (its dataset record id). An RL Gym API key from Admin → API clients. A tool that sends HTTP requests (curl or Postman).',
    steps: [
      'RL Gym: POST /api/v1/integrations/rl-gym/review-requests with the sample body in docs/testing/samples/rl-review-request.json (put your record id in source_record_ids).',
      'Reviewer: RL reviews → open the request → Claim. For each metric choose agree/disagree (comment where you disagree). Choose FAIL with a comment pinned to a trajectory step and a failure code. Submit.',
      'RL Gym: GET /api/v1/integrations/rl-gym/results.',
    ],
    expected: [
      'The request appears in the RL reviews queue of Reviewers assigned to that project.',
      'The verdict is returned with the metric verdicts and comments; a second GET with ?after=<seq> returns nothing new.',
    ],
    decisions: ['D-M7-01', 'D-M7-02', 'D-M7-03'],
  }),
  c('TC-E2E-006', 'A new project from scratch: template → project → opportunity → staffing', {
    priority: 'P2',
    pre: 'Admin and PM accounts.',
    steps: [
      'Admin: Templates → check "KYC onboarding and refresh" is published (or publish a new version).',
      'PM: Projects → New project. Choose the template, name it "<you> KYC <date>", distinct target 6, max per expert 3, TPT 90, dates next week, add a preferred country filter (IN). Save, then Submit.',
      'PM: Opportunity → paste a short brief (or import a PDF), confirm it, Publish.',
      'Admin or PM: assign a Reviewer to the project.',
      'PM: Staffing → Re-run match.',
    ],
    expected: [
      'Submit shows the calculated number of workers needed.',
      'The opportunity appears on the candidate app\'s Opportunities page.',
      'Selected and onboarded experts appear on the staffing board with scores.',
    ],
    decisions: ['D-M1-01', 'D-M2-02', 'D-M2-03', 'D-M4-03', 'D-M4C-04'],
  }),
  c('TC-E2E-007', 'Nightly cycle: a defect you reported is fixed and you verify it', {
    priority: 'P2',
    pre: 'An issue you reported was triaged with the agent:ready label.',
    steps: [
      'Next morning (IST), open your issue on GitHub. Read the agent\'s comment and the linked pull request.',
      'When the issue says "The fix is in build …", check the banner on the test environment shows that build.',
      'Retest. Comment /verified if it works, or /failed and what you saw.',
    ],
    expected: [
      '/verified closes the issue with status:verified; /failed reopens it with status:reopened.',
    ],
    decisions: ['D-PR-01', 'D-PR-02', 'D-PL-09'],
  }),
];
