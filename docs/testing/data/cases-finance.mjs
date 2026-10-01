// Finance (console, new in Release 1.1). Rate cards, earnings and holds, weekly pay runs, payout exceptions and
// partner statements. Sign in as finance@praxis.demo (password from the lead tester) or your own Finance account in
// its own browser profile. Payouts go to a simulated payout provider in the test environment: no real money moves.
const c = (id, title, o) => ({ id, title, persona: 'Finance', ...o });

export const CASES = [
  c('TC-FIN-001', 'Finance menu, home and what Finance cannot open', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as Finance.',
    steps: ['Read the menu and the home page.', 'Open Payments and read the tabs.', 'Type /projects, /templates, /requisitions, /review/applications, /certifications, /guidelines, /partners, /api-clients and /users in the address bar.'],
    expected: ['Menu: Home and Payments only (no second row; Payments has its own tabs). Your role shows as "Finance". Home tiles: Pay runs waiting for you (runs to approve or submit) and Open payout exceptions.', 'Payments tabs: Pay runs, Rate cards, Earnings and holds, Payout exceptions, Partner statements.', 'Every other area shows the No access card "This page is for …" with Go to your home page, never a bare 404, an empty page or an error (D-PL-05). Code currently differs on three, log a defect for each you see: /projects and /templates open an empty list ("No projects yet.") instead of the No access card, and /users shows a plain 404 page.'],
    decisions: ['D-PL-05', 'D-UI-03', 'D-M10-36'],
  }),
  c('TC-FIN-002', 'Rate cards: create, new version, never edited', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as Finance.',
    steps: ['Payments → Rate cards. Read "KYC authoring (USD)".', 'New rate card or version: name "<initials> KYC INR", currency INR, try to save with no per-task rate; then Authoring 3200, Annotation 650. Save.', 'Create it again with the same name and Authoring 3500.', 'Look for any way to edit or delete a rate card.', 'Try an amount "40.505" and "forty".'],
    expected: ['The demo card shows USD, Authoring 40, Annotation 8.', 'Without a per-task rate the form refuses ("Give at least one per-task rate" or similar); with rates, version 1 is created.', 'The same name creates version 2; version 1 is unchanged and still listed.', 'No edit or delete exists.', 'Bad amounts are refused with "Use amounts like 40 or 40.50."'],
    decisions: ['D-M10-29', 'D-UI-01'],
  }),
  c('TC-FIN-003', 'Build a pay run for a chosen week', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as Finance. At least one accepted task for a direct-pay SME (TC-E2E-008). There is one pay run per week for the whole environment: only the Finance tester named by the lead builds the current week (28 Sep 2026); others use an earlier Monday (7, 14 or 21 Sep) and cancel afterwards.',
    steps: ['Payments → Pay runs → Build pay run. Choose a Tuesday (e.g. 29 Sep 2026).', 'Choose the Monday agreed with the lead (28 Sep 2026 for the named Finance tester) and build.', 'Build the same week again.', 'Open the run and read Entries, Held and Carried forward.'],
    expected: ['A non-Monday is refused: "Pick a Monday: pay-run weeks start on Monday."', 'The run is created with status waiting for a PM ("Next step: PM confirms").', 'Building the same week again says "A pay run for this week already exists." and links to it.', 'One line per SME and currency with the total of their entries; held lines show a reason; balances under USD 10 / INR 500 are carried forward with "Balances under USD 10 or INR 500, or with nothing to pay, wait for the next run."'],
    decisions: ['D-M10-32'],
  }),
  c('TC-FIN-004', 'Approve only after a PM confirms; single approver is flagged', {
    category: 'FUNC', priority: 'P1', pre: 'The run from TC-FIN-003. A PM tester in another browser profile.',
    steps: ['As Finance open the run before the PM confirms: look for "Approve pay run".', 'PM: open the run → Confirm pay run.', 'Finance: reload → Approve pay run. Double-click the button.'],
    expected: ['Before confirmation there is no Approve button; the page says "Waiting for a PM to confirm."', 'After confirmation: "Waiting for Finance to approve." with "Confirmed by (PM)" filled.', 'One approval is recorded (not two); the run shows "Single approver" and "A single Finance approval was enough for this run because no second-approver threshold is set. The audit log records it as a single-approver action."', 'There is no audit screen for testers: the lead checks the audit entry (singleApprover) on request.'],
    decisions: ['D-M10-33', 'D-PL-06'],
  }),
  c('TC-FIN-005', 'Submit to the simulated payout provider; statuses move forward only', {
    category: 'FUNC', priority: 'P1', pre: 'An approved run (TC-FIN-004).',
    steps: ['Submit to payout provider. Double-click it.', 'Reload after one minute and after five minutes.', 'Ask the SME tester to open Payments in the candidate app.', 'As Finance try to cancel the submitted run.'],
    expected: ['"Submitted to the payout provider. Statuses update as the provider reports back." Each SME is paid once, even after a double-click.', 'Items move from Submitted to Paid (or Failed) and never back; each shows a provider reference. When every item is final the run is complete.', 'The SME sees the week with the payment status (e.g. "In payment", then paid).', 'A submitted run cannot be cancelled.'],
    decisions: ['D-M10-33', 'D-M10-34', 'D-M10-35'],
  }),
  c('TC-FIN-006', 'Cancel an approved run and rebuild the week', {
    category: 'FUNC', priority: 'P2', pre: 'A run that is approved but not submitted (build one for an earlier Monday, e.g. 21 Sep 2026; a PM confirms; you approve).',
    steps: ['Cancel the run with the reason "abc", then "Wrong week built by mistake".', 'Build the same week again.'],
    expected: ['A reason under 5 characters is refused.', '"Pay run cancelled. You can build the week again."; the cancelled run stays listed as cancelled.', 'The rebuilt run contains the same entries.'],
    decisions: ['D-M10-33'],
  }),
  c('TC-FIN-007', 'Pay holds: a disputed SME is held and carried forward', {
    category: 'FUNC', priority: 'P1', pre: 'An SME with an unpaid earning (their SME id is shown on a pay run line or in Earnings and holds).',
    steps: ['Payments → Earnings and holds → Place a pay hold: the SME id, kind Dispute, reason "Checking a disputed task". Keep the hold id shown.', 'Build a pay run for the week of the earning (agree the week with the lead: there is one run per week for everyone; cancel an existing approved run first if needed).', 'Release the hold with a note. Build the next week\'s run (or rebuild).'],
    expected: ['"Hold placed. Its id is …; keep it to release the hold later."', 'The SME appears under Held with the reason, not under Entries; nothing is submitted for them.', '"Hold released. The SME\'s balance goes into the next pay run." The held amount then appears in the next run.', 'UX note: holds are placed by SME id because names are not shown (known limitation); raise UX only if it blocks you.'],
    decisions: ['D-M10-32'],
  }),
  c('TC-FIN-008', 'Reverse an earning: append-only correction', {
    category: 'FUNC', priority: 'P1', pre: 'Earnings and holds shows at least one earning that is not yet paid.',
    steps: ['On an earning press "Reverse…"; try a reason of 3 characters, then "Task accepted in error".', 'Look at the original line and the new line.', 'With a REST tool (session cookie, README section 9) POST /api/v1/earnings/<original id>/reverse again, and POST /api/v1/earnings/<reversal id>/reverse, each with {"reason":"second try"} and a new Idempotency-Key.', 'Ask the SME tester to look at their Payments page.'],
    expected: ['The button stays disabled until the reason has 5 characters.', 'A new negative line "Reverses <id>" is added; the original is unchanged and shows "Reversed" with no further Reverse button.', 'The API refuses both: the original is already reversed, and "A reversal cannot be reversed; record a new entry instead."', 'The SME sees the original and a "Correction" line; their balance is reduced.'],
    decisions: ['D-M10-31', 'D-M6-01'],
  }),
  c('TC-FIN-009', 'Payout exceptions and reconciliation', {
    category: 'FUNC', priority: 'P2', pre: 'At least one submitted run (TC-FIN-005).',
    steps: ['Payments → Payout exceptions → Run reconciliation for the day of the submission (use the date picker).', 'Filter Open / Resolved / All.', 'If an exception exists, resolve it with a note of under 5 characters, then a proper note.'],
    expected: ['Reconciliation finishes and reports how many lines it compared; with the simulated provider there are usually no mismatches ("No exceptions here.").', 'Resolving needs a note of at least 5 characters; a resolved exception moves to Resolved with the note and who resolved it.'],
    decisions: ['D-M10-37'],
  }),
  c('TC-FIN-010', 'Build partner statements for a month', {
    category: 'FUNC', priority: 'P1', pre: 'A candidate credited to Demo Staffing Partner is certified this month (TC-E2E-008).',
    steps: ['Payments → Partner statements → build for September 2026.', 'Build the same month again.', 'Open the statement and compare it with the partner\'s Statements page (TC-PTR-012).'],
    expected: ['One statement for Demo Staffing Partner with one line per certified candidate at USD 150, terms "Demo fees 2026-09", and the partner\'s reference.', 'Building again: "No new statements for 2026-09: they already exist, or no candidate was certified." Nothing is duplicated.', 'The partner sees the same lines and total. Known limitation: the console may show a short partner id rather than the name.'],
    decisions: ['D-M10-38'],
  }),
  c('TC-FIN-011', 'Partner without fee terms gets a zero fee entry', {
    category: 'FUNC', priority: 'P3', pre: 'An Admin created a second partner with no fee terms and a candidate credited to it was certified (TC-ADM-013 plus the E2E journey). Coordinate with the lead: this takes a full certification.',
    steps: ['Build partner statements for the month.', 'Open that partner\'s statement.'],
    expected: ['The line is at 0 with the note NO_FEE_TERMS, so Finance can see terms are missing.'],
    decisions: ['D-M10-38'],
  }),
  c('TC-FIN-012', 'Finance with the Support Bot', {
    category: 'UX', priority: 'P2', pre: 'Signed in as Finance on a pay run page.',
    steps: ['Help → "Why can\'t I do this step yet?" on a run waiting for a PM.', 'Ask: "What does single approver mean here?" and "Which SMEs are held and why?"', 'Ask: "Approve this pay run for me." Then reload the run page.'],
    expected: ['It explains that a PM must confirm first, using this run\'s real state.', 'Answers match D-M10-32 and D-M10-33 and the run on screen.', 'It does not approve; it says Finance approves with the button. The run is unchanged after reload.'],
    decisions: ['D-UI-05', 'D-UI-06', 'D-M10-33'],
  }),
  // ── Added in the 1.1 coverage audit (1 Oct 2026) ──
  c('TC-FIN-013', 'Finance cannot approve a pay run that pays them', {
    category: 'SEC', priority: 'P2', pre: 'Coordinate with the lead (takes a day). The lead creates a Finance account finance.<initials>.self@example.test (POST /api/v1/users, TC-ADM-001). The same email is used to sign in to the candidate app as an SME on the direct-pay demo requisition, who completes onboarding and payment set-up and has one task accepted (TC-E2E-008 steps). A second Finance user (finance@praxis.demo). An earlier Monday agreed with the lead.',
    steps: ['Finance (self): build the pay run for the week of the acceptance; a PM confirms it.', 'Finance (self): open the run → Approve pay run. Read the note above the buttons.', 'With a REST tool, POST /api/v1/pay-runs/<id>/approve as Finance (self).', 'The second Finance user approves.'],
    expected: ['The page says "You cannot approve a run that pays you. Approving checks this and says so."', 'Approving is refused (403): "You are paid in this run; another Finance approver must approve it." The run stays Confirmed.', 'The second Finance user can approve; the run shows who approved. Cancel the run afterwards if the week is needed by others.'],
    decisions: ['D-M10-33', 'D-PL-05'],
  }),
];
