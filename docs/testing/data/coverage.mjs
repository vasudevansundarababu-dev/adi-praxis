// Traceability: which test cases cover each screen, role and Admin function of Release 1.1. build.mjs turns this into
// COVERAGE.md, checks that every case id exists, and lists any page under apps/web/app or apps/candidate/app that has
// no entry here (so a new screen cannot go untested unnoticed). Sources: docs/user-guide (ROLES-AND-ADMIN.md sections
// 3 and 4) and apps/web/lib/nav.ts.

// app: 'console' (apps/web, staff), 'partner' (apps/web/app/partner), 'candidate' (apps/candidate).
// route: the URL path with [param] written as :param, exactly as derived from the page file.
export const SCREENS = [
  // ── Console: shared ──
  { app: 'console', route: '/login', name: 'Console sign-in', cases: ['TC-ADM-001', 'TC-ADM-002', 'TC-SEC-001', 'TC-SEC-007', 'TC-SEC-008'] },
  { app: 'console', route: '/', name: 'Home (tiles per role)', cases: ['TC-ADM-036', 'TC-PM-001', 'TC-PM-028', 'TC-REV-038', 'TC-FIN-001'] },
  // ── Projects group ──
  { app: 'console', route: '/projects', name: 'Projects → Projects', cases: ['TC-PM-002', 'TC-PM-021', 'TC-ADM-023', 'TC-SEC-028'] },
  { app: 'console', route: '/projects/new', name: 'New project wizard (PM only)', cases: ['TC-PM-002', 'TC-E2E-006', 'TC-ADM-023', 'TC-ADM-025', 'TC-SEC-028'] },
  { app: 'console', route: '/projects/:id', name: 'Project page (Validators, pause, resume, cancel)', cases: ['TC-PM-002', 'TC-PM-020', 'TC-PM-021', 'TC-PM-022'] },
  { app: 'console', route: '/projects/:id/staffing', name: 'Resource assignment (staffing board, sourcing campaign)', cases: ['TC-PM-003', 'TC-PM-006', 'TC-PM-007', 'TC-PM-008', 'TC-PM-023', 'TC-PM-025', 'TC-E2E-001'] },
  { app: 'console', route: '/projects/:id/opportunity', name: 'Opportunity page editor', cases: ['TC-PM-004', 'TC-PM-005', 'TC-PM-027', 'TC-E2E-006'] },
  { app: 'console', route: '/projects/:id/dashboard', name: 'Progress dashboard', cases: ['TC-PM-010'] },
  { app: 'console', route: '/projects/:id/tasks', name: 'Tasks and invites (reclaim, invites, task inputs)', cases: ['TC-PM-009', 'TC-PM-024', 'TC-ADM-029'] },
  { app: 'console', route: '/candidates/:id', name: 'View profile (matching record)', cases: ['TC-PM-025'] },
  { app: 'console', route: '/templates', name: 'Projects → Templates (list, add domain)', cases: ['TC-ADM-004', 'TC-ADM-028', 'TC-PM-012', 'TC-SEC-028'] },
  { app: 'console', route: '/templates/new', name: 'New template', cases: ['TC-ADM-004', 'TC-SEC-028'] },
  { app: 'console', route: '/templates/:id', name: 'Template editor (publish, new version, retire, versions)', cases: ['TC-ADM-004', 'TC-ADM-027', 'TC-PM-012'] },
  { app: 'console', route: '/requisitions', name: 'Projects → Requisitions', cases: ['TC-PM-014', 'TC-REV-031', 'TC-FIN-001'] },
  { app: 'console', route: '/requisitions/new', name: 'New requisition', cases: ['TC-PM-014', 'TC-PM-017', 'TC-PM-019', 'TC-SEC-028'] },
  { app: 'console', route: '/requisitions/:id', name: 'Requisition (state, guidelines, rate card, submissions)', cases: ['TC-PM-014', 'TC-PM-015', 'TC-PM-016', 'TC-PM-017', 'TC-REV-031'] },
  { app: 'console', route: '/requisitions/:id/edit', name: 'Edit requisition', cases: ['TC-PM-026'] },
  // ── Reviews group ──
  { app: 'console', route: '/review/applications', name: 'Reviews → Applications', cases: ['TC-REV-001', 'TC-REV-003', 'TC-E2E-001'] },
  { app: 'console', route: '/review/applications/:id', name: 'Application decision', cases: ['TC-REV-002', 'TC-REV-003', 'TC-REV-004', 'TC-REV-005', 'TC-REV-006', 'TC-E2E-004'] },
  { app: 'console', route: '/review/tasks', name: 'Reviews → Task reviews', cases: ['TC-REV-010', 'TC-E2E-001'] },
  { app: 'console', route: '/review/tasks/:id', name: 'Task review (accept, request rework, reject)', cases: ['TC-REV-011', 'TC-REV-012', 'TC-REV-013', 'TC-REV-014', 'TC-REV-015', 'TC-E2E-003'] },
  { app: 'console', route: '/review/rl', name: 'Reviews → RL reviews', cases: ['TC-REV-020', 'TC-E2E-005'] },
  { app: 'console', route: '/review/rl/:id', name: 'RL review (claim, verdict)', cases: ['TC-REV-020', 'TC-REV-021', 'TC-E2E-005'] },
  { app: 'console', route: '/review/identity', name: 'Reviews → Identity reviews', cases: ['TC-REV-008', 'TC-SME-078'] },
  { app: 'console', route: '/review/conflicts', name: 'Reviews → Conflicts', cases: ['TC-REV-007', 'TC-SME-021'] },
  // ── Certification group ──
  { app: 'console', route: '/guidelines', name: 'Certification → Guidelines', cases: ['TC-ADM-016', 'TC-ADM-017', 'TC-REV-037', 'TC-E2E-009', 'TC-SEC-028'] },
  { app: 'console', route: '/guidelines/versions/:id', name: 'Guidelines version (runs, knowledge map, tiers, publish, regenerate)', cases: ['TC-ADM-016', 'TC-ADM-019', 'TC-ADM-032', 'TC-ADM-033'] },
  { app: 'console', route: '/guidelines/courses/:id', name: 'Course review', cases: ['TC-ADM-018', 'TC-REV-037'] },
  { app: 'console', route: '/guidelines/blueprints/:id', name: 'Blueprint and item families', cases: ['TC-ADM-018', 'TC-ADM-020', 'TC-REV-037'] },
  { app: 'console', route: '/certifications', name: 'Certification → Certification reviews', cases: ['TC-REV-032', 'TC-REV-033', 'TC-REV-034'] },
  // ── Partners, Payments, Admin groups ──
  { app: 'console', route: '/partners', name: 'Partners → Partners', cases: ['TC-ADM-013', 'TC-SEC-028'] },
  { app: 'console', route: '/partners/:id', name: 'Partner page (settings, suspend, fee terms, portal users)', cases: ['TC-ADM-013', 'TC-ADM-014', 'TC-ADM-015', 'TC-ADM-030', 'TC-ADM-031'] },
  { app: 'console', route: '/payments', name: 'Payments (redirects to Pay runs)', cases: ['TC-ADM-021', 'TC-FIN-001'] },
  { app: 'console', route: '/payments/pay-runs', name: 'Payments → Pay runs', cases: ['TC-FIN-003', 'TC-ADM-024', 'TC-PM-018'] },
  { app: 'console', route: '/payments/pay-runs/:id', name: 'Pay run (confirm, approve, submit, cancel)', cases: ['TC-FIN-004', 'TC-FIN-005', 'TC-FIN-006', 'TC-FIN-013', 'TC-PM-018', 'TC-ADM-024'] },
  { app: 'console', route: '/payments/rate-cards', name: 'Payments → Rate cards', cases: ['TC-FIN-002', 'TC-PM-013'] },
  { app: 'console', route: '/payments/earnings', name: 'Payments → Earnings and holds', cases: ['TC-FIN-007', 'TC-FIN-008', 'TC-REV-036'] },
  { app: 'console', route: '/payments/exceptions', name: 'Payments → Payout exceptions', cases: ['TC-FIN-009'] },
  { app: 'console', route: '/payments/statements', name: 'Payments → Partner statements', cases: ['TC-FIN-010', 'TC-FIN-011'] },
  { app: 'console', route: '/users', name: 'Admin → Users (read-only)', cases: ['TC-ADM-001', 'TC-ADM-002', 'TC-SEC-028'] },
  { app: 'console', route: '/taxonomy', name: 'Admin → Taxonomy', cases: ['TC-ADM-005', 'TC-ADM-025'] },
  { app: 'console', route: '/terms', name: 'Admin → Terms', cases: ['TC-ADM-006', 'TC-ADM-026'] },
  { app: 'console', route: '/failure-codes', name: 'Admin → Failure codes', cases: ['TC-ADM-008'] },
  { app: 'console', route: '/api-clients', name: 'Admin → API clients', cases: ['TC-ADM-007', 'TC-ADM-029'] },
  { app: 'console', route: '/tutorials', name: 'Tutorials (videos and user guide)', cases: ['TC-ADM-037', 'TC-SEC-029'] },
  { app: 'console', route: '/change-password', name: 'Change password (and first sign-in with a temporary password)', cases: ['TC-ADM-038', 'TC-SEC-030'] },
  // ── Partner portal ──
  { app: 'partner', route: '/partner/login', name: 'Partner sign-in', cases: ['TC-PTR-001', 'TC-ADM-030'] },
  { app: 'partner', route: '/partner', name: 'Partner home', cases: ['TC-PTR-001'] },
  { app: 'partner', route: '/partner/requisitions', name: 'Requisitions', cases: ['TC-PTR-002', 'TC-PTR-008'] },
  { app: 'partner', route: '/partner/requisitions/:id', name: 'Requisition (guidelines summary, course outline)', cases: ['TC-PTR-002', 'TC-E2E-009'] },
  { app: 'partner', route: '/partner/requisitions/:id/submit', name: 'Submit a candidate', cases: ['TC-PTR-003', 'TC-PTR-004', 'TC-PTR-005', 'TC-PTR-006', 'TC-PTR-015'] },
  { app: 'partner', route: '/partner/candidates', name: 'Candidates', cases: ['TC-PTR-007'] },
  { app: 'partner', route: '/partner/candidates/:id', name: 'Candidate (history, withdraw)', cases: ['TC-PTR-007', 'TC-PTR-015', 'TC-ADM-035'] },
  { app: 'partner', route: '/partner/statements', name: 'Statements', cases: ['TC-PTR-012'] },
  { app: 'partner', route: '/partner/integrations', name: 'API & webhooks', cases: ['TC-PTR-009', 'TC-PTR-010', 'TC-SEC-022'] },
  { app: 'partner', route: '/partner/tutorials', name: 'Tutorials (partner video and guide)', cases: ['TC-PTR-017', 'TC-SEC-029'] },
  { app: 'partner', route: '/partner/change-password', name: 'Change password (and first sign-in with a temporary password)', cases: ['TC-PTR-018', 'TC-SEC-030'] },
  // ── Candidate app ──
  { app: 'candidate', route: '/', name: 'Landing page', cases: ['TC-SME-001'] },
  { app: 'candidate', route: '/sign-in', name: 'Sign in (mock Google, 18+)', cases: ['TC-SME-001', 'TC-SME-003', 'TC-SME-077'] },
  { app: 'candidate', route: '/verify', name: 'Verify your identity, I need help', cases: ['TC-SME-002', 'TC-SME-078'] },
  { app: 'candidate', route: '/dev/identity/:sessionId', name: 'Simulated identity result (test only)', cases: ['TC-SME-002', 'TC-SEC-018'] },
  { app: 'candidate', route: '/home', name: 'Home (journey, Next step, assignments)', cases: ['TC-SME-080', 'TC-SME-022'] },
  { app: 'candidate', route: '/tutorials', name: 'Tutorials (expert video and guide)', cases: ['TC-SME-081'] },
  { app: 'candidate', route: '/opportunities', name: 'Opportunities', cases: ['TC-SME-010'] },
  { app: 'candidate', route: '/opportunities/:id', name: 'Opportunity', cases: ['TC-SME-010', 'TC-PM-027'] },
  { app: 'candidate', route: '/apply/:campaignId', name: 'Sourcing campaign apply link', cases: ['TC-PM-023'] },
  { app: 'candidate', route: '/careers/requisitions/:id', name: 'Careers page', cases: ['TC-SME-060', 'TC-SME-061'] },
  { app: 'candidate', route: '/partner-invite/:token', name: 'Partner invite link', cases: ['TC-SME-062', 'TC-PTR-015', 'TC-E2E-008'] },
  { app: 'candidate', route: '/enrollments/:id', name: 'Profile chat', cases: ['TC-SME-011', 'TC-SME-012', 'TC-SME-013', 'TC-SME-014'] },
  { app: 'candidate', route: '/enrollments/:id/form', name: 'Profile as a form', cases: ['TC-SME-015'] },
  { app: 'candidate', route: '/enrollments/:id/review', name: 'Review and submit, evidence', cases: ['TC-SME-016', 'TC-SME-017'] },
  { app: 'candidate', route: '/enrollments/:id/status', name: 'Application status (ask for a review, withdraw)', cases: ['TC-SME-018', 'TC-SME-019', 'TC-SME-076'] },
  { app: 'candidate', route: '/enrollments/:id/onboarding', name: 'Onboarding checklist', cases: ['TC-SME-020', 'TC-SME-021', 'TC-SME-071'] },
  { app: 'candidate', route: '/invites/:token', name: 'Task invite link', cases: ['TC-PM-024'] },
  { app: 'candidate', route: '/workbench/handoff', name: 'Open workbench hand-off', cases: ['TC-SME-022', 'TC-SME-023'] },
  { app: 'candidate', route: '/projects/:id', name: 'Project page (task list, Get next task)', cases: ['TC-SME-030', 'TC-PM-020'] },
  { app: 'candidate', route: '/tasks/:id', name: 'KYC workbench W00–W06', cases: ['TC-SME-031', 'TC-SME-032', 'TC-SME-033', 'TC-SME-034', 'TC-SME-035', 'TC-SME-036', 'TC-SME-037', 'TC-SME-040', 'TC-SME-041', 'TC-SME-042', 'TC-SME-043', 'TC-SME-044', 'TC-SME-045', 'TC-SME-046', 'TC-SME-047', 'TC-SME-048', 'TC-SME-049', 'TC-SME-050', 'TC-SME-051'], note: 'Annotation (non-KYC) tasks use a generic task page: no dedicated case yet.' },
  { app: 'candidate', route: '/certifications', name: 'Certifications', cases: ['TC-SME-063', 'TC-E2E-009'] },
  { app: 'candidate', route: '/certifications/:id', name: 'Course, selfie check, licence upload', cases: ['TC-SME-063', 'TC-SME-064', 'TC-SME-065', 'TC-SME-079'] },
  { app: 'candidate', route: '/certifications/:id/test', name: 'Test player and result', cases: ['TC-SME-066', 'TC-SME-067', 'TC-SME-068', 'TC-NFR-050', 'TC-NFR-051', 'TC-NFR-053'] },
  { app: 'candidate', route: '/assessments', name: 'Expert reviews', cases: ['TC-SME-075'] },
  { app: 'candidate', route: '/payments', name: 'Payments (set-up, earnings)', cases: ['TC-SME-069', 'TC-SME-070', 'TC-SME-072'] },
  { app: 'candidate', route: '/payee/mock-onboarding', name: 'Simulated payout provider (test only)', cases: ['TC-SME-069'] },
  { app: 'candidate', route: '/privacy', name: 'Privacy notice', cases: ['TC-SME-077'] },
  { app: 'candidate', route: '/terms', name: 'Contributor terms', cases: ['TC-SME-077'] },
];

