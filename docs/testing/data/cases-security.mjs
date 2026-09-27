// Security: functional security checks every tester can run in a normal browser (DevTools). Deeper, tool-driven
// testing is in cases-pentest.mjs and docs/testing/PENTEST.md. Report real vulnerabilities privately (SECURITY.md).
const c = (id, title, o) => ({ id, title, persona: 'Several', category: 'SEC', ...o });

export const CASES = [
  c('TC-SEC-001', 'Session cookies are protected', {
    priority: 'P1', pre: 'Signed in to the console and the candidate app.',
    steps: ['DevTools → Application → Cookies. Inspect praxis_session and praxis_candidate.', 'In the Console tab run: document.cookie'],
    expected: ['Both cookies are HttpOnly, Secure and SameSite=Lax; neither appears in document.cookie.'],
    decisions: ['D-PL-02'],
  }),
  c('TC-SEC-002', 'Security headers on every page', {
    priority: 'P1', pre: 'DevTools → Network.',
    steps: ['Reload the candidate home, console home and GET /api/v1/version. Inspect the response headers.'],
    expected: ['Apps: Content-Security-Policy (with frame-ancestors \'none\'), Strict-Transport-Security, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy; no X-Powered-By.', 'API: nosniff, DENY, no-referrer, Cache-Control no-store.'],
    decisions: ['D-PL-07'],
  }),
  c('TC-SEC-003', 'Pages cannot be framed (clickjacking)', {
    priority: 'P2', pre: 'A local HTML file: <iframe src="https://<console-url>/login" width=800 height=600></iframe>',
    steps: ['Open the file in Chrome.'],
    expected: ['The frame is blocked (empty, with a console error about frame-ancestors / X-Frame-Options).'],
    decisions: ['D-PL-07'],
  }),
  c('TC-SEC-004', 'Role access by URL (vertical privilege)', {
    priority: 'P1', pre: 'One browser profile per role.',
    steps: ['As PM, SME and Reviewer, open every console URL listed in README "Console map" and every /api/v1 path in docs/testing/API-QUICK-REFERENCE.md that is not for your role.'],
    expected: ['Pages show the "This page is for …" explanation; API calls return 401 (not signed in) or 403 (wrong role). No data from another role is ever shown.'],
    decisions: ['D-PL-05', 'D-PL-04'],
  }),
  c('TC-SEC-005', 'Another candidate\'s data (horizontal privilege)', {
    priority: 'P1', pre: 'Two candidates A and B in two browser profiles. Note B\'s enrollment id, task id and a task source id (from the URL).',
    steps: ['As A, open B\'s /enrollments/<id>/status, /tasks/<id>, /api/v1/me/tasks/<id>/drafting and /api/v1/me/tasks/<id>/sources/<sourceId>/file.'],
    expected: ['All are "not found" (404) for A; nothing of B\'s is shown.'],
    decisions: ['D-M9-02'],
  }),
  c('TC-SEC-006', 'Reviewer of another project (horizontal privilege)', {
    priority: 'P1', pre: 'A reviewer not assigned to project X; an application, task and source file from X.',
    steps: ['Open /review/applications/<id>, /review/tasks/<id>, and /api/v1/review/tasks/<id>/sources/<sourceId>/file.'],
    expected: ['Not found (404) for each.'],
    decisions: ['D-M4C-04', 'D-M9-02'],
  }),
  c('TC-SEC-007', 'Sign-in brute force is slowed down', {
    priority: 'P2', pre: 'A test account you own. REST tool or a small script.',
    steps: ['Send 15 wrong-password POST /api/v1/auth/login requests within a minute.'],
    expected: ['After 10, responses are 429 until the minute passes; the right password afterwards works.'],
    decisions: ['D-PL-03'],
  }),
  c('TC-SEC-008', 'Sign-in errors do not reveal which accounts exist', {
    priority: 'P2', pre: 'None.',
    steps: ['Sign in with an existing email and a wrong password; then with a non-existent email.'],
    expected: ['Both give the same message and similar response time.'],
    decisions: ['D-PL-01'],
  }),
  c('TC-SEC-009', 'Idempotency key is required and scoped', {
    priority: 'P2', pre: 'REST tool, signed-in cookie copied from DevTools.',
    steps: ['Send a POST (e.g. /api/v1/me/tasks/<id>/interview/messages) without Idempotency-Key.', 'Send the same body twice with the same key.', 'Reuse that key with a different body.'],
    expected: ['Missing key: 400; same key + body: the first response is replayed (header idempotent-replayed: true), nothing duplicated; same key + different body: 422.'],
    decisions: ['D-PL-06'],
  }),
  c('TC-SEC-010', 'Cross-site request forgery', {
    priority: 'P2', pre: 'Signed in to the console. A local HTML page with a form posting to <console-url>/api/v1/users (JSON is not possible from a plain form; try text/plain and urlencoded).',
    steps: ['Open the page and submit the form.'],
    expected: ['The request is refused (no Idempotency-Key and wrong content type; SameSite=Lax cookie not sent on cross-site POST); no user is created.'],
    decisions: ['D-PL-02', 'D-PL-06'],
  }),
  c('TC-SEC-011', 'Script injection in text fields (stored XSS)', {
    priority: 'P1', pre: 'Any role.',
    steps: ['Enter <img src=x onerror=alert(1)> and "><script>alert(2)</script> into: candidate display name, chat answers, interview answers, W02 business context, a party name, a tool response, a reviewer comment, a project name, a decision message.', 'View each where others see it (reviewer screens, PM screens, lists).'],
    expected: ['The text is shown literally; no alert ever runs; no broken layout.'],
    decisions: ['D-PL-07'],
  }),
  c('TC-SEC-012', 'Source files are private to author, project Reviewers and Admins', {
    priority: 'P1', pre: 'A drafted task with a source file; accounts for the author, a project reviewer, an unassigned reviewer, a PM, another candidate.',
    steps: ['Each opens the file URL (author: /api/v1/me/tasks/<t>/sources/<s>/file; others: /api/v1/review/tasks/<t>/sources/<s>/file).'],
    expected: ['Only the author, the assigned reviewer and Admins get the file; each reviewer/admin opening is in the audit log (task.source.opened). Others get 401/403/404. Responses are Cache-Control: private, no-store.'],
    decisions: ['D-M9-02'],
  }),
  c('TC-SEC-013', 'Uploaded file names and types cannot be abused', {
    priority: 'P2', pre: 'W00 upload and profile evidence upload.',
    steps: ['Upload files named ../../etc/passwd.txt, <script>.txt, a very long name (300 chars), and an HTML file renamed .txt containing <script>.', 'Download each back.'],
    expected: ['Names are shown sanitised; downloads come as attachments (never rendered as a web page); the HTML is treated as text.'],
    decisions: ['D-M9-07'],
  }),
  c('TC-SEC-014', 'No real data leaks into the dataset or RL Gym', {
    priority: 'P1', pre: 'A task drafted from samples/notes-with-real-looking-ids.txt and accepted.',
    steps: ['As Admin or with the RL key, read the dataset record, its lineage and its replay bundle.'],
    expected: ['None contain the file\'s text or its identifiers; provenance shows only the source kind and SHA-256.'],
    decisions: ['D-M9-02', 'D-M9-14', 'D-PL-10'],
  }),
  c('TC-SEC-015', 'Append-only records cannot be changed through the API', {
    priority: 'P1', pre: 'Admin cookie; an accepted record id; a task review.',
    steps: ['Try PUT/PATCH/DELETE on /api/v1/dataset/records/<id>, and on /api/v1/review/tasks/<id>/decision.'],
    expected: ['404 or 405; the record is unchanged; only corrections (new records) exist.'],
    decisions: ['D-M6-01'],
  }),
  c('TC-SEC-016', 'Error responses do not leak internals', {
    priority: 'P2', pre: 'REST tool.',
    steps: ['Send malformed JSON, a string where a number is expected, a 10 MB JSON body, and an unknown route.'],
    expected: ['Short messages with a request id; no stack traces, SQL, file paths or library versions.'],
    decisions: ['D-PL-07'],
  }),
  c('TC-SEC-017', 'Candidates cannot change their own status or evidence level', {
    priority: 'P1', pre: 'Candidate cookie; REST tool.',
    steps: ['Try the reviewer endpoints (/api/v1/review/…) with the candidate cookie.', 'Try to send extra fields like "status":"SELECTED" or "evidenceLevel":"VERIFIED" to candidate endpoints.'],
    expected: ['Reviewer endpoints: 401/403. Extra fields are ignored or rejected; nothing changes.'],
    decisions: ['D-M4C-05', 'D-FB-02'],
  }),
  c('TC-SEC-018', 'Mock sign-in exists only in demo/test', {
    priority: 'P2', pre: 'The test environment.',
    steps: ['Confirm the banner shows "Test environment" whenever the mock sign-in is offered.', 'GET /api/v1/version and note "env".'],
    expected: ['The mock sign-in and simulated identity page appear only where env is demo/test and the banner is shown. (Production refuses mocks at start-up.)'],
    decisions: ['D-PL-08'],
  }),
];
