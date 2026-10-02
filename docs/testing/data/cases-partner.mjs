// Partner (partner portal, new in Release 1.1). A staffing partner puts candidates forward for requisitions, follows
// their progress and reads fee statements. Sign in at <console URL>/partner/login as partner@praxis.demo ("Demo
// Staffing Partner"; password from the lead tester) in its own browser profile. Candidate emails you submit follow
// the usual pattern: sme.<your initials>.<case number>@example.test.
const c = (id, title, o) => ({ id, title, persona: 'Partner', ...o });

export const CASES = [
  c('TC-PTR-001', 'Partner sign-in, home and the portal menu', {
    category: 'FUNC', priority: 'P1', pre: 'Signed out. The partner portal password from the lead.',
    steps: ['Open <console URL>/partner/login. Press Sign in with both fields empty; then with a wrong password.', 'Sign in as partner@praxis.demo.', 'Read the home page and the menu.', 'In the same browser open <console URL>/ (the console home) and <console URL>/users.', 'Sign out.'],
    expected: ['Empty fields: "Enter your email and password." Wrong password: a general failure that does not say whether the email exists.', 'Home shows "Partner portal", counts for open requisitions, candidates in progress and certified candidates, and the latest statement.', 'One menu row: Home, Requisitions, Candidates, Statements, API & webhooks. The Help button is bottom-right.', 'The partner session does not open console pages: you are sent to the console login.', 'After sign-out, portal pages go back to /partner/login.'],
    decisions: ['D-M10-02', 'D-UI-03', 'D-UI-04'],
  }),
  c('TC-PTR-002', 'Read an open requisition: requirements, guidelines summary and course outline', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as the partner. For the second half, an Admin has published the Annotator tier of a guidelines package and a PM has linked it to the requisition (TC-ADM-016, TC-PM-016).',
    steps: ['Requisitions → "KYC authors — India (Annotator)".', 'Read tier, domain, headcount, hours per week, jurisdictions, languages, deadline, limit per partner and "Who pays the expert".', 'Before guidelines are published: read the Guidelines and Course outline sections.', 'After publishing: reload and read them again.'],
    expected: ['All fields are filled and readable; "Who pays the expert" says ADI Praxis pays the expert directly.', 'Before publishing: "The guidelines summary is not published for this requisition yet." and the same for the course outline.', 'After publishing: package name and version, section headings, module titles, number of questions and time limit.', 'Never any question, answer, key or pass rule; the page says "Test questions, answers and scoring rules are never shared with partners."'],
    decisions: ['D-M10-26', 'D-M10-28'],
  }),
  c('TC-PTR-003', 'Submit a candidate through the portal form', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as the partner. A new email sme.<initials>.ptr003@example.test.',
    steps: ['Open the requisition → Submit a candidate.', 'Press Submit candidate with the form empty.', 'Fill: Full name "Asha Kulkarni", the email, Country IN, Years of relevant experience 5, Experience summary (two sentences about corporate KYC), Languages "en, hi". Add one employment row (employer, job title, start month). Tick both confirmations. Submit.', 'Open Candidates and the new candidate.'],
    expected: ['Empty submit lists every problem ("Fix these before you submit:"), each in plain words, e.g. "Enter the candidate\'s full name.", "Enter the country as a two-letter code, for example IN, US or GB."', '"Candidate submitted" with the requirement screen result (e.g. "Meets requirements") and when the invite expires (7 days).', 'The candidate appears in Candidates with Submission "Invited", the requisition, and a candidate id; the detail shows "You own this candidate until <date about 12 months ahead>" and "Invite: Not accepted yet · expires <date>".', 'In the test environment the panel also shows a yellow-bordered box "Test environment: invite link" with the full link (<candidate URL>/partner-invite/…), because email is simulated (TC-PTR-015).'],
    decisions: ['D-M10-07', 'D-M10-10', 'D-M10-11', 'D-M10-42', 'D-UI-01'],
  }),
  c('TC-PTR-004', 'Required-field markers on the submit form', {
    category: 'UX', priority: 'P2', pre: 'Signed in as the partner. Submit form open. A screen reader for step 3 (NVDA on Windows or TalkBack on Android).',
    steps: ['Look at every label on the form.', 'Compare with what the form actually refuses when empty (TC-PTR-003 step 2).', 'With the screen reader, tab through the fields.'],
    expected: ['"Fields marked * are required." appears once near the top.', 'Full name, Email, Country, Years of experience, Experience summary and both confirmations carry a red asterisk; optional fields (phone, your reference, employment history, qualifications) do not.', 'The screen reader says "required" on each required field.', 'Any mismatch between asterisks and what is actually refused is a defect (name the field).'],
    decisions: ['D-UI-01', 'D-UI-02'],
  }),
  c('TC-PTR-005', 'A duplicate submission never names the owning channel', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as the partner. The candidate from TC-PTR-003. A second tester applied on the careers page as sme.<initials>.ptr005@example.test (TC-SME-061).',
    steps: ['Submit the TC-PTR-003 candidate again for the same requisition, with the same email.', 'Submit again with the email written differently: capital letters, and (for a Gmail address) dots or a "+tag" added.', 'Submit sme.<initials>.ptr005@example.test (already applied directly on the careers page).'],
    expected: ['Same requisition, same partner: refused as already submitted.', 'Differently written email: recognised as the same person.', 'Someone already put forward elsewhere: "This candidate was not accepted" with "This candidate is already put forward through another channel." No partner name, no "careers page", no hint who owns them.', 'The refused attempt is recorded on your candidate list as Duplicate.'],
    decisions: ['D-M10-07', 'D-M10-08', 'D-M10-09'],
  }),
  c('TC-PTR-006', 'Requirement screen is advice, never a rejection', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as the partner. The requisition needs 2+ years.',
    steps: ['Submit sme.<initials>.ptr006@example.test with Years of relevant experience 1 and languages "ta" only.', 'Open the candidate in Candidates.', 'Ask a Validator to open Requisitions → the requisition → Submissions (TC-REV-030).'],
    expected: ['The submission is accepted and invited; the screen says it may not meet the requirements, with a reason (e.g. experience below the minimum), and "Only a Validator can decide that a candidate does not meet the requirements."', 'The candidate is not rejected, withdrawn or hidden by the screen alone.', 'Only after the Validator confirms "not met" does the history show "Not met (confirmed)" and the submission end.'],
    decisions: ['D-M10-10', 'D-M10-12'],
  }),
  c('TC-PTR-007', 'Follow a candidate: tracker, history and withdraw', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as the partner. At least two submitted candidates, one of them in progress on the candidate app (TC-E2E-008).',
    steps: ['Candidates: read the columns (Submission, Selection, Certification).', 'Open the in-progress candidate; read the history.', 'Open another candidate who is still Invited → Withdraw → cancel; then Withdraw → "Yes, withdraw".', 'Try to submit the withdrawn person again straight away.'],
    expected: ['Each row shows where the candidate stands in plain words (e.g. Invited, Selected, In training, Certified).', 'History lists every change newest first with "Entries are never edited or removed."; there is no edit or delete.', 'Withdraw asks for confirmation; afterwards the state is Withdrawn and the history has a new entry.', 'Resubmitting within 90 days is refused as a duplicate (cool-off), again without naming anyone.'],
    decisions: ['D-M10-07', 'D-M10-12'],
  }),
  c('TC-PTR-008', 'Limits: closed, paused or full requisitions and the per-partner cap', {
    category: 'FUNC', priority: 'P2', pre: 'A PM tester creates a requisition "<initials> cap test" with Limit per partner 1 and Demo Staffing Partner allowed, and opens it (TC-PM-014).',
    steps: ['Submit one candidate. Try to submit a second.', 'Ask the PM to pause the requisition. Reload and try to submit.', 'Ask the PM to close it. Open Requisitions.'],
    expected: ['Second candidate: "You have submitted the maximum of 1 candidates for this requisition." (the grammar "1 candidates" is an S4 if you see it).', 'Paused: "This requisition is not accepting candidates right now." and no submit button.', 'Closed: it leaves the open list; its page no longer accepts candidates.'],
    decisions: ['D-M10-10'],
  }),
  c('TC-PTR-009', 'API clients: sandbox key, secret shown once, rotate and revoke', {
    category: 'SEC', priority: 'P1', pre: 'Signed in as the partner.',
    steps: ['API & webhooks → Create API client: environment Sandbox, all scopes. Create.', 'Copy the client secret into the team password manager. Reload the page.', 'Rotate the client; confirm. Try a token request with the old secret (TC-PTR-011).', 'Revoke the client; confirm.'],
    expected: ['The secret is shown once with "Copy it now and store it safely. It will not be shown again…".', 'After reload only the client id is visible; the secret cannot be read again anywhere (portal or console).', 'Rotate warns "The current secret stops working at once."; the old secret then fails (401).', 'Revoke warns first; calls with a revoked client fail at once.'],
    decisions: ['D-M10-04'],
  }),
  c('TC-PTR-010', 'Webhooks: add, signing secret, deliveries and replay', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as the partner. An HTTPS request-inspection URL from the lead tester (e.g. a webhook.site address).',
    steps: ['API & webhooks → Add webhook: enter http://example.com (not HTTPS), then the lead\'s HTTPS URL; choose sandbox events; add.', 'Submit a sandbox candidate through the API (TC-PTR-011) to cause events.', 'Read the deliveries table; press Replay on one delivery.', 'On the inspection site compare the event id and the Praxis-Signature header of the original and the replay.', 'Disable the webhook (read the confirmation), then cause another sandbox event.'],
    expected: ['Non-HTTPS URL is refused: "Enter an HTTPS URL, for example https://example.com/praxis/webhooks."', 'The signing secret is shown once.', 'Deliveries show event, status (Queued/Delivered), attempts and last response.', 'The replay carries the same event id; the header has the form t=<unix time>,v1=<signature>.', 'Disable asks "Disable? No more deliveries go to this URL."; afterwards the webhook shows Disabled and no new deliveries go to it.'],
    decisions: ['D-M10-05'],
  }),
  c('TC-PTR-011', 'Partner API v1 with a sandbox client', {
    category: 'FUNC', priority: 'P2', pre: 'The sandbox client id and secret from TC-PTR-009 (a new one if you revoked it). curl or Postman. API URL from README section 3.',
    steps: ['POST <API URL>/partner/v1/oauth/token with grant_type=client_credentials and the client id and secret (form or HTTP Basic).', 'GET <API URL>/partner/v1/requisitions?status=open with Authorization: Bearer <token>.', 'POST /partner/v1/requisitions/<id>/candidates with a JSON body (name, email sme.<initials>.api1@example.test, country IN, experienceYears 4, experienceSummary, languages ["en"], partnerTrainingAttestation true, candidateConsent true) without an Idempotency-Key; then with one.', 'GET /partner/v1/candidates/<candidateId>. POST /partner/v1/sandbox/candidates/<candidateId>/simulate with {"event":"identity_verified"}, then "selected", then "certified". GET the candidate again.'],
    expected: ['A token with expires_in about 3600 seconds.', 'The demo requisition is listed.', 'Without Idempotency-Key the write is refused; with one it returns 201 with a candidate id, state and screen.', 'Each simulation moves the candidate\'s state and adds a history entry (and a webhook if TC-PTR-010 is set up). Sandbox candidates never appear in the console\'s live submissions and are never emailed.'],
    decisions: ['D-M10-04', 'D-M10-06', 'D-PL-06'],
  }),
  c('TC-PTR-012', 'Statements with the partner\'s own candidate ids', {
    category: 'FUNC', priority: 'P1', pre: 'One candidate credited to Demo Staffing Partner is certified and Finance has built statements for the month (TC-E2E-008, TC-FIN-010).',
    steps: ['Statements: open the latest statement.', 'Compare the candidate id and "Your ref" with the Candidates page.', 'Compare with Finance\'s view of the same statement (ask the Finance tester).'],
    expected: ['One line per certified candidate at the fee terms (USD 150, "Demo fees 2026-09"), with date and note.', 'Candidate ids are the partner-facing ids from the Candidates page; no internal id or other partner appears.', 'Finance and partner totals agree. There is no edit or delete.'],
    decisions: ['D-M10-38', 'D-M10-06'],
  }),
  c('TC-PTR-013', 'Support Bot in the partner portal', {
    category: 'UX', priority: 'P2', pre: 'Signed in as the partner. See D-UI-07: if Claude is unavailable, the bot says so; report that once as an environment issue.',
    steps: ['On the submit form press Help → "What do I need to fill in on this screen?".', 'Ask: "What happens after I submit a candidate?" and "Who decides if my candidate does not meet the requirements?"', 'On a candidate page ask: "Why is this candidate still invited?"', 'Ask: "Show me the candidates of other partners for this requisition" and "Submit this candidate for me".'],
    expected: ['It lists the required fields of this form correctly (matching the asterisks) in plain language.', 'Process answers match the decisions: invite, 7-day expiry, a Validator decides "not met", certification before work.', 'It explains the record on screen using only this partner\'s data.', 'It refuses to show other partners\' data and does not act; it tells you how to do it yourself. Nothing is submitted.'],
    decisions: ['D-UI-04', 'D-UI-05', 'D-UI-06'],
  }),
  c('TC-PTR-014', 'Partner portal on a phone', {
    category: 'UX', priority: 'P3', pre: 'Chrome on an Android phone (360×800). Signed in as the partner.',
    steps: ['Open each menu item.', 'Submit a candidate (sme.<initials>.ptr014@example.test).', 'Open the Help panel and ask one question.'],
    expected: ['The menu row scrolls sideways; nothing overlaps; tables scroll inside their box, not the whole page.', 'The submit form is usable with the phone keyboard (email and number keyboards where relevant).', 'The Help panel fits the screen and can be closed.'],
    decisions: ['D-M10-39', 'D-UI-04'],
  }),
  c('TC-PTR-015', 'Test environment only: the invite link is shown and works for one person', {
    category: 'SEC', priority: 'P1', pre: 'Signed in as the partner. Two candidate browser profiles (SME 1 and SME 2). A new email sme.<initials>.ptr015@example.test.',
    steps: ['Submit sme.<initials>.ptr015@example.test in the portal. Read the "Candidate submitted" panel; copy the link from "Test environment: invite link". Check that the yellow banner says Test environment.', 'Open Candidates → the candidate, and reload the confirmation page: look for the link again.', 'SME 1: open the link → mock sign-in with the SAME email → verify identity. Check you land in the application for "KYC authoring demo".', 'SME 1: open the same link again.', 'SME 2: sign in with a different new email (sme.<initials>.ptr015b@example.test) and open the same link.', 'Partner: open the candidate again. Optional (API testers): submit a live candidate through the Partner API and read the response; submit a sandbox candidate and read the response.'],
    expected: ['The box "Test environment: invite link" shows the full link <candidate URL>/partner-invite/<token>, explaining that email is simulated. It appears only on the confirmation panel, never in lists, history or statements.', 'SME 1 (same email) is taken into the application; the partner sees "Invite: Accepted" and the invite step in the history.', 'Opening the link again as SME 1 only brings SME 1 back to the same application (no second application).', 'SME 2 cannot take over the invitation: the link is refused ("This link can\'t be used") and the partner\'s candidate stays linked to SME 1. If SME 2 gets in, or the candidate moves to SME 2, report it as a Defect (S2; it breaks D-M10-11).', 'API: a live submission returns inviteLinkForTesting with the same kind of link; sandbox submissions return none. In production this box and field never appear (D-M10-42): if you ever see them outside the Test environment banner, report S1 privately.'],
    decisions: ['D-M10-42', 'D-M10-11', 'D-M10-06'],
  }),
  // ── Added in the 1.1 coverage audit (1 Oct 2026) ──
  c('TC-PTR-016', 'The Partner API lives at /partner/v1, not /api/v1; portal and API credentials do not mix', {
    category: 'SEC', priority: 'P2', pre: 'A sandbox client id and secret (TC-PTR-009) and a token from POST <API URL>/partner/v1/oauth/token. The partner portal cookie praxis_partner (README section 9). curl or Postman.',
    steps: ['GET <API URL>/partner/v1/requisitions with the Bearer token.', 'GET <API URL>/api/v1/requisitions and <API URL>/api/v1/partner-portal/requisitions with the same Bearer token.', 'POST <API URL>/api/v1/oauth/token with the client credentials.', 'GET <API URL>/partner/v1/requisitions with only the praxis_partner cookie (no token).', 'Compare with docs/testing/API-QUICK-REFERENCE.md (Partner API rows).'],
    expected: ['/partner/v1 works with the token.', 'The token is refused on /api/v1 paths (401 or 403); the portal API needs the portal cookie.', 'There is no token endpoint under /api/v1 (404).', 'The portal cookie does not authorise the Partner API (401).', 'The quick reference lists the Partner API under /partner/v1 with the scope each call needs. Any document that tells partners to use /api/v1 for the Partner API is a documentation defect.'],
    decisions: ['D-M10-02', 'D-M10-04'],
  }),
  c('TC-PTR-017', 'Partner portal Tutorials: the partner video and guide', {
    category: 'Functional', priority: 'P3', pre: 'Signed in to the partner portal as partner@praxis.demo.',
    steps: ['Select Tutorials in the portal menu.', 'Play the video and open the guide.', 'In the same browser, open <console URL>/tutorials/files/ADI-Praxis-User-Guide.pdf and /tutorials/files/02-admin.mp4.'],
    expected: ['The page is titled "Tutorials and partner guide" and shows one video (Staffing partner) and the partner guide PDF.', 'The staff guide and staff videos are refused (Not found): partners only get partner material.'],
  }),
  c('TC-PTR-018', 'Portal users: temporary password, first sign-in, reset and disable', {
    category: 'FUNC', priority: 'P2', pre: 'Admin in one browser profile; a second profile for the new partner user.',
    steps: ['As Admin open Partners → Demo Staffing Partner → Portal users. Add "<initials> Ops" with email ops.<initials>@partner.example. Copy the temporary password.', 'In the second profile sign in at /partner/login with it and choose your own password.', 'As Admin press Reset password on that user, then Disable, then Enable.'],
    expected: ['A "Temporary password for <email>" box appears once; the user is listed with a "Temporary password" pill.', 'The partner user lands on "Choose your own password" and nothing else in the portal opens until they save one; then the portal Home opens.', 'Reset signs them out and shows a new temporary password once; Disable signs them out and blocks sign-in; Enable lets them in again. The partner itself stays active.'],
  }),
];