// docs/user-guide/ROLES-AND-ADMIN.md section 4, one row per Admin function.
export const ADMIN_FUNCTIONS = [
  { fn: 'List console users', where: 'Admin → Users', api: 'GET /api/v1/users', cases: ['TC-ADM-001', 'TC-ADM-002'] },
  { fn: 'Create a console user', where: 'Admin → Users → Add a user (temporary password)', api: 'POST /api/v1/users', cases: ['TC-ADM-001', 'TC-ADM-038', 'TC-E2E-012', 'TC-SEC-010'] },
  { fn: 'Reset a user\'s password (signs out everywhere; not yourself)', where: 'Admin → Users → Reset password', api: 'POST /api/v1/users/:id/password-reset', cases: ['TC-ADM-038', 'TC-ADM-003', 'TC-SEC-030'] },
  { fn: 'Change a user\'s roles (not your own Admin role)', where: 'Admin → Users → Edit roles', api: 'PATCH /api/v1/users/:id/roles', cases: ['TC-ADM-002', 'TC-ADM-003', 'TC-PEN-003'] },
  { fn: 'Disable or re-enable a user (signs out everywhere; not yourself)', where: 'Admin → Users → Disable / Enable', api: 'PATCH /api/v1/users/:id/status', cases: ['TC-ADM-002', 'TC-ADM-003', 'TC-E2E-012'] },
  { fn: 'Domains and templates: create, edit draft, new version, publish, retire, history', where: 'Projects → Templates', api: '/api/v1/domains, /api/v1/templates…', cases: ['TC-ADM-004', 'TC-ADM-027', 'TC-ADM-028', 'TC-PM-012'] },
  { fn: 'Demographic taxonomy', where: 'Admin → Taxonomy', api: 'POST /api/v1/demographic-attributes', cases: ['TC-ADM-005', 'TC-ADM-025'] },
  { fn: 'Contributor terms (new version)', where: 'Admin → Terms', api: 'GET/POST /api/v1/terms', cases: ['TC-ADM-006', 'TC-ADM-026'] },
  { fn: 'RL failure reason codes: add, deactivate', where: 'Admin → Failure codes', api: 'POST/PATCH /api/v1/failure-reason-codes', cases: ['TC-ADM-008'] },
  { fn: 'Machine API keys: create, revoke', where: 'Admin → API clients', api: '/api/v1/api-clients', cases: ['TC-ADM-007', 'TC-ADM-029', 'TC-RLG-006'] },
  { fn: 'Partners: onboard, edit, suspend', where: 'Partners → Partners', api: 'POST /api/v1/partners, PATCH /api/v1/partners/:id', cases: ['TC-ADM-013', 'TC-ADM-014', 'TC-ADM-031'] },
  { fn: 'Partner portal users: add, reset password, disable or enable', where: 'Partners → a partner → Portal users', api: 'POST /api/v1/partners/:id/users, …/password-reset, PATCH …/status', cases: ['TC-ADM-013', 'TC-ADM-030', 'TC-PTR-018'] },
  { fn: 'Partner fee terms', where: 'Partners → a partner', api: 'PUT /api/v1/partners/:id/fee-terms', cases: ['TC-ADM-015', 'TC-FIN-011'] },
  { fn: 'Guidelines: package, upload, source, regenerate, knowledge items', where: 'Certification → Guidelines', api: '/api/v1/guidelines…', cases: ['TC-ADM-016', 'TC-ADM-017', 'TC-ADM-032', 'TC-ADM-033'] },
  { fn: 'Course: edit modules, approve or reject', where: 'Guidelines → a version → Course', api: '/api/v1/courses…', cases: ['TC-ADM-018', 'TC-ADM-019'] },
  { fn: 'Blueprint and item families: edit, samples, approve, reject', where: 'Guidelines → a version → Blueprint', api: '/api/v1/blueprints…, /api/v1/item-families…', cases: ['TC-ADM-018', 'TC-ADM-020', 'TC-REV-037'] },
  { fn: 'Publish a tier\'s course and test', where: 'Guidelines → a version', api: 'POST …/tiers/:tier/publish', cases: ['TC-ADM-019', 'TC-E2E-009'] },
  { fn: 'SME standing or tier change', where: 'No screen (API only)', api: 'POST /api/v1/sme/:id/standing', cases: ['TC-ADM-035'] },
  { fn: 'Approved Task Dataset: browse, export, corrections, verify hash chain', where: 'No screen (API only)', api: '/api/v1/dataset…', cases: ['TC-ADM-009', 'TC-ADM-010', 'TC-ADM-011', 'TC-ADM-034', 'TC-RLG-005', 'TC-SEC-015'] },
  { fn: 'Audit log', where: 'No screen or API', api: '–', cases: [], note: 'Testers cannot read it; cases ask the lead to check entries in the database (e.g. TC-ADM-002, TC-FIN-004).' },
  { fn: 'Everything a PM and a Validator can do, except create projects and approve or submit pay runs', where: 'as above', api: '', cases: ['TC-ADM-012', 'TC-ADM-023', 'TC-ADM-024'] },
  { fn: 'Stop switches: disable user, suspend partner, revoke key, pause or cancel project, retire template, deactivate code', where: 'various', api: '', cases: ['TC-ADM-002', 'TC-ADM-014', 'TC-ADM-030', 'TC-ADM-007', 'TC-PM-020', 'TC-ADM-027', 'TC-ADM-008'] },
];

