// Project manager (console). Sign in with your own PM account (pm.<initials>@praxis.test) in its own browser profile.
const c = (id, title, o) => ({ id, title, persona: 'PM', ...o });

export const CASES = [
  c('TC-PM-001', 'Console home and navigation for a PM', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as PM.',
    steps: ['Read the home dashboard.', 'Note the navigation items.', 'Type /users and /review/applications in the address bar.'],
    expected: ['Home shows counts for projects staffing and in progress.', 'Navigation: Home, Projects, Templates only.', 'Other areas show "This page is for … ; you\'re signed in as PM" with a way back, never a bare 404.'],
    decisions: ['D-PL-05', 'D-PL-04'],
  }),
  c('TC-PM-002', 'Create and submit a project', {
    category: 'FUNC', priority: 'P1', pre: 'A published KYC template.',
    steps: ['Projects → New project.', 'Try to save with no name; then fill: template, name, distinct target 12, max per expert 4, TPT 90, dates (Mon–Fri next two weeks), job description.', 'Submit without a demographic filter.', 'Add a preferred country filter (India) and submit.'],
    expected: ['Validation names each missing field.', 'Submit without a filter: "Add at least one demographic filter".', 'After submit the project shows the number of workers needed (based on working days) and is read-only ("Only draft projects can be edited").'],
    decisions: ['D-M2-02', 'D-M2-03', 'D-M2-04', 'D-M1-01'],
  }),
  c('TC-PM-003', 'Required vs preferred filters change who can be matched', {
    category: 'FUNC', priority: 'P1', pre: 'Two projects: one with a REQUIRED country filter GB, one with a PREFERRED filter GB. An onboarded expert who chose India.',
    steps: ['Staffing → Re-run match on both projects.'],
    expected: ['Required GB: the expert is not listed.', 'Preferred GB: the expert is listed, without the preferred bonus.', 'UX check: does the board explain why someone is missing? (Known gap, D-M3-03: raise as UX if it blocks you.)'],
    decisions: ['D-M2-03', 'D-M3-03', 'D-M3-02'],
  }),
  c('TC-PM-004', 'Opportunity: write, import a document, confirm, publish', {
    category: 'FUNC', priority: 'P1', pre: 'A submitted project.',
    steps: ['Opportunity → import samples/jd-kyc-analyst.pdf.', 'Try to Publish before confirming the extracted text.', 'Review the extracted text, correct a word, Confirm, Publish.', 'Open the candidate app\'s Opportunities page.'],
    expected: ['Publish is refused while the document is pending review.', 'The published page shows your corrected text.'],
    decisions: ['D-M4-03'],
  }),
  c('TC-PM-005', 'Republish to adopt the new question policy', {
    category: 'FUNC', priority: 'P3', pre: 'An opportunity published before 27 Sep 2026 (ask the lead) or any published opportunity.',
    steps: ['Publish the opportunity again.', 'Start a new application as a candidate.'],
    expected: ['New applications get the six-question chat; existing applications keep their original questions.'],
    decisions: ['D-FB-03'],
  }),
  c('TC-PM-006', 'Staffing board: match, assign, proposal states', {
    category: 'FUNC', priority: 'P1', pre: 'Selected and onboarded experts exist.',
    steps: ['Staffing → Re-run match. Read the score breakdown.', 'Assign one expert.', 'Try to assign more experts than places left.'],
    expected: ['Each expert shows score = skills + experience + language + availability (+ preferred).', 'After Assign the expert shows "awaiting reply"; the project is STAFFED only after they accept.', 'Over-assigning is refused with "Only N more worker(s) needed".'],
    decisions: ['D-M3-02', 'D-M4C-02', 'D-M4C-06'],
  }),
  c('TC-PM-007', 'Empty staffing board explains itself', {
    category: 'UX', priority: 'P2', pre: 'A new project with no selected experts.',
    steps: ['Staffing → Re-run match → try "assign top".'],
    expected: ['The message explains experts appear after a reviewer selects them and they finish onboarding, and suggests sourcing.'],
    decisions: ['D-M3-03'],
  }),
  c('TC-PM-008', 'Expert declines, proposal expires', {
    category: 'FUNC', priority: 'P2', pre: 'An assigned expert (proposal awaiting reply).',
    steps: ['Ask the SME tester to Decline with a reason.', 'Re-run match.'],
    expected: ['The place is free again; the decline reason is visible to the PM; the expert can be proposed again.'],
    decisions: ['D-M4C-02', 'D-M4C-10'],
  }),
  c('TC-PM-009', 'Project tasks page and reclaiming a stalled task', {
    category: 'FUNC', priority: 'P2', pre: 'A project in progress with an issued task.',
    steps: ['Project → Tasks. Find a task that is assigned but not submitted.', 'Reclaim it with reason "Stalled".'],
    expected: ['The task leaves the expert\'s list, its draft is cleared, and the slot is free again. The action is audited.'],
    decisions: ['D-M5-03'],
  }),
  c('TC-PM-010', 'Project dashboard: coverage and progress', {
    category: 'FUNC', priority: 'P2', pre: 'A project with accepted tasks.',
    steps: ['Project → Dashboard.'],
    expected: ['Accepted distinct tasks vs target, coverage heatmap by cell and edge case, duplicates, rework counts and time per task are shown and match what you did.'],
    decisions: ['D-M6-02'],
  }),
  c('TC-PM-011', 'A PM cannot read the dataset API or source files', {
    category: 'SEC', priority: 'P1', pre: 'Signed in as PM in the console. A dataset record id and a task source id (ask the lead).',
    steps: ['In the same browser open /api/v1/dataset/records.', 'Open /api/v1/review/tasks/<taskId>/sources/<sourceId>/file.'],
    expected: ['Both are refused (403).'],
    decisions: ['D-M6-02', 'D-M9-02'],
  }),
  c('TC-PM-012', 'Templates: PM can view, not publish', {
    category: 'FUNC', priority: 'P3', pre: 'Signed in as PM.',
    steps: ['Templates → open KYC onboarding and refresh.', 'Look for create, edit, publish or retire controls.'],
    expected: ['The PM can read templates.', 'Creating, editing, publishing and retiring are Admin-only: the PM sees no such controls, or a clear refusal if the action is attempted. A button that is shown but fails is a UX defect.'],
    decisions: ['D-M1-02'],
  }),
];
