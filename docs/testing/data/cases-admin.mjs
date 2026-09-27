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
];