// Per role: the menu it should see, and refusal of everything else (pages show the No access card, APIs 401/403).
export const ROLES = [
  { role: 'Admin', menu: ['TC-ADM-021', 'TC-ADM-036'], denial: ['TC-ADM-003', 'TC-ADM-023', 'TC-ADM-024', 'TC-SEC-028'] },
  { role: 'PM', menu: ['TC-PM-001', 'TC-PM-013', 'TC-PM-028'], denial: ['TC-PM-011', 'TC-PM-013', 'TC-PM-021', 'TC-SEC-004', 'TC-SEC-026', 'TC-SEC-028', 'TC-PEN-003'] },
  { role: 'Validator', menu: ['TC-REV-030', 'TC-REV-038'], denial: ['TC-REV-001', 'TC-REV-030', 'TC-REV-036', 'TC-SEC-004', 'TC-SEC-006', 'TC-SEC-026', 'TC-SEC-028'] },
  { role: 'Finance', menu: ['TC-FIN-001'], denial: ['TC-FIN-001', 'TC-FIN-013', 'TC-SEC-026', 'TC-SEC-028', 'TC-PM-026'] },
  { role: 'Partner (portal user)', menu: ['TC-PTR-001', 'TC-PTR-014'], denial: ['TC-PTR-001', 'TC-PTR-016', 'TC-SEC-019', 'TC-SEC-026', 'TC-ADM-030'] },
  { role: 'Partner API client', menu: [], denial: ['TC-PTR-011', 'TC-PTR-016', 'TC-PEN-018'] },
  { role: 'SME / candidate', menu: ['TC-SME-073'], denial: ['TC-SEC-005', 'TC-SEC-017', 'TC-SEC-026'] },
  { role: 'RL Gym / client API key', menu: [], denial: ['TC-RLG-005', 'TC-RLG-006', 'TC-ADM-007', 'TC-ADM-029', 'TC-ADM-034'] },
];

