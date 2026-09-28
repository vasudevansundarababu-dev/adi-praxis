// Admin (console). Only the lead tester holds the shared Admin account; create named Admin accounts for others.
const c = (id, title, o) => ({ id, title, persona: 'Admin', ...o });

export const CASES = [
  c('TC-ADM-001', 'Create users for each tester and role', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as Admin.',
    steps: ['Users → create pm.<initials>@praxis.test with role PM, reviewer.<initials>@praxis.test with REVIEWER.', 'Try a password of 11 characters, then one of 12+.', 'Sign in as the new user in another browser profile.'],
    expected: ['Passwords under 12 characters are refused.', 'The new user signs in and sees only their role\'s areas.'],
    decisions: ['D-PL-01', 'D-PL-05'],
  }),
  c('TC-ADM-002', 'Change roles and deactivate a user', {
    category: 'FUNC', priority: 'P1', pre: 'A test user signed in elsewhere.',
    steps: ['Give the user a second role; ask them to reload.', 'Deactivate the user; ask them to click anything.'],
    expected: ['New role areas appear after reload.', 'A deactivated user is signed out on the next request and cannot sign in again.'],
    decisions: ['D-PL-05', 'D-PL-06'],
  }),
  c('TC-ADM-003', 'Admin cannot lock themselves out', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as the only active Admin (use a test client, ask the lead).',
    steps: ['Try to remove your own Admin role or deactivate yourself.'],
    expected: ['Refused with an explanation (the platform keeps at least one active Admin).'],
    decisions: ['D-PL-05'],
  }),
  c('TC-ADM-004', 'Templates: create, publish, new version', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as Admin.',
    steps: ['Templates → New. Save with only a name, then try Publish.', 'Complete primary work, verification, human gate, TPT, skills, task mode; Publish.', 'Create a new version, change the TPT, publish it.', 'As PM, open New project.'],
    expected: ['Publish lists what is missing.', 'New project offers only the newest published version.'],
    decisions: ['D-M1-01', 'D-M1-02'],
  }),
  c('TC-ADM-005', 'Taxonomy lists', {
    category: 'FUNC', priority: 'P3', pre: 'Signed in as Admin.',
    steps: ['Taxonomy → browse countries, languages, CEFR levels, education, time zones.'],
    expected: ['Standard lists; India, Hindi/Tamil/Telugu/Bengali/Marathi/Kannada/Malayalam and Asia/Kolkata are present.'],
    decisions: ['D-M2-01', 'D-M4C-11'],
  }),
  c('TC-ADM-006', 'Contributor terms: new version requires acceptance again', {
    category: 'FUNC', priority: 'P2', pre: 'An onboarded expert (not yet assigned).',
    steps: ['Terms → edit the contributor terms, save as a new version.', 'Ask a PM to assign the expert; the expert tries to Accept.'],
    expected: ['Accept explains the new terms must be accepted first and links to onboarding.'],
    decisions: ['D-M4C-03', 'D-M4C-07'],
  }),
  c('TC-ADM-007', 'API clients: issue an RL Gym key', {
    category: 'SEC', priority: 'P1', pre: 'Signed in as Admin.',
    steps: ['API clients → create "RL Gym (test <initials>)", kind RL_GYM.', 'Copy the key. Reload the page.', 'Revoke a key and try to use it.'],
    expected: ['The key is shown once and cannot be viewed again after reload.', 'A revoked key gets 401.'],
    decisions: ['D-M5-10'],
  }),
  c('TC-ADM-008', 'Failure reason codes for RL review', {
    category: 'FUNC', priority: 'P3', pre: 'Signed in as Admin.',
    steps: ['Failure codes → add "MISSED_BENEFICIAL_OWNER" with a label; try lowercase "bad code".', 'Retire a code.'],
    expected: ['Only UPPER_SNAKE codes are accepted; retired codes are not offered to reviewers.'],
    decisions: ['D-M7-02'],
  }),
  c('TC-ADM-009', 'Dataset: list, lineage, export, verification', {
    category: 'FUNC', priority: 'P2', pre: 'Accepted tasks exist. Signed in as Admin in the browser.',
    steps: ['Open /api/v1/dataset/records?limit=2 then /api/v1/dataset/records?after=<next>.', 'Open /api/v1/dataset/records/<id>/lineage.', 'Open /api/v1/dataset/export.', 'Open /api/v1/dataset/verification.'],
    expected: ['Records come in chain order with paging.', 'Lineage names author, reviewer, project, template version and (for drafted tasks) provenance.', 'Export is newline-delimited JSON.', 'Verification: ok true, breaks [].'],
    decisions: ['D-M5-09', 'D-M6-02', 'D-M6-03', 'D-M9-14'],
  }),
  c('TC-ADM-010', 'Dataset correction appends a new record', {
    category: 'FUNC', priority: 'P3', pre: 'An accepted record. A REST tool.',
    steps: ['POST /api/v1/dataset/records/<id>/corrections with {"reason":"Fix a typo in the rationale"} (Idempotency-Key header).', 'Repeat on the same original record.'],
    expected: ['A new record with supersedesId = the original; the original is unchanged.', 'Correcting an already-corrected record is refused ("correct the latest version").'],
    decisions: ['D-M6-01'],
  }),
  c('TC-ADM-011', 'MCP replay bundle and the replay server', {
    category: 'FUNC', priority: 'P2', pre: 'An accepted KYC task\'s record id. Node 22 and the repo on your machine (developers or the lead).',
    steps: ['Save GET /api/v1/dataset/records/<id>/replay to bundle.json.', 'Run: pnpm --filter @praxis/mcp-replay start bundle.json, and connect with an MCP inspector (npx @modelcontextprotocol/inspector).', 'List tools; call each recorded call; call one with changed arguments.'],
    expected: ['tools/list shows the task\'s tools with inputSchema.', 'Each recorded call returns its recorded result; changed arguments return isError "No recorded response for these arguments."'],
    decisions: ['D-M9-11', 'D-M9-13'],
  }),
  c('TC-ADM-012', 'Admin sees everything a Reviewer sees', {
    category: 'FUNC', priority: 'P3', pre: 'Signed in as Admin.',
    steps: ['Open Applications, Task reviews, RL reviews for a project you are not assigned to.'],
    expected: ['Admins see all projects\' queues (Reviewers only their assigned projects).'],
    decisions: ['D-M4C-04'],
  }),
  // ── Release 1.1: partners, guidelines and certification, menu and help ──
  c('TC-ADM-013', 'Partners: add a partner, portal user, domains and tiers', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as Admin.',
    steps: ['Partners: read "Demo Staffing Partner" (business check, domains and tiers, submissions, users, API clients).', 'Add a partner: press Add with the form empty; then name "<initials> Test Staffing", business check Verified, domains "banking", tick Annotator only, one contact. Add.', 'Open it → Portal users → add ops.<initials>@partner.example.test with a password of 12+ characters.', 'Sign in as that user at /partner/login in another browser profile.'],
    expected: ['Required fields carry asterisks and the form says what is missing.', 'The new partner is listed as Verified with "banking" and Annotator.', 'The portal user can sign in and sees only requisitions open to their own partner (none, unless a PM allows it).', 'The console never shows any partner secret ("Secrets are never shown here.").'],
    decisions: ['D-M10-02', 'D-UI-01'],
  }),
  c('TC-ADM-014', 'Suspend and reactivate a partner', {
    category: 'SEC', priority: 'P2', pre: 'The partner from TC-ADM-013 with a sandbox API client created in its portal (TC-PTR-009 steps, as that partner).',
    steps: ['Partners → the partner → Suspend partner; read the warning; confirm.', 'As the partner: call the Partner API with a token issued before the suspension; request a new token; open the portal.', 'Reactivate the partner.'],
    expected: ['The warning says "Suspending ends every API token at once; the partner can no longer submit candidates."', 'Old tokens stop working at once; submitting is refused.', '"Partner reactivated."; the partner can request new tokens again.'],
    decisions: ['D-M10-04', 'D-PL-06'],
  }),
  c('TC-ADM-015', 'Partner fee terms', {
    category: 'FUNC', priority: 'P2', pre: 'Signed in as Admin.',
    steps: ['Partners → Demo Staffing Partner: read Fee terms.', 'On your test partner, save fee terms with fee "abc"; then 150.00 USD, version "<initials>-2026-10".', 'Save new terms again with 175.00.'],
    expected: ['Demo Staffing Partner: USD 150, version "Demo fees 2026-09".', 'Invalid amounts cannot be saved; valid terms give "Fee terms saved. New certified-candidate fees use them."', 'New terms apply only to candidates certified from now on; earlier fee entries keep their terms. A partner without terms shows "Not agreed. Certified-candidate fees are recorded at zero until terms are set."'],
    decisions: ['D-M10-38'],
  }),
  c('TC-ADM-016', 'Upload guidelines and watch the generation run', {
    category: 'FUNC', priority: 'P1', pre: 'Signed in as Admin. samples/kyc-procedure-notes.pdf (and .txt) downloaded. Known risk: if Claude quota is exhausted the run ends FAILED; report that once as an environment issue.',
    steps: ['Certification → Guidelines → New guidelines package: domain "banking", task family "<initials> KYC onboarding", name "<initials> KYC guidelines". Create.', 'Upload a version: kyc-procedure-notes.pdf, Major. Upload.', 'Refresh every minute; read the run: stage, status, model, cost (calls · tokens).', 'When it has SUCCEEDED, open the version: Knowledge map, and the three tiers (Annotator, Reviewer, Expert).'],
    expected: ['"Version 1 uploaded (N sections). Generation has started." The page does not freeze while it runs.', 'The run finishes SUCCEEDED within about 10 minutes (or FAILED with a clear error).', 'The knowledge map lists rules, steps, thresholds, edge cases and failure modes, each citing a section (S1, S2 …) that really says it.', 'Each tier has its own course, blueprint and question families; nothing is published yet.'],
    decisions: ['D-M10-13', 'D-M10-14'],
  }),
  c('TC-ADM-017', 'Guidelines upload: refused files', {
    category: 'FUNC', priority: 'P2', pre: 'A package from TC-ADM-016. samples/scanned-image-only.pdf, a PNG image, and an 11 MB text file (README section 8).',
    steps: ['Upload each file as a new version.', 'Upload samples/prompt-injection.txt as a version and let it generate.'],
    expected: ['The image, the image-only PDF and the file over 10 MB are refused with a message that says what to do ("The file is larger than 10 MB. Split it or remove images, then try again.").', 'The injection file generates ordinary content: no item, module or question follows its instructions (no wire transfer tool, no "accepted by the reviewer" text, no system prompt).'],
    decisions: ['D-M10-13', 'D-M9-09'],
  }),
  c('TC-ADM-018', 'Review the course, blueprint and question families of a tier', {
    category: 'FUNC', priority: 'P1', pre: 'A SUCCEEDED run (TC-ADM-016). Signed in as Admin.',
    steps: ['Annotator tier → Course review: read two modules (explanation, good and bad examples, quiz, practice) and their citations.', 'Edit one module\'s explanation and save.', 'Blueprint: read competencies, weights, item counts, time limit and pass rules; open "Edit length, time, pass rules and weights" and change nothing.', 'Item families: open three. Read the stem pattern, "Variables and answer rule", and the samples with their four checks. Press "generate another sample" on one.'],
    expected: ['Every module cites its sections; the quiz answers make sense against the guidelines.', 'After the edit: "Module saved. The course needs approval again."', 'Annotator defaults: 25 questions, 40 minutes, pass 80% with no critical-rule miss.', 'Each sample shows "Derived key" and the four checks (Key from rule, Independent solve agrees, Cited section supports it, Difficulty in band), all passed for a usable sample. A new sample appears after a refresh.'],
    decisions: ['D-M10-14', 'D-M10-15', 'D-M10-16', 'D-M10-20'],
  }),
  c('TC-ADM-019', 'Publish is blocked until everything is approved; published tiers are frozen', {
    category: 'FUNC', priority: 'P1', pre: 'The tier from TC-ADM-018 with nothing approved yet.',
    steps: ['Try to publish the Annotator tier.', 'Approve the course and the blueprint, and every family except one. Try again.', 'Approve the last family. Publish.', 'Try to edit a module, regenerate, or change the blueprint of the published tier.'],
    expected: ['Publish is not possible and "Still to approve" lists what is missing.', 'With one family left it is still blocked.', 'After publishing: "Candidates can start this course and test at once. To change anything later, upload a new version."', 'Nothing in a published tier can be changed; a new version is needed.'],
    decisions: ['D-M10-17'],
  }),
  c('TC-ADM-020', 'A flagged or rejected question family', {
    category: 'FUNC', priority: 'P3', pre: 'A tier in review with families. (A flagged family may not occur naturally: look for "Flagged after repeated validation failures" on any tester\'s package, or ask the lead.)',
    steps: ['Reject one family.', 'Edit a family\'s variable schema with invalid JSON; then a valid change. Save.', 'If a flagged family exists, try to approve it.'],
    expected: ['"Family rejected. It will not be used."', 'Invalid JSON: "The variable schema or answer rule is not valid JSON. Fix it and save again." Valid: "Family saved. Its samples were set aside; generate a new sample, then approve again."', 'A flagged family cannot be approved until it is edited or regenerated.'],
    decisions: ['D-M10-16', 'D-M10-17'],
  }),
  c('TC-ADM-021', 'Admin menu: all groups and second rows', {
    category: 'UX', priority: 'P1', pre: 'Signed in as Admin.',
    steps: ['Read the top row of the menu.', 'Click each group and read the second row.', 'Open a deep page, e.g. a pay run, a guidelines version, a partner, a task review. Check which group is highlighted.', 'Narrow the window to phone width.'],
    expected: ['Top row: Home, Projects, Reviews, Certification, Partners, Payments, Admin.', 'A group link opens its first page; groups with several pages show them on a second row (Projects: Projects, Templates, Requisitions; Reviews: 5 pages; Certification: Guidelines, Certification reviews; Admin: Users, Taxonomy, Terms, Failure codes, API clients). Partners and Payments have no second row (Payments has its own tabs).', 'The right group is highlighted on deep pages, and the current page on the second row.', 'Both rows scroll sideways; nothing overlaps.'],
    decisions: ['D-UI-03', 'D-PL-05'],
  }),
  c('TC-ADM-022', 'Validator label everywhere', {
    category: 'UX', priority: 'P2', pre: 'Signed in as Admin.',
    steps: ['Users: open the role picker for a user.', 'Open a project → Validators panel.', 'Open an application and a task review; read the messages.', 'In the candidate app (any SME) read the application status and onboarding texts.'],
    expected: ['The internal role is called "Validator" everywhere on screen. "Reviewer" appears only as the SME tier (Expert, Reviewer, Annotator).', 'Report each left-over "Reviewer" meaning the internal role as one UX issue with a list of screens (S4).'],
    decisions: ['D-M10-03'],
  }),
];
