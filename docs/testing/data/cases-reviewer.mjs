// Reviewer (console). Your reviewer account must be assigned to the project (PM or Admin: project → Reviewers).
const c = (id, title, o) => ({ id, title, persona: 'Reviewer', ...o });

export const CASES = [
  // ── Applications (selection) ──
  c('TC-REV-001', 'Application queue shows only assigned projects', {
    category: 'FUNC', priority: 'P1', pre: 'Two projects with applications; you are assigned to one.',
    steps: ['Applications.', 'Open an application from the other project by URL (ask a colleague for its id).'],
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
    expected: ['You return to the queue and can no longer open that application; another reviewer can.'],
    decisions: ['D-M4C-08'],
  }),
  c('TC-REV-007', 'Resolve a candidate-declared conflict', {
    category: 'FUNC', priority: 'P2', pre: 'A candidate declared a conflict in onboarding (TC-SME-021).',
    steps: ['Review → Conflicts → resolve it with a note.'],
    expected: ['The PM can now propose the candidate.'],
    decisions: ['D-M4C-08'],
  }),
  c('TC-REV-008', 'Identity reviews (alternative checks)', {
    category: 'FUNC', priority: 'P3', pre: 'A candidate who asked for an alternative identity check (after a failed check).',
    steps: ['Review → Identity reviews → open → decide.'],
    expected: ['The screen shows the request without any ID number or image; the decision updates the candidate\'s identity status.'],
    decisions: ['D-PL-10'],
  }),

  // ── Task review ──
  c('TC-REV-010', 'Task review queue', {
    category: 'FUNC', priority: 'P1', pre: 'Submitted tasks in your project, including one you wrote as an SME with the same email (optional).',
    steps: ['Task reviews.'],
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
    steps: ['Request rework without a comment; then add comments on W03 and W04 and a note; submit.'],
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
    steps: ['RL reviews → open → "Claim this review".', 'For each metric: agree or disagree (disagree needs a comment).', 'Choose FAIL with no comment → Submit verdict; then add a comment pinned to step 2 with a failure code; Submit verdict.'],
    expected: ['Before claiming, the form is read-only; another reviewer sees who claimed it.', 'Missing items are listed ("A FAIL verdict needs at least one comment", "Explain why you disagree …").', 'After submit the review is done and appears in RL Gym results.'],
    decisions: ['D-M7-02', 'D-M7-03'],
  }),
  c('TC-REV-021', 'RL review with a large trajectory (signed URL)', {
    category: 'FUNC', priority: 'P3', pre: 'A request sent with trajectories.signedUrl.',
    steps: ['Open the review.'],
    expected: ['The reviewer is given the link to open; the server never fetches it.'],
    decisions: ['D-M7-02'],
  }),
];