// Cross-cutting rules (CLAUDE.md non-negotiables and the Support Bot).
export const RULES = [
  { rule: 'Append-only: dataset records, RL verdicts, earnings, fees, partner history', cases: ['TC-ADM-010', 'TC-ADM-034', 'TC-SEC-015', 'TC-SEC-021', 'TC-FIN-008'] },
  { rule: 'AI never decides: selection, grading, certification, task acceptance', cases: ['TC-REV-002', 'TC-REV-032', 'TC-E2E-010', 'TC-PTR-006', 'TC-SME-014', 'TC-PEN-008'] },
  { rule: 'No identity images, ID numbers, bank or tax data stored', cases: ['TC-SME-002', 'TC-SME-069', 'TC-SME-078', 'TC-SEC-027', 'TC-PM-025'] },
  { rule: 'Synthetic data only (real-data flags, quarantine)', cases: ['TC-SME-035', 'TC-SME-047', 'TC-REV-014', 'TC-SEC-014'] },
  { rule: 'Every change authorised, idempotent and audited', cases: ['TC-SEC-009', 'TC-NFR-031', 'TC-PEN-013', 'TC-ADM-002', 'TC-PM-020'] },
  { rule: 'Support Bot on every console and partner page, cannot act, sees only your data', cases: ['TC-PM-019', 'TC-REV-035', 'TC-FIN-012', 'TC-PTR-013', 'TC-SEC-023', 'TC-SEC-024', 'TC-SEC-025', 'TC-PEN-020'] },
  { rule: 'Validator label (internal role) vs Reviewer (SME tier)', cases: ['TC-ADM-022', 'TC-REV-030', 'TC-PM-022', 'TC-SME-080', 'TC-E2E-003'] },
  { rule: 'Required-field markers', cases: ['TC-PTR-004', 'TC-SME-074', 'TC-ADM-025'] },
];

// Areas still without a scripted case, and why.
export const GAPS = [
  'Annotation (non-KYC) task page in the candidate app: TC-PM-024 and TC-ADM-029 create annotation inputs, but no case walks an SME through annotating one.',
  'Second Finance approver above a threshold (PAYRUN_SECOND_APPROVAL_ABOVE): not set in the test environment, so only the single-approver path is testable (TC-FIN-004).',
  'SME supply switched off ("SME supply is not switched on", "The partner portal is not switched on here"): the shared test environment always has it on.',
  'Production-only services: real Google sign-in, Stripe Identity, the Trolley payout provider, real email and LinkedIn posting are simulated in test.',
  'The nightly dataset hash-chain verification job: runs unattended; only its result through GET /api/v1/dataset/verification is testable (TC-ADM-034).',
  'Console session expiry after 12 hours and the candidate session lifetime: not scripted (exploratory only).',
  'Expert approval of item families once a domain has two certified Experts (TC-SME-075 covers the page; the two-Expert set-up needs a full Expert certification).',
];
