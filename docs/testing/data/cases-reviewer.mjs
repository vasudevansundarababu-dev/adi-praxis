// Validator (console): the internal REVIEWER role, shown as "Validator" from Release 1.1. Your Validator account must be
// assigned to the project (PM or Admin: project → Validators).
const c = (id, title, o) => ({ id, title, persona: 'Validator', ...o });

export const CASES = [
  // ── Applications (selection) ──
  c('TC-REV-001', 'Application queue shows only assigned projects', {
    category: 'FUNC', priority: 'P1', pre: 'Two projects with applications; you are assigned to one.',
    steps: ['Reviews → Applications.', 'Open an application from the other project by URL (ask a colleague for its id).'],
    expected: ['Only your project\'s applications are listed, oldest first.', 'The other one is "not found".'],
    decisions: ['D-M4C-04'],
  }),
  c('TC-REV-002', 'Read an application: profile, evidence, AI recommendation', {
    category: 'UX', priority: 'P1', pre: 'A submitted application.',
    steps: ['Open it. Read the criteria findings, the confirmed profile, roles, claims and evidence.', 'Open an evidence file.'],
    expected: ['Each requirement shows met / not met / unknown with the reason and the answer it came from.', 'The AI recommendation is labelled as a recommendation; nothing is decided yet.', 'Evidence opens in a new tab (private link).', 'Rate how quickly you could decide (1–5) in your run log.'],
    decisions: ['D-M4C-05'],
  }),
  c('TC-REV-003', 'Record a decision: select, needs information, not selected', {
    category: 'FUNC', priority: 'P1', pre: 'Three submitted applications.',
    steps: ['Select one: reason, message, approved scope (domain, specialty, jurisdictions, languages, task roles, re-review date).', 'Needs information: one question.', 'Not selected: reason tied to a criterion, respectful message.', 'Try to submit with an empty reason or message; double-click Record decision.'],
    expected: ['Empty reason or message keeps the button disabled.', 'Double-click records one decision only.', 'Each candidate sees their message on the status page.', 'The decision history lists who decided and when; decisions cannot be edited or deleted.'],
    decisions: ['D-M4C-05', 'D-PL-06', 'D-M6-01'],
  }),
  c('TC-REV-004', 'Assessment failed: retry or review without a recommendation', {
    category: 'FUNC', priority: 'P3', pre: 'An application whose assessment failed (ask the lead; may happen if Vertex is unavailable).',
    steps: ['Open it: use Retry assessment, or Review without a recommendation.'],
    expected: ['Either path leads to a decision form; nothing is decided automatically.'],
    decisions: ['D-M4C-05'],
  }),
  c('TC-REV-005', 'Review a credential claim', {
    category: 'FUNC', priority: 'P3', pre: 'An application with a claim (e.g. a certification) and evidence.',
    steps: ['Review claim → level "document supported", how you checked → Save.'],
    expected: ['The claim shows the new level and your method; candidates can never set this themselves.'],
    decisions: ['D-FB-02'],
  }),
  c('TC-REV-006', 'Declare a conflict with a candidate', {
    category: 'FUNC', priority: 'P2', pre: 'An application.',
    steps: ['Declare a conflict with details.'],
    expected: ['You return to the queue and can no longer open that application; another Validator can.'],
    decisions: ['D-M4C-08'],
  }),
  c('TC-REV-007', 'Resolve a candidate-declared conflict', {
    category: 'FUNC', priority: 'P2', pre: 'A candidate declared a conflict in onboarding (TC-SME-021).',
    steps: ['Reviews → Conflicts → resolve it with a note.'],
    expected: ['The PM can now propose the candidate.'],
    decisions: ['D-M4C-08'],
  }),
  c('TC-REV-008', 'Identity reviews (alternative checks)', {
    category: 'FUNC', priority: 'P3', pre: 'A candidate who asked for an alternative identity check (after a failed check).',
    steps: ['Reviews → Identity reviews → open the request → Record decision: Alternative method used, Notes (never ID numbers) → Verified by alternative process (or Not verified on a second request).'],
    expected: ['The screen shows the request and the problem the candidate chose, without any ID number or image; Alternative method used is required.', 'The decision updates the candidate\'s identity status (TC-SME-078); nothing is decided automatically.'],
    decisions: ['D-PL-10'],
  }),

  // ── Task review ──
  c('TC-REV-010', 'Task review queue', {
    category: 'FUNC', priority: 'P1', pre: 'Submitted tasks in your project, including one you wrote as an SME with the same email (optional).',
    steps: ['Reviews → Task reviews.'],
    expected: ['Flagged items (possible duplicate or real data) come first.', 'Tasks you authored or whose author you declared a conflict with are not listed.'],
    decisions: ['D-M5-08'],
  }),
  c('TC-REV-011', 'Task review screen: checks, similar tasks, how it was made', {
    category: 'UX', priority: 'P1', pre: 'A drafted, submitted KYC task.',
    steps: ['Open it. Read "How this task was made", the automated checks, the similar-tasks panel and the full task.', 'Open the source file.', 'Open the AI interview transcript.'],
    expected: ['Drafted sections say "edited by the author" or "unchanged from the draft".', 'The source file downloads; "1 possible real identifier(s)" shows if the file had any.', 'Tool responses show as "tools/call <tool> {arguments}".', 'Similar tasks can be compared side by side.'],
    decisions: ['D-M9-02', 'D-M9-06', 'D-M9-08', 'D-M5-05', 'D-M9-11'],
  }),
  c('TC-REV-012', 'Accept a task', {
    category: 'FUNC', priority: 'P1', pre: 'A submitted task.',
    steps: ['Answer the checklist with one "No"; try Accept.', 'Answer all "Yes"; Accept. Double-click the button.'],
    expected: ['Accept needs every checklist item "Yes".', 'One dataset record is written (TC-ADM-009 to check); the task shows Accepted; the SME sees Accepted.'],
    decisions: ['D-M5-09', 'D-PL-06'],
  }),
  c('TC-REV-013', 'Request rework with comments pinned to sections', {
    category: 'FUNC', priority: 'P1', pre: 'A submitted task.',
    steps: ['Decision: Request rework, without a comment; Record decision. Then add comments pinned to W03 and W04 and a note; Record decision.'],
    expected: ['Rework needs at least one comment.', 'The SME sees the comments on the right sections (TC-E2E-003).'],
    decisions: ['D-M5-12'],
  }),
  c('TC-REV-014', 'Reject a task, including "real data"', {
    category: 'FUNC', priority: 'P2', pre: 'Two submitted tasks.',
    steps: ['Reject one as Duplicate.', 'Reject the other as Real data.'],
    expected: ['Reject needs a reason.', 'Real data: the task is quarantined; its content is removed and never enters the dataset; the SME sees it was not accepted.'],
    decisions: ['D-M5-07', 'D-PL-10'],
  }),
  c('TC-REV-015', 'Open-slot task: confirm coverage tags', {
    category: 'FUNC', priority: 'P3', pre: 'A submitted task from an open slot.',
    steps: ['Accept, adjusting the coverage tags and edge case.'],
    expected: ['The accepted record carries your confirmed tags.'],
    decisions: ['D-M5-02'],
  }),

  // ── RL review ──
  c('TC-REV-020', 'RL review: claim, judge, submit', {
    category: 'FUNC', priority: 'P1', pre: 'An RL review request (TC-RLG-001).',
    steps: ['Reviews → RL reviews → open → "Claim this review".', 'For each metric: agree or disagree (disagree needs a comment).', 'Choose FAIL with no comment → Submit verdict; then add a comment pinned to step 2 with a failure code; Submit verdict.'],
    expected: ['Before claiming, the form is read-only; another Validator sees who claimed it.', 'Missing items are listed ("A FAIL verdict needs at least one comment", "Explain why you disagree …").', 'After submit the review is done and appears in RL Gym results.'],
    decisions: ['D-M7-02', 'D-M7-03'],
  }),
  c('TC-REV-021', 'RL review with a large trajectory (signed URL)', {
    category: 'FUNC', priority: 'P3', pre: 'A request sent with trajectories.signedUrl.',
    steps: ['Open the review.'],
    expected: ['The Validator is given the link to open; the server never fetches it.'],
    decisions: ['D-M7-02'],
  }),
  // ── Release 1.1: the Reviewer role is now shown as "Validator" ──
  c('TC-REV-030', 'Validator menu and label', {
    category: 'UX', priority: 'P1', pre: 'Signed in with a REVIEWER account (shown as Validator).',
    steps: ['Read the top row of the menu and the second row of each group.', 'Read your role name in the header or home page.', 'Type /payments/pay-runs and /partners in the address bar.'],
    expected: ['Top row: Home, Projects, Reviews, Certification. Projects has only Requisitions (so no second row); Reviews: Applications, Task reviews, RL reviews, Identity reviews, Conflicts; Certification: Guidelines, Certification reviews.', 'The role is shown as "Validator".', 'Payments and Partners show "This page is for …; you are signed in as Validator".'],
    decisions: ['D-PL-05', 'D-UI-03', 'D-M10-03'],
  }),
  c('TC-REV-031', 'Confirm the requirement screen on submissions (one and many)', {
    category: 'FUNC', priority: 'P1', pre: 'A requisition with submissions, one marked "may not meet" (TC-PTR-006) and one "meets".',
    steps: ['Projects → Requisitions → the requisition → Submissions. Read Source, Requirement screen and reasons.', 'Select the "may not meet" row → confirm "not met" with a note.', 'Select two other rows → mark them as meeting the requirements.', 'Try to change the confirmed row again.'],
    expected: ['Each row shows its source (Partner portal, Partner API, Careers page) and the screen\'s recommendation with its reason.', '"Confirmed “not met” for 1. The partner and candidate are told." The partner\'s history shows "Not met (confirmed)".', '"Marked 2 as meeting the requirements."', '"Rows already confirmed “not met” cannot be changed here." Nothing was decided before you acted.'],
    decisions: ['D-M10-10', 'D-M10-12'],
  }),
  c('TC-REV-032', 'Certification reviews: confirm written grades', {
    category: 'FUNC', priority: 'P1', pre: 'A Reviewer-tier (or Expert-tier) test with written answers has been submitted (the Reviewer tier must be published, and a candidate on a Reviewer requisition takes it; coordinate with the lead). Signed in as Validator.',
    steps: ['Certification → Certification reviews. Filter to written answers.', 'Open one: read the item, rubric, the candidate\'s answer and the model grade.', 'Enter your own score and confirm. Double-click the confirm button.', 'Ask the candidate tester to read their result page before and after.'],
    expected: ['The model score is labelled "Recommendation — you decide"; nothing is decided by it.', 'One confirmation is recorded ("Grade confirmed."); if a second person is needed: "Another person must confirm it too."', 'Before every grade is confirmed the candidate sees "Your test is being reviewed by a person"; after, pass or fail with section bands.', 'You never see the candidate\'s identity documents.'],
    decisions: ['D-M10-21', 'D-M10-22'],
  }),
  c('TC-REV-033', 'Decide a certification after three fails', {
    category: 'FUNC', priority: 'P2', pre: 'A candidate has failed three attempts (TC-E2E-010). Signed in as Validator.',
    steps: ['Certification reviews → the certification waiting for a decision. Read the attempts and section bands.', 'Choose "Allow another retake" with a note. (A second tester, on another candidate: Not certified.)'],
    expected: ['The queue explains why it is waiting (three failed attempts).', '"Decision recorded. The candidate is told." The candidate sees a retake, or "A person reviewed your attempts and decided not to certify you this time."', 'The partner who supplied the candidate sees the certification state change; a "Not certified" decision is always a person\'s.'],
    decisions: ['D-M10-22', 'D-M10-24'],
  }),
  c('TC-REV-034', 'Confirm or reject a professional licence', {
    category: 'FUNC', priority: 'P3', pre: 'A requisition with tier Expert and "licence required", and a candidate who uploaded a licence (synthetic number and issuing body; any small PDF). Needs a certified Reviewer in that domain first: coordinate with the lead.',
    steps: ['Certification reviews → licences. Open the licence (opening the file is recorded in the audit log).', 'Reject with a note; ask the candidate to upload again; then confirm.'],
    expected: ['The file opens only for Validators and Admins; the page says opening it is recorded.', 'After rejection the candidate sees "The Validator could not confirm your last upload…". After confirmation: "Licence confirmed." and, if the test was already passed, the candidate is certified.'],
    decisions: ['D-M10-25'],
  }),
  c('TC-REV-035', 'Validator and Support Bot on a review screen', {
    category: 'UX', priority: 'P3', pre: 'Signed in as Validator on an application or a certification review.',
    steps: ['Help → "What should I check before I decide?"', 'Ask "Select this candidate for me" and "What did the other Validators decide on projects I am not on?"'],
    expected: ['The answer explains the checks for this screen and says the decision is yours.', 'It does not act, and it does not reveal anything you cannot already see.'],
    decisions: ['D-UI-05', 'D-UI-06'],
  }),
  // ── Added in the 1.1 coverage audit (1 Oct 2026) ──
  c('TC-REV-036', 'Pay holds: the API allows a Validator, but there is no Payments menu', {
    category: 'SEC', priority: 'P2', pre: 'Signed in as Validator (REVIEWER only). A REST tool with your session cookie. An SME id with an unpaid earning (ask the Finance tester). Tell Finance before you start: they release the hold afterwards.',
    steps: ['Look for Payments in the menu; type /payments/pay-runs and /payments/earnings.', 'POST /api/v1/pay-holds with {"smeUserId":"<id>","kind":"DISPUTE","reason":"Validator coverage test"} and an Idempotency-Key.', 'GET /api/v1/pay-holds?smeUserId=<id>.', 'POST /api/v1/pay-holds/<hold id>/release with {"note":"done"}.', 'GET /api/v1/earnings and /api/v1/pay-runs.'],
    expected: ['No Payments group; both URLs show the No access card "This page is for Finance, PMs and Admins".', 'Placing a hold works (201) and is audited; the hold is listed. (Release 1.1 limit: no screen for this; the guide asks Validators to ask Finance. Raise an Enhancement if a screen is needed.)', 'Releasing is refused (403): only Finance and Admin release holds.', 'Earnings and pay runs are refused (403). Finance then releases the hold (TC-FIN-007).'],
    decisions: ['D-M10-32', 'D-PL-05'],
  }),
  c('TC-REV-037', 'Guidelines for a Validator: read, approve Expert-tier families, nothing else', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as Validator. A guidelines version in review with an Expert tier (generated by the Admin tester, TC-ADM-016).',
    steps: ['Certification → Guidelines: open the version; read the knowledge map, a course and a blueprint.', 'On the Expert tier\'s blueprint open a family → Approve family.', 'Look for Upload, Regenerate, Edit module, Approve course, Edit length…, Approve blueprint, Reject family and Publish.', 'On the Annotator tier\'s blueprint look for Approve family.'],
    expected: ['Everything can be read, including the samples and their four checks.', 'Approve family works on the Expert tier ("You approved"); the family still needs the Admin\'s approval.', 'None of the Admin controls is shown; only an Admin can reject a family or publish.', 'Note in your run log whether Approve family is offered on non-Expert tiers (the guide says Validators approve Expert-tier families).'],
    decisions: ['D-M10-16', 'D-M10-17'],
  }),
  c('TC-REV-038', 'Validator home page', {
    category: 'UX', priority: 'P3', pre: 'Signed in as Validator, assigned to at least one project.',
    steps: ['Read Home and press each Open →.'],
    expected: ['The role reads "Validator". Tiles: Applications to decide, Tasks to review, RL reviews and Certification reviews, with counts for your assigned projects only.', 'No PM, Finance or Admin tiles.'],
    decisions: ['D-PL-05', 'D-M10-03'],
  }),
];
