import { KYC_ACCOUNT_OPENING_PROFILE, setFieldValue, type ForgeTaskRow, type ProjectPersonDto, type SectionKey } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignScreen } from '@/components/forge/assign-screen';
import { CandidateSignInSettings } from '@/components/forge/candidate-sign-in';
import { ForgeDashboardTab } from '@/components/forge/dashboard-tab';
import { ForgePeopleTab } from '@/components/forge/people-tab';
import { ForgeProjectPage } from '@/components/forge/project-page';
import { ForgeProjectShell } from '@/components/forge/project-shell';
import { ForgeTaskPage, type ForgeTaskView } from '@/components/forge/task-page';
import { ForgeTasksTab } from '@/components/forge/tasks-tab';
import { ProjectSummary } from '@/components/projects/summary';
import {
  assignButtons,
  assignOptions,
  assignProblem,
  decisionBody,
  decisionProblem,
  exportStatusLine,
  nextStep,
  projectTab,
  reviewTrail,
  selectorName,
  settingsUpdate,
  slotSelector,
  taskCode,
  taskName,
  taskStatusLabel,
  taskStatusTone,
  type AssignableData,
  type DecisionForm,
} from '@/lib/forge-console';
import { navGroupsFor } from '@/lib/nav';
import { a11yProblems } from './a11y';
import { project, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), notFound: () => { throw new Error('NOT_FOUND'); } }));

// The server API, answered per path by each test.
const api = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));
vi.mock('@/lib/api', () => ({
  apiGet: async (path: string) => (path in api.routes ? { status: 200, data: api.routes[path] } : { status: 404, data: null }),
  getCurrentUser: async () => ({ id: 'u1', name: 'Pat PM', roles: ['PM'] }),
  newFlowOn: async () => (api.routes['/admin/forge-settings'] as { newFlow?: boolean } | undefined)?.newFlow === true,
  getForgeSettings: async () => api.routes['/admin/forge-settings'] ?? null,
}));

const PID = '00000000-0000-4000-8000-0000000000aa';
const T = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const brief = (state: string, code: string) => `Governing state: ${state} (${code}). Write this reusable task for ${state} only; set Governing state to ${code}.`;
const row = (n: number, o: Partial<ForgeTaskRow> = {}): ForgeTaskRow => ({
  taskId: T(n),
  label: brief(['California', 'New York', 'Texas', 'Florida', 'Illinois'][n - 1]!, ['CA', 'NY', 'TX', 'FL', 'IL'][n - 1]!),
  slotLabel: `Task ${n}`,
  status: 'CREATED',
  smeStatus: 'New',
  author: null,
  reviewer: null,
  reviewStage: null,
  date: '2026-11-15T10:00:00.000Z',
  canDecide: false,
  waitingFor: null,
  ...o,
});
const MORGAN = { name: 'Morgan Hale', email: 'morgan.hale.qa@gmail.test' };
const TASKS: ForgeTaskRow[] = [
  row(1, { status: 'ACCEPTED', smeStatus: 'Accepted', author: MORGAN }),
  row(2, { status: 'SUBMITTED', smeStatus: 'In review', author: MORGAN, canDecide: true }),
  row(3, { status: 'IN_PROGRESS', smeStatus: 'In progress', author: MORGAN }),
  row(4),
  row(5),
];
const person = (o: Partial<ProjectPersonDto>): ProjectPersonDto => ({ sourcedPersonId: '00000000-0000-4000-8000-000000000201', firstName: 'Morgan', lastName: 'Hale', email: MORGAN.email, role: 'SME', status: 'ASSIGNED', tasks: [], ...o });
const PEOPLE: ProjectPersonDto[] = [
  person({ tasks: [{ taskId: T(1), label: TASKS[0]!.label, status: 'ACCEPTED' }, { taskId: T(2), label: TASKS[1]!.label, status: 'SUBMITTED' }] }),
  person({ sourcedPersonId: '00000000-0000-4000-8000-000000000202', firstName: 'Jamie', lastName: 'Okafor', email: 'jamie@gmail.test', role: 'REVIEWER' }),
];
const EXPORT = { canValidate: true, canExport: false, reason: 'Export opens when all 5 tasks are approved (1 of 5 now).', validator: { name: 'praxis-precheck', version: '1', isAnvil: false }, tasks: [{ recordId: '00000000-0000-4000-8000-000000000301', taskId: T(1), title: 'CA', approvedAt: '2026-11-15T10:00:00.000Z' }], runs: [] };
const P = project({ id: PID, name: 'KYC-Of US bank Chicago', status: 'IN_PROGRESS', description: 'KYC workflow for a Chicago bank.', requiredWorkers: 2 });

