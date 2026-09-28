// Project manager (console). Sign in with your own PM account (pm.<initials>@praxis.test) in its own browser profile.
const c = (id, title, o) => ({ id, title, persona: 'PM', ...o });

export const CASES = [
  c('TC-PM-001', 'Console home and navigation for a PM', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as PM.',
    steps: ['Read the home dashboard.', 'Note the navigation items.', 'Type /users and /review/applications in the address bar.'],
    expected: ['Home shows counts for projects staffing and in progress.', 'Menu (Release 1.1, two levels): top row Home, Projects, Payments; the Projects group\'s second row shows Projects, Templates, Requisitions (see TC-PM-013).', 'Other areas show "This page is for … ; you\'re signed in as PM" with a way back, never a bare 404.'],
    decisions: ['D-PL-05', 'D-PL-04', 'D-UI-03'],
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
  // ── Release 1.1: requisitions, pay route, rate cards, pay-run confirmation, menu ──
  c('TC-PM-013', 'PM menu after Release 1.1', {
    category: 'UX', priority: 'P1', pre: 'Signed in as PM.',
    steps: ['Read the top row of the menu; click Projects and read the second row; click Payments and read the tabs.', 'Type /partners, /guidelines, /payments/earnings and /users in the address bar.'],
    expected: ['Top row: Home, Projects, Payments. Projects second row: Projects, Templates, Requisitions. Payments tabs: Pay runs and Rate cards only.', 'Each refused page shows "This page is for …; you are signed in as PM" with a way back.'],
    decisions: ['D-PL-05', 'D-UI-03'],
  }),
  c('TC-PM-014', 'Create a requisition: SME supply switch, required fields, channels and pay route', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as a PM who owns a published project (the demo PM owns "KYC authoring demo"; your own project also works).',
    steps: ['Projects → Requisitions → New requisition. Choose your project; if SME supply is off, switch it on.', 'Press Create draft requisition with the rest empty.', 'Fill: title "<initials> KYC annotators (careers)", summary, domain banking, tier Annotator, headcount 5, hours per week 8, start date next Monday, languages en, jurisdictions IN, minimum 2 years; allow Demo Staffing Partner; tick the careers page; pay route Direct. Create.', 'Open it; Change state → Open. Then Pause, Open, Mark filled, Back to draft (where offered).'],
    expected: ['The switch explains "Switching it on does not change JD matching for the project." and then says "SME supply is on for this project."', 'Required fields carry asterisks and missing ones are named.', 'The draft shows every field, "Careers page: Accepting direct applications" and "Pay route: Direct: Praxis pays each SME".', 'Each state change explains its effect ("Allowed partners are told and can submit candidates.", "Partners cannot submit until you open it again.", "Headcount reached; no new submissions.").'],
    decisions: ['D-M10-01', 'D-M10-28', 'D-UI-01', 'D-UI-02'],
  }),
  c('TC-PM-015', 'Close a requisition: final', {
    category: 'FUNC', priority: 'P2', pre: 'A requisition you created that nobody else is using.',
    steps: ['Change state → Closed; read the warning; cancel; then "Yes, close it".', 'Try to edit it or reopen it.'],
    expected: ['Warning: "Final: a closed requisition cannot be changed or reopened."', 'No edit and no reopen afterwards; partners no longer see it as open.'],
    decisions: ['D-M10-10'],
  }),
  c('TC-PM-016', 'Link guidelines and a rate card to a requisition', {
    category: 'FUNC', priority: 'P1', pre: 'Your requisition from TC-PM-014. A published guidelines tier for banking / Annotator (TC-ADM-019). Rate card "KYC authoring (USD)" exists.',
    steps: ['Before linking a rate card, read the Rate card line on the requisition.', 'Guidelines: choose your package, "Latest published". Save.', 'Rate card: choose "KYC authoring (USD)". Save.', 'Ask Finance for a new version of the rate card (TC-FIN-002); read your requisition again.'],
    expected: ['Without a rate card: "Not linked yet: SMEs earn nothing until one is linked".', '"Guidelines linked." and "Rate card linked."; the requisition shows the package name and the card with its version and currency.', 'The requisition stays on the version you linked until you change it; "Earnings already recorded keep the version they were priced at."'],
    decisions: ['D-M10-29', 'D-M10-17'],
  }),
  c('TC-PM-017', 'Pay route via partner: no earnings, no payment set-up', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as PM. A project with SME supply on.',
    steps: ['Create and open a requisition with pay route "Via partner" and the careers page on.', 'Read the requisition page.', 'An SME tester applies on its careers page, is selected and opens Payments and the onboarding checklist (TC-SME-070).'],
    expected: ['"Via partner: the partner pays its people" and "Rate card: Not needed (paid via partner)".', 'The SME has no "Payment set-up" checklist item; Payments says the partner pays them.', 'Accepted tasks for that SME create no earnings.'],
    decisions: ['D-M10-28', 'D-M10-30'],
  }),
  c('TC-PM-018', 'Confirm a pay run', {
    category: 'FUNC', priority: 'P1', pre: 'Finance has built a pay run (TC-FIN-003).',
    steps: ['Payments → Pay runs → open the run. Read Entries, Held and Carried forward.', 'Confirm pay run. Press it twice quickly.', 'Look for Approve or Submit buttons.'],
    expected: ['The PM can read the run and sees "Waiting for a PM to confirm."', 'One confirmation is recorded; the page says "Waiting for Finance to approve." and names you under "Confirmed by (PM)".', 'The PM never sees Approve or Submit; only Finance does.'],
    decisions: ['D-M10-33'],
  }),
  c('TC-PM-019', 'Support Bot on the requisition form', {
    category: 'UX', priority: 'P2', pre: 'Signed in as PM on Requisitions → New requisition with some fields filled.',
    steps: ['Help → "What do I need to fill in on this screen?"', 'Ask "What is the difference between Direct and Via partner?" and "What happens when I open this requisition?"', 'Ask "Create this requisition for me."'],
    expected: ['It lists the required fields of this form (matching the asterisks) and mentions what you already filled in.', 'Its process answers match D-M10-28 and D-M10-10.', 'It does not create anything; it tells you which button to press. No new requisition appears.'],
    decisions: ['D-UI-04', 'D-UI-05', 'D-UI-06'],
  }),
];