beforeEach(() => {
  api.routes = {};
});

describe('MVP1 step 8: project page tabs, behind the new flow', () => {
  it('reads ?tab= (default Dashboard) and renders four tab links with the current one marked', () => {
    expect(projectTab(undefined)).toBe('dashboard');
    expect(projectTab('people')).toBe('people');
    expect(projectTab(['tasks'])).toBe('tasks');
    expect(projectTab('nope')).toBe('dashboard');
    const m = renderToStaticMarkup(
      <ForgeProjectShell project={P} tab="tasks" counts={{ people: '1 / 2', tasks: '5', policies: '16 rules' }}>
        <p>body</p>
      </ForgeProjectShell>,
    );
    expect(text(m)).toContain('Dashboard Resource assignments 1 / 2 Tasks 5 Policies 16 rules');
    expect(m).toContain(`href="/projects/${PID}?tab=people"`);
    expect(m).toContain(`href="/projects/${PID}"`);
    expect(m).toMatch(/aria-current="page"[^>]*data-tab="tasks"/);
    expect(text(m)).toContain('Pause project');
    expect(a11yProblems(m)).toEqual([]);
    const staffing = text(renderToStaticMarkup(<ForgeProjectShell project={{ ...P, status: 'STAFFING' }} tab="dashboard" counts={{}}>{null}</ForgeProjectShell>));
    expect(staffing).toContain('Cancel project');
    expect(staffing).not.toContain('Pause project');
  });

  it('with the new flow off a submitted project keeps the old summary; on, it opens the four-tab page; a draft keeps the wizard', async () => {
    const { default: ProjectPage } = await import('../app/(console)/projects/[id]/page');
    api.routes[`/projects/${PID}`] = P;
    api.routes['/admin/forge-settings'] = { newFlow: false, candidateSignIn: 'OFFLINE', offlineAllowed: true };
    const off = await ProjectPage({ params: Promise.resolve({ id: PID }), searchParams: Promise.resolve({}) });
    expect(off.type).toBe(ProjectSummary);
    api.routes['/admin/forge-settings'] = { newFlow: true, candidateSignIn: 'OFFLINE', offlineAllowed: true };
    const on = await ProjectPage({ params: Promise.resolve({ id: PID }), searchParams: Promise.resolve({ tab: 'tasks' }) });
    expect(on.type).toBe(ForgeProjectPage);
    expect(on.props.tab).toBe('tasks');
    api.routes[`/projects/${PID}`] = { ...P, status: 'DRAFT' };
    const draft = await ProjectPage({ params: Promise.resolve({ id: PID }), searchParams: Promise.resolve({}) });
    expect(draft.type.name).toBe('ProjectWizard');
  });

  it('the four-tab page loads the people, tasks and rule set for the tab counts', async () => {
    api.routes[`/projects/${PID}/people`] = { reviewRoute: 'SME_PM', requiredWorkers: 2, items: PEOPLE };
    api.routes[`/projects/${PID}/forge-tasks`] = { reviewRoute: 'SME_PM', items: TASKS };
    api.routes[`/projects/${PID}/policy/rule-sets`] = { items: [{ version: 1, ruleCount: 16 }] };
    api.routes[`/projects/${PID}/export`] = EXPORT;
    const el = await ForgeProjectPage({ project: P, tab: 'tasks' });
    const m = renderToStaticMarkup(el);
    expect(text(m)).toContain('Resource assignments 1 / 2');
    expect(text(m)).toContain('Tasks 5');
    expect(text(m)).toContain('Policies 16 rules');
    expect(text(m)).toContain('5 tasks set for this project · 1 approved · 1 waiting for review');
    expect(m).not.toContain('could not be loaded');
  });
});

describe('Tasks tab', () => {
  it('maps the seven statuses and gives stable short task IDs and names', () => {
    expect(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'REWORK', 'REJECTED'].map(taskStatusLabel)).toEqual(['Open', 'Assigned', 'In progress', 'Submitted', 'Approved', 'Rework', 'Rejected']);
    expect(taskStatusTone('ACCEPTED')).toBe('pill-success');
    expect(taskStatusTone('REJECTED')).toBe('pill-error');
    expect(taskStatusTone('CREATED')).toBe('');
    expect(taskCode(0)).toBe('TSK-001');
    expect(taskCode(11)).toBe('TSK-012');
    expect(taskName(TASKS[0]!.label)).toBe('Governing state: California (CA)');
  });

  it('one row per task; "Assign SME…" lists the assigned SMEs only on Open rows; names link to the task page', () => {
    const m = renderToStaticMarkup(<ForgeTasksTab projectId={PID} tasks={TASKS} people={PEOPLE} exportState={EXPORT} />);
    expect(m.match(/data-task="/g)).toHaveLength(5);
    expect(text(m)).toContain('Task ID Task name Authored by Status Date');
    expect(text(m)).toContain('TSK-001 Governing state: California (CA) Morgan Hale Approved 2026-11-15');
    expect(m.match(/data-assign-sme=/g)).toHaveLength(2);
    expect(m).toContain(`data-assign-sme="${T(4)}"`);
    expect(m).toContain(`data-assign-sme="${T(5)}"`);
    expect(m).not.toContain(`data-assign-sme="${T(3)}"`);
    expect(text(m)).toContain('Assign SME… Morgan Hale');
    expect(text(m)).not.toMatch(/Assign SME…[^]*Jamie Okafor/);
    expect(m).toContain(`href="/projects/${PID}/tasks/${T(2)}/review"`);
    expect(text(m)).toContain('Your decision');
    expect(text(m)).toContain('Export to RL Gym');
    expect(text(m)).toContain('Export opens when all 5 tasks are approved (1 of 5 now).');
    expect(a11yProblems(m)).toEqual([]);
  });
});

describe('Dashboard and Resource assignments tabs', () => {
  it('reads the selector from the slot brief for the coverage table', () => {
    expect(slotSelector(TASKS[1]!.label)).toEqual({ field: 'Governing state', value: 'New York (NY)' });
    expect(slotSelector('Application type: Joint (JOINT). Write this reusable task for Joint only; set Application type to JOINT.')).toEqual({ field: 'Application type', value: 'Joint (JOINT)' });
    expect(slotSelector('State: CA · Edge case: expired ID')).toEqual({ field: 'State', value: 'CA' });
    expect(slotSelector('Open slot: bring a realistic case from your own experience.')?.value).toBe('Open slot');
    expect(selectorName(TASKS)).toBe('governing state');
  });

  it('Next step points at whatever is blocking', () => {
    const base = { projectId: PID, smesAssigned: 2, requiredWorkers: 2 };
    expect(nextStep({ ...base, tasks: TASKS }).text).toBe('TSK-002 is waiting for your decision.');
    expect(nextStep({ ...base, tasks: TASKS }).href).toBe(`/projects/${PID}/tasks/${T(2)}/review`);
    const noDecision = TASKS.map((t) => ({ ...t, canDecide: false }));
    expect(nextStep({ ...base, smesAssigned: 1, tasks: noDecision })).toMatchObject({ text: '1 more expert is needed (1 of 2 assigned).', href: `/projects/${PID}/assign` });
    expect(nextStep({ ...base, tasks: noDecision }).text).toBe('2 tasks have no author yet.');
    expect(nextStep({ ...base, tasks: TASKS.map((t) => ({ ...t, status: 'ACCEPTED', canDecide: false })) }).text).toBe('All 5 tasks are approved.');
    expect(exportStatusLine(EXPORT)).toBe('Not exported · opens when all 5 tasks are approved (1 of 5 now)');
  });

  it('Dashboard: summary cards, Next step, coverage by state and project details with route, reviewers and export', () => {
    const m = renderToStaticMarkup(
      <ForgeDashboardTab
        project={P}
        reviewRoute="SME_PM"
        requiredWorkers={2}
        tasks={TASKS}
        people={PEOPLE}
        dashboard={{ reworkRate: 0, tpt: { targetMinutes: 60, averageActiveMinutes: 52 } }}
        ruleSet={{ version: 1, ruleCount: 16 }}
        exportState={EXPORT}
        attributes={[]}
        jobDescriptions={[]}
      />,
    );
    const t = text(m);
    expect(t).toContain('Experts 1 / 2 assigned');
    expect(t).toContain('Tasks approved 1 / 5 1 waiting for review');
    expect(t).toContain('Rule set v1 16 rules · published');
    expect(t).toContain('Rework rate 0% active time 52 / 60 min');
    expect(t).toContain('Next step TSK-002 is waiting for your decision.');
    expect(t).toContain('Coverage by governing state');
    expect(t).toContain('California (CA) TSK-001 Morgan Hale Approved');
    expect(m.match(/data-coverage-row/g)).toHaveLength(5);
    expect(t).toContain('Review route Author → PM/Admin · chosen at project creation, read-only');
    expect(t).toContain('Reviewers Not used: this project&#x27;s review route has no Reviewer step');
    expect(t).toContain('Export to RL Gym Not exported · opens when all 5 tasks are approved (1 of 5 now)');
    expect(t).toContain('Required workers 2');
    expect(t.indexOf('Export to RL Gym')).toBeLessThan(t.indexOf('Submitted —'));
    const two = text(renderToStaticMarkup(<ForgeDashboardTab project={P} reviewRoute="SME_EXPERT_PM" requiredWorkers={2} tasks={TASKS} people={PEOPLE} dashboard={null} ruleSet={null} exportState={null} attributes={[]} jobDescriptions={[]} />));
    expect(two).toContain('Reviewers Jamie Okafor (Reviewer) · Assign · PM or Admin assigns');
    expect(two).toContain('Rule set — not published yet');
  });

  it('Resource assignments: toolbar, buttons and the people table with each task', () => {
    const m = renderToStaticMarkup(<ForgePeopleTab projectId={PID} reviewRoute="SME_PM" requiredWorkers={2} people={PEOPLE.slice(0, 1)} tasks={TASKS} />);
    const t = text(m);
    expect(t).toContain('1 of 2 SMEs assigned (Required workers)');
    expect(m).toContain(`href="/projects/${PID}/recruiter"`);
    expect(m).toContain(`href="/projects/${PID}/assign"`);
    expect(t).toContain('First name Last name Email Role Status Task ID Task status');
    expect(t).toContain('Morgan Hale morgan.hale.qa@gmail.test SME Assigned TSK-001 TSK-002 Approved Submitted');
    expect(t).toContain('Review route Author → PM/Admin: you can assign SMEs only.');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('D1: sourced SMEs without a task are listed with the reason, never hidden', () => {
    const full = text(renderToStaticMarkup(<ForgePeopleTab projectId={PID} reviewRoute="SME_PM" requiredWorkers={2} people={PEOPLE.slice(0, 1)} tasks={TASKS} withoutTask={{ openTasks: 0, items: [{ sourcedPersonId: 'sp5', firstName: 'Fifth', lastName: 'Person', email: 'fifth@gmail.test' }] }} />));
    expect(full).toContain('Fifth Person fifth@gmail.test SME No task No open task left: every task is assigned.');
    const open = text(renderToStaticMarkup(<ForgePeopleTab projectId={PID} reviewRoute="SME_PM" requiredWorkers={2} people={[]} tasks={TASKS} withoutTask={{ openTasks: 2, items: [{ sourcedPersonId: 'sp5', firstName: 'Fifth', lastName: 'Person', email: 'fifth@gmail.test' }] }} />));
    expect(open).toContain('Not assigned yet. Use Assign.');
    expect(open).not.toContain('No one assigned yet');
  });
});

const ASSIGNABLE: AssignableData = {
  reviewRoute: 'SME_PM',
  requiredWorkers: 2,
  smePlacesUsed: 1,
  smePlacesFull: false,
  projectSkills: ['Consumer deposit KYC', 'Evidence-based investigation'],
  openTasks: [
    { taskId: T(4), label: TASKS[3]!.label, status: 'CREATED' },
    { taskId: T(5), label: TASKS[4]!.label, status: 'CREATED' },
  ],
  reviewableTasks: [{ taskId: T(3), label: TASKS[2]!.label, status: 'IN_PROGRESS' }],
  people: [
    { sourcedPersonId: '00000000-0000-4000-8000-000000000401', firstName: 'Casey', lastName: 'Nguyen', email: 'casey@gmail.test', role: 'SME', assessed: true, matchingSkills: [{ skill: 'Consumer deposit KYC', matched: true }, { skill: 'Evidence-based investigation', matched: false }], reviewableTaskIds: [] },
    { sourcedPersonId: '00000000-0000-4000-8000-000000000402', firstName: 'Jo', lastName: 'Reyes', email: 'jo@gmail.test', role: 'REVIEWER', assessed: false, matchingSkills: [], reviewableTaskIds: [T(3)] },
  ],
};

describe('Assign screen', () => {
  it('needs a task, from the right group', () => {
    expect(assignProblem('SME', '', ASSIGNABLE)).toBe('Choose a task to author.');
    expect(assignProblem('SME', T(3), ASSIGNABLE)).toBe('Choose a task to author.');
    expect(assignProblem('SME', T(4), ASSIGNABLE)).toBeNull();
    expect(assignProblem('REVIEWER', T(4), ASSIGNABLE)).toBe('Choose a task to review.');
    expect(assignProblem('REVIEWER', T(3), ASSIGNABLE)).toBeNull();
  });

  it('Assign as SME is hidden when places are full; reviewer options and buttons only on the Reviewer route', () => {
    const sme = ASSIGNABLE.people[0]!;
    const rev = ASSIGNABLE.people[1]!;
    expect(assignButtons(ASSIGNABLE, sme)).toEqual({ sme: true, smeFull: false, reviewer: false });
    expect(assignButtons({ ...ASSIGNABLE, smePlacesFull: true }, sme)).toEqual({ sme: false, smeFull: true, reviewer: false });
    expect(assignButtons(ASSIGNABLE, rev).reviewer).toBe(false);
    expect(assignButtons({ ...ASSIGNABLE, reviewRoute: 'SME_EXPERT_PM' }, rev)).toEqual({ sme: false, smeFull: false, reviewer: true });
    expect(assignOptions(ASSIGNABLE, sme).map((g) => g.label)).toEqual(['To author (SME)']);
    expect(assignOptions(ASSIGNABLE, rev)).toEqual([]);
    expect(assignOptions({ ...ASSIGNABLE, reviewRoute: 'SME_EXPERT_PM' }, rev).map((g) => [g.label, g.tasks.map((t) => t.taskId)])).toEqual([['To review (Reviewer)', [T(3)]]]);
  });

  it('renders the skills note, the table and the buttons; "SME places full" when full', () => {
    const codes = { [T(4)]: 'TSK-004', [T(5)]: 'TSK-005', [T(3)]: 'TSK-003' };
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="KYC-Of US bank Chicago" data={ASSIGNABLE} codes={codes} />);
    const t = text(m);
    expect(t).toContain('Consumer deposit KYC, Evidence-based investigation');
    expect(t).toContain('First name Last name Email Matching skills Task *');
    expect(t).toContain('Casey Nguyen casey@gmail.test Consumer deposit KYC');
    expect(t).toContain('TSK-004 · Governing state: Florida (FL)');
    expect(m.match(/>Assign as SME</g)).toHaveLength(1);
    expect(m).not.toContain('Assign as Reviewer');
    expect(m).toContain(`href="/projects/${PID}?tab=people"`);
    expect(a11yProblems(m)).toEqual([]);
    const full = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={{ ...ASSIGNABLE, smePlacesFull: true, reviewRoute: 'SME_EXPERT_PM' }} codes={codes} />);
    expect(full).toContain('SME places full');
    expect(full).not.toContain('>Assign as SME<');
    expect(full).toContain('Assign as Reviewer');
    expect(full).toContain('label="To review (Reviewer)"');
  });
});

const form = (o: Partial<DecisionForm> = {}): DecisionForm => ({ comments: [{ section: 'S1', text: '' }], notes: '', rejectReason: '', checklist: {}, duplicateOk: false, coverageOk: false, edgeCase: '', ...o });
const NEEDS = { checklistKeys: ['realistic', 'correct'], checklistRequired: true, duplicateNeeded: false, confirmCoverage: false };

describe('Task page decision box', () => {
  it('Rework and Reject need a comment; Reject needs a reason; Approve needs the checklist', () => {
    expect(decisionProblem('REWORK', form(), NEEDS)).toMatch(/Add a comment for the author/);
    expect(decisionProblem('REJECT', form(), NEEDS)).toMatch(/Add a comment for the author/);
    expect(decisionProblem('REWORK', form({ comments: [{ section: 'S5', text: 'Step 2 needs the CIP check.' }] }), NEEDS)).toBeNull();
    expect(decisionProblem('REWORK', form({ notes: 'See S5.' }), NEEDS)).toBeNull();
    expect(decisionProblem('REJECT', form({ comments: [{ section: 'S1', text: 'Real data.' }] }), NEEDS)).toBe('Choose a reason for rejecting.');
    expect(decisionProblem('REJECT', form({ comments: [{ section: 'S1', text: 'Real data.' }], rejectReason: 'REAL_DATA' }), NEEDS)).toBeNull();
    expect(decisionProblem('APPROVE', form({ checklist: { realistic: true } }), NEEDS)).toMatch(/checklist/);
    expect(decisionProblem('APPROVE', form({ checklist: { realistic: true, correct: true } }), NEEDS)).toBeNull();
    expect(decisionProblem('APPROVE', form(), { ...NEEDS, checklistRequired: false })).toBeNull();
    expect(decisionProblem('APPROVE', form(), { ...NEEDS, checklistRequired: false, duplicateNeeded: true })).toMatch(/distinct/);
    expect(decisionProblem('APPROVE', form({ coverageOk: true }), { ...NEEDS, checklistRequired: false, confirmCoverage: true })).toMatch(/coverage/);
  });

  it('builds the decision body with the expected version and revision', () => {
    const b = decisionBody('REJECT', form({ comments: [{ section: 'S2', text: ' Duplicate of TSK-001. ' }, { section: 'S3', text: ' ' }], rejectReason: 'DUPLICATE' }), { ...NEEDS, checklistRequired: false, flaggedDuplicate: true, coverageTags: {} }, { version: 2, revision: 7 });
    expect(b).toEqual({ decision: 'REJECT', expectedVersion: 2, expectedRevision: 7, comments: [{ section: 'S2', text: 'Duplicate of TSK-001.' }], rejectReason: 'DUPLICATE', duplicateDecision: 'REJECT_DUPLICATE' });
    const a = decisionBody('APPROVE', form({ checklist: { realistic: true, correct: true }, edgeCase: 'expired ID' }), { ...NEEDS, confirmCoverage: true, flaggedDuplicate: false, coverageTags: { state: 'NY' } }, { version: 1, revision: 3 });
    expect(a).toMatchObject({ decision: 'APPROVE', checklist: { realistic: true, correct: true }, confirmedCoverage: { tags: { state: 'NY' }, edgeCase: 'expired ID' } });
    expect(a).not.toHaveProperty('rejectReason');
  });

  const profile = KYC_ACCOUNT_OPENING_PROFILE;
  const s1 = profile.sections[0]!;
  const titleField = s1.fields.find((f) => f.type === 'text')!;
  const output = setFieldValue(profile, { profile: { id: profile.profileId, version: profile.version }, sections: {} }, s1.key as SectionKey, titleField.key, 'Joint checking, one expired licence');
  const view = (o: Partial<ForgeTaskView> = {}): ForgeTaskView => ({
    taskId: T(2),
    label: TASKS[1]!.label,
    slotLabel: 'Task 2',
    status: 'SUBMITTED',
    reviewRoute: 'SME_PM',
    reviewStage: null,
    project: { id: PID, name: 'KYC-Of US bank Chicago' },
    author: MORGAN,
    reviewer: null,
    template: { workflow: 'KYC', profileId: profile.profileId, profile },
    output,
    outputVersion: 1,
    versions: [{ version: 1, submittedAt: '2026-11-15T09:00:00.000Z' }],
    coverageTags: { tags: { governing_state: 'NY' }, edgeCase: null },
    reviews: [],
    date: '2026-11-15T09:00:00.000Z',
    canDecide: true,
    waitingFor: null,
    expectedVersion: 1,
    expectedRevision: 4,
    checklist: [{ key: 'realistic', label: 'Realistic' }],
    checklistRequired: true,
    flaggedDuplicate: false,
    confirmCoverage: false,
    ...o,
  });

  it('renders the authored form section by section, the review trail and the decision box when it is my turn', () => {
    const m = renderToStaticMarkup(<ForgeTaskPage code="TSK-002" view={view()} people={PEOPLE} exportState={EXPORT} />);
    const t = text(m);
    expect(t).toContain('TSK-002 · Governing state: New York (NY) Submitted');
    expect(m.match(/data-section="/g)).toHaveLength(8);
    expect(t).toContain(`${titleField.label} Joint checking, one expired licence`);
    expect(t).toContain('Submitted. Waiting for review.');
    expect(t).toContain('Author Morgan Hale Submitted 15 Nov 2026');
    expect(t).toContain('PM/Admin PM or Admin Final decision');
    expect(t).not.toMatch(/\bReviewer Not assigned\b/);
    expect(m).toContain('data-decision-box');
    expect(m).toContain('data-checklist');
    expect(t).toContain('Approve Rework Reject');
    expect(m).not.toContain('data-validate');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('shows "Waiting for the Reviewer" instead of the box on the Reviewer route; an Open task shows empty fields', () => {
    const w = renderToStaticMarkup(<ForgeTaskPage code="TSK-002" view={view({ reviewRoute: 'SME_EXPERT_PM', reviewStage: 'EXPERT_REVIEW', canDecide: false, waitingFor: 'REVIEWER', reviewer: { name: 'Jamie Okafor', email: 'jamie@gmail.test' } })} people={PEOPLE} exportState={EXPORT} />);
    expect(w).not.toContain('data-decision-box');
    expect(text(w)).toContain('Waiting for the Reviewer.');
    expect(text(w)).toContain('Reviewer Jamie Okafor Waiting');
    const open = renderToStaticMarkup(<ForgeTaskPage code="TSK-004" view={view({ status: 'CREATED', author: null, output: null, versions: [], canDecide: false, expectedVersion: null })} people={PEOPLE} exportState={EXPORT} />);
    expect(text(open)).toContain('Not assigned yet. The form fills in once an expert is assigned');
    expect(open).not.toContain('data-review-card');
    expect(open).not.toContain('Joint checking');
  });

  it('an approved task shows the decision and the Validate card with the latest result', () => {
    const reviews = [{ id: 'r1', by: 'Platform Admin', decision: 'ACCEPT', stage: null, comments: [], notes: null, rejectReason: null, version: 1, at: '2026-11-15T11:00:00.000Z' }];
    const run = { id: 'v1', projectId: PID, kind: 'VALIDATE' as const, validator: 'praxis-precheck', validatorVersion: '1', results: [{ recordId: EXPORT.tasks[0]!.recordId, taskId: T(1), title: 'CA', status: 'valid' as const, issues: [] }], counts: { valid: 1, needsFix: 0, notValidated: 0 }, requestedById: 'u1', createdAt: '2026-11-15T11:02:00.000Z', downloadPath: null, anvil: null };
    const m = renderToStaticMarkup(<ForgeTaskPage code="TSK-001" view={view({ taskId: T(1), status: 'ACCEPTED', canDecide: false, reviews })} people={PEOPLE} exportState={{ ...EXPORT, runs: [run] }} />);
    const t = text(m);
    expect(t).toContain('Approved on 15 Nov 2026 by Platform Admin. Added to the approved dataset.');
    expect(m).toContain('data-validate');
    expect(t).toContain('Validate Valid 2026-11-15 11:02 · 0 fixes');
    expect(t).toContain('PM/Admin Platform Admin Approved 15 Nov 2026');
    expect(m).not.toContain('data-decision-box');
  });

  it('Send back for rework (owner, 23 Nov 2026): an approved task offers it to the PM/Admin, with what happens to the approved version', () => {
    const m = renderToStaticMarkup(<ForgeTaskPage code="TSK-001" view={view({ taskId: T(1), status: 'ACCEPTED', canDecide: false, canSendBack: true })} people={PEOPLE} exportState={EXPORT} />);
    const t = text(m);
    expect(m).toContain('data-send-back');
    expect(t).toContain('Send back for rework');
    expect(t).toContain('The approved version stays in the dataset as it is');
    expect(a11yProblems(m)).toEqual([]);
    // Not offered on a task that is not approved, or to its author.
    expect(renderToStaticMarkup(<ForgeTaskPage code="TSK-001" view={view({ taskId: T(1), status: 'ACCEPTED', canDecide: false, canSendBack: false })} people={PEOPLE} exportState={EXPORT} />)).not.toContain('data-send-back');
    expect(renderToStaticMarkup(<ForgeTaskPage code="TSK-002" view={view()} people={PEOPLE} exportState={EXPORT} />)).not.toContain('data-send-back');
  });

  it('Correct this approved task (owner, 24 Nov 2026): a PM/Admin small fix without an SME; fields listed by section; lines for lists', async () => {
    const { correctableFields } = await import('@/components/forge/task-page');
    const out = { sections: { S3: { tools: ['application.read'], environment: 'golden_kyc_openenv' }, S1: { title: 'Custodial KYC' }, S5: { steps: [{ tool: 'recommend' }] } } };
    expect(correctableFields(out).map((f) => [f.section, f.field, f.kind])).toEqual([['S1', 'title', 'text'], ['S3', 'tools', 'lines'], ['S3', 'environment', 'text'], ['S5', 'steps', 'json']]);
    const m = renderToStaticMarkup(<ForgeTaskPage code="TSK-001" view={view({ taskId: T(1), status: 'ACCEPTED', canDecide: false, canCorrect: true, output: out })} people={PEOPLE} exportState={EXPORT} />);
    const t = text(m);
    expect(m).toContain('data-correct');
    expect(t).toContain('Correct this approved task');
    expect(t).toContain('the earlier approved version is kept');
    expect(a11yProblems(m)).toEqual([]);
    expect(renderToStaticMarkup(<ForgeTaskPage code="TSK-001" view={view({ taskId: T(1), status: 'ACCEPTED', canDecide: false, canCorrect: false, output: out })} people={PEOPLE} exportState={EXPORT} />)).not.toContain('data-correct');
  });

  it('trail on the Reviewer route: Author → Reviewer → PM/Admin', () => {
    const steps = reviewTrail({
      status: 'SUBMITTED',
      reviewRoute: 'SME_EXPERT_PM',
      reviewStage: 'PM_APPROVAL',
      author: MORGAN,
      reviewer: { name: 'Jamie Okafor' },
      versions: [{ submittedAt: '2026-11-15T09:00:00.000Z' }],
      reviews: [{ by: 'Jamie Okafor', decision: 'PASS', stage: 'EXPERT_REVIEW', at: '2026-11-15T10:00:00.000Z' }],
    });
    expect(steps.map((s) => [s.role, s.who, s.state])).toEqual([
      ['Author', 'Morgan Hale', 'done'],
      ['Reviewer', 'Jamie Okafor', 'done'],
      ['PM/Admin', 'PM or Admin', 'current'],
    ]);
    expect(steps[1]!.note).toBe('Passed 15 Nov 2026');
  });
});

describe('Menus and Admin → Candidate app sign-in', () => {
  const keys = (g: ReturnType<typeof navGroupsFor>) => g.map((x) => x.key);
  it('Tutorials is in the menu only while TUTORIALS_ENABLED is on (owner, 27 Nov 2026)', () => {
    vi.stubEnv('TUTORIALS_ENABLED', '');
    expect(keys(navGroupsFor(['ADMIN'], true, true))).toEqual(['home', 'projects', 'templates', 'sourcing', 'admin']);
    expect(keys(navGroupsFor(['REVIEWER'], false, true))).toEqual(['home']);
    vi.stubEnv('TUTORIALS_ENABLED', 'true');
    expect(keys(navGroupsFor(['ADMIN'], true, true))).toContain('tutorials');
    vi.unstubAllEnvs();
  });

  it('with the new flow on the menu is Home, Projects, Templates (D-024), Sourcing, Admin, Tutorials; Certification, Partners and Payments are always hidden', () => {
    vi.stubEnv('TUTORIALS_ENABLED', 'true');
    expect(keys(navGroupsFor(['ADMIN'], true, true))).toEqual(['home', 'projects', 'templates', 'sourcing', 'admin', 'tutorials']);
    const projects = navGroupsFor(['ADMIN', 'PM'], true, true).find((g) => g.key === 'projects')!;
    expect(projects.items.map((i) => i.label)).toEqual(['Projects', 'Approved exports']);
    expect(navGroupsFor(['PM'], true, true).find((g) => g.key === 'templates')!.items.map((i) => i.href)).toEqual(['/templates']);
    // Owner, 15 Nov: Certification, Partners and Payments are hidden from the menu with the flow on or off.
    expect(keys(navGroupsFor(['ADMIN'], true, false))).toEqual(['home', 'projects', 'templates', 'sourcing', 'reviews', 'admin', 'tutorials']);
    for (const flow of [true, false]) for (const k of ['certification', 'partners', 'payments']) expect(keys(navGroupsFor(['FINANCE', 'ADMIN', 'PM', 'REVIEWER'], true, flow))).not.toContain(k);
    expect(navGroupsFor(['ADMIN'], false, false).find((g) => g.key === 'admin')!.items.map((i) => i.label)).toEqual(['Users', 'Taxonomy', 'Terms', 'Failure codes', 'API clients', 'Candidate app sign-in']);
    // PMs read the setting only with the new flow on; Reviewers lose the Reviews menu with it.
    expect(keys(navGroupsFor(['PM'], false, false))).not.toContain('admin');
    expect(navGroupsFor(['PM'], false, true).find((g) => g.key === 'admin')!.items.map((i) => i.href)).toEqual(['/admin/candidate-sign-in']);
    expect(keys(navGroupsFor(['REVIEWER'], false, true))).toEqual(['home', 'tutorials']);
    vi.unstubAllEnvs();
  });

  it('Offline is disabled with an explanation when the server refuses it; PMs see it read-only; Save sends only changes', () => {
    const admin = renderToStaticMarkup(<CandidateSignInSettings initial={{ newFlow: false, candidateSignIn: 'OFFLINE', offlineAllowed: true }} canEdit />);
    expect(text(admin)).toContain('Offline QA and demos only');
    expect(text(admin)).toContain('Never use Offline in production.');
    const offline = (m: string) => /<input[^>]*data-mode="OFFLINE"[^>]*>/.exec(m)![0];
    expect(offline(admin)).toContain('checked=""');
    expect(offline(admin)).not.toContain('disabled');
    expect(admin).not.toContain('data-offline-refused');
    expect(text(admin)).toContain('one-time link to set their password');
    expect(text(admin)).toContain('signs everyone out of the candidate app');
    expect(admin).toContain('>Save<');
    expect(a11yProblems(admin)).toEqual([]);
    const prod = renderToStaticMarkup(<CandidateSignInSettings initial={{ newFlow: true, candidateSignIn: 'ONLINE', offlineAllowed: false }} canEdit />);
    expect(offline(prod)).toContain('disabled=""');
    expect(prod).toContain('data-offline-refused');
    expect(prod).not.toContain('data-offline-warning');
    const pm = renderToStaticMarkup(<CandidateSignInSettings initial={{ newFlow: true, candidateSignIn: 'ONLINE', offlineAllowed: true }} canEdit={false} />);
    expect(pm).toContain('data-read-only');
    expect(pm).not.toContain('>Save<');
    expect(settingsUpdate({ newFlow: false, candidateSignIn: 'OFFLINE' }, { newFlow: true, candidateSignIn: 'OFFLINE' })).toEqual({ newFlow: true });
    expect(settingsUpdate({ newFlow: true, candidateSignIn: 'OFFLINE' }, { newFlow: true, candidateSignIn: 'ONLINE' })).toEqual({ candidateSignIn: 'ONLINE' });
  });
});
