import { KYC_ACCOUNT_OPENING_PROFILE, type ForgeTaskRow, type ProjectPersonDto, type ProjectExportRunDto } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateSignInSettings } from '@/components/forge/candidate-sign-in';
import { ForgeDashboardTab } from '@/components/forge/dashboard-tab';
import { ChangeAuthor, ForgeTaskPage, type ForgeTaskView } from '@/components/forge/task-page';
import { ForgeTasksTab } from '@/components/forge/tasks-tab';
import { ExportPanel, type ExportState } from '@/components/projects/export-panel';
import { changeAuthorState, exportFixHref, recruiterBackHref, rowSelector, selectorName } from '@/lib/forge-console';
import { a11yProblems } from './a11y';
import { project, text } from './helpers';

/** MVP1 step 9: selectors from the API, export fix links, the recruiter back link, Change author, the sign-out note. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), notFound: () => { throw new Error('NOT_FOUND'); } }));
const api = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));
vi.mock('@/lib/api', () => ({
  apiGet: async (path: string) => (path in api.routes ? { status: 200, data: api.routes[path] } : { status: 404, data: null }),
  getCurrentUser: async () => ({ id: 'u1', name: 'Pat PM', roles: ['PM'] }),
  newFlowOn: async () => (api.routes['/admin/forge-settings'] as { newFlow?: boolean } | undefined)?.newFlow === true,
  getForgeSettings: async () => api.routes['/admin/forge-settings'] ?? null,
}));
beforeEach(() => {
  api.routes = {};
});

const PID = '00000000-0000-4000-8000-0000000000aa';
const T = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const TYPES = [
  ['Single', 'SINGLE'],
  ['Joint', 'JOINT'],
  ['Minor', 'MINOR'],
  ['Custodian', 'CUSTODIAN'],
] as const;
/** v7 rows: one per application type; the brief is deliberately unparseable so only the API selector can be used. */
const row = (n: number, o: Partial<ForgeTaskRow> = {}): ForgeTaskRow => ({
  taskId: T(n),
  label: `Reusable task ${n} for the bank.`,
  selector: { field: 'Application type', value: TYPES[n - 1]![1], label: `${TYPES[n - 1]![0]} (${TYPES[n - 1]![1]})` },
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
const TASKS = [1, 2, 3, 4].map((n) => row(n));
const P = project({ id: PID, name: 'KYC v7', status: 'IN_PROGRESS', requiredWorkers: 2 });
const run: ProjectExportRunDto = { id: 'r1', projectId: PID, exportId: 'exp-1', exportSha256: 'a'.repeat(64), reason: 'first export of KYC v7', tasks: [], notSent: [{ recordId: 'rec-1', taskId: T(1), title: 'Single case', code: 'GENERIC_CASE_SELECTOR_MISMATCH', message: 'Fix the case' }], outcome: 'received', httpStatus: 201, requestId: 'req-1', receipt: { new: 0, superseding: 0, unchanged: 0, blocked: [], replayed: false, receiptSha256: null }, error: null, requestedById: 'u1', createdAt: '2026-11-15T10:00:00.000Z' };
const EXPORT: ExportState = {
  canExport: true,
  reason: null,
  connected: true,
  rlgymTemplate: { id: 'tpl_x', version: 7, specSha256: 's'.repeat(64) },
  exported: true,
  tasks: [{ recordId: 'rec-1', taskId: T(1), title: 'Single case', approvedAt: '2026-11-15T10:00:00.000Z', revision: 1, inRlGym: false }],
  runs: [run],
};

describe('coverage selector from the API', () => {
  it('uses the row selector (field and display label); only a row without one falls back to the brief', () => {
    expect(rowSelector(TASKS[1]!)).toEqual({ field: 'Application type', value: 'Joint (JOINT)' });
    expect(selectorName(TASKS)).toBe('application type');
    // An open slot: the API says so; null means the task has no selector.
    expect(rowSelector(row(1, { selector: { field: '', value: '', label: 'Open slot' } }))).toEqual({ field: '', value: 'Open slot' });
    expect(rowSelector(row(1, { selector: null }))).toBeNull();
    // An older API (no selector key): the brief is read, as before.
    const legacy = { label: 'Governing state: Texas (TX). Write this reusable task for Texas only; set Governing state to TX.' };
    expect(rowSelector(legacy)).toEqual({ field: 'Governing state', value: 'Texas (TX)' });
    expect(selectorName([legacy, legacy])).toBe('governing state');
  });

  it('the Dashboard coverage table follows the selector, not the brief', () => {
    const m = renderToStaticMarkup(<ForgeDashboardTab project={P} reviewRoute="SME_PM" requiredWorkers={2} tasks={TASKS} people={[]} dashboard={null} ruleSet={null} exportState={null} attributes={[]} jobDescriptions={[]} />);
    const t = text(m);
    expect(t).toContain('Coverage by application type');
    expect(t).toContain('Application type Task Authored by Status');
    expect(t).toContain('Joint (JOINT) TSK-002');
    expect(t).toContain('Custodian (CUSTODIAN) TSK-004');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('KYC v7 as the API sends it (15 Nov 2026): "Coverage by application type" with the agreed display labels only', () => {
    const v7 = [['individual', 'Single'], ['adult_joint', 'Joint'], ['teen_joint', 'Minor (joint with adult)'], ['custodial', 'Custodian']].map(([value, label], i) => row(i + 1, { selector: { field: 'Application type', value: value!, label: label! } }));
    const m = renderToStaticMarkup(<ForgeDashboardTab project={P} reviewRoute="SME_PM" requiredWorkers={1} tasks={v7} people={[]} dashboard={null} ruleSet={null} exportState={null} attributes={[]} jobDescriptions={[]} />);
    const t = text(m);
    expect(t).toContain('Coverage by application type');
    expect(t).toContain('Single TSK-001');
    expect(t).toContain('Joint TSK-002');
    expect(t).toContain('Minor (joint with adult) TSK-003');
    expect(t).toContain('Custodian TSK-004');
    expect(t).not.toMatch(/adult_joint|teen_joint|custodial|individual/);
  });
});

describe('export fix links and the recruiter back link', () => {
  it('not-sent task links open the new task page in the new flow and Task review otherwise', () => {
    expect(exportFixHref(PID, T(1), true)).toBe(`/projects/${PID}/tasks/${T(1)}/review`);
    expect(exportFixHref(PID, T(1), false)).toBe(`/review/tasks/${T(1)}`);
    expect(renderToStaticMarkup(<ExportPanel projectId={PID} initial={EXPORT} newFlow />)).toContain(`href="/projects/${PID}/tasks/${T(1)}/review"`);
    const old = renderToStaticMarkup(<ExportPanel projectId={PID} initial={EXPORT} />);
    expect(old).toContain(`href="/review/tasks/${T(1)}"`);
    expect(old).not.toContain('/tasks/' + T(1) + '/review');
    // The Tasks tab is the new flow: its export panel links to the new task page.
    const tab = renderToStaticMarkup(<ForgeTasksTab projectId={PID} tasks={TASKS} people={[]} exportState={EXPORT} />);
    expect(tab).toContain(`href="/projects/${PID}/tasks/${T(1)}/review"`);
    expect(tab).not.toContain(`href="/review/tasks/`);
  });

  it('the recruiter page goes back to Resource assignments with the new flow on, else to the project', async () => {
    expect(recruiterBackHref(PID, true)).toBe(`/projects/${PID}?tab=people`);
    expect(recruiterBackHref(PID, false)).toBe(`/projects/${PID}`);
    const { default: RecruiterPackPage } = await import('../app/(console)/projects/[id]/recruiter/page');
    api.routes[`/projects/${PID}/recruiter-pack`] = { projectName: 'KYC v7', fileName: 'x.xlsx', role: {}, requirements: [], cheatSheet: [], questions: [] };
    const page = async () => {
      const el = await RecruiterPackPage({ params: Promise.resolve({ id: PID }) });
      return (el.props.children as { props: { href: string } }[])[0]!.props.href;
    };
    api.routes['/admin/forge-settings'] = { newFlow: true, candidateSignIn: 'OFFLINE', offlineAllowed: true };
    expect(await page()).toBe(`/projects/${PID}?tab=people`);
    api.routes['/admin/forge-settings'] = { newFlow: false, candidateSignIn: 'OFFLINE', offlineAllowed: true };
    expect(await page()).toBe(`/projects/${PID}`);
  });
});

describe('Change author on the task page', () => {
  const MORGAN = { name: 'Morgan Hale', email: 'morgan@gmail.test' };
  const person = (o: Partial<ProjectPersonDto>): ProjectPersonDto => ({ sourcedPersonId: '00000000-0000-4000-8000-000000000201', firstName: 'Morgan', lastName: 'Hale', email: MORGAN.email, role: 'SME', status: 'ASSIGNED', tasks: [], ...o });
  const PEOPLE = [
    person({}),
    person({ sourcedPersonId: '00000000-0000-4000-8000-000000000202', firstName: 'Casey', lastName: 'Nguyen', email: 'casey@gmail.test' }),
    person({ sourcedPersonId: '00000000-0000-4000-8000-000000000203', firstName: 'Jo', lastName: 'Reyes', email: 'jo@gmail.test', role: 'REVIEWER' }),
  ];
  const view = (o: Partial<ForgeTaskView> = {}): ForgeTaskView => ({
    taskId: T(2),
    label: 'Application type: Joint (JOINT). Write this reusable task for Joint only.',
    slotLabel: 'Task 2',
    status: 'ASSIGNED',
    reviewRoute: 'SME_PM',
    reviewStage: null,
    project: { id: PID, name: 'KYC v7' },
    author: MORGAN,
    reviewer: null,
    template: { workflow: 'KYC', profileId: KYC_ACCOUNT_OPENING_PROFILE.profileId, profile: KYC_ACCOUNT_OPENING_PROFILE },
    output: null,
    outputVersion: null,
    versions: [],
    coverageTags: { tags: {}, edgeCase: null },
    reviews: [],
    date: '2026-11-15T09:00:00.000Z',
    canDecide: false,
    waitingFor: null,
    expectedVersion: null,
    expectedRevision: 1,
    checklist: [],
    checklistRequired: true,
    flaggedDuplicate: false,
    confirmCoverage: false,
    ...o,
  });

  it('is shown for Assigned, In progress and Rework tasks with an author; enabled only before the author starts', () => {
    expect(['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK', 'ACCEPTED', 'REJECTED'].map((s) => changeAuthorState(s, true))).toEqual([null, 'enabled', 'started', null, 'started', null, null]);
    expect(changeAuthorState('ASSIGNED', false)).toBeNull();
  });

  it('Assigned: a select of the project’s other SMEs (never the author or a Reviewer) and the Change button', () => {
    const m = renderToStaticMarkup(<ChangeAuthor projectId={PID} view={view()} people={PEOPLE} />);
    expect(m).toContain('data-change-author');
    expect(text(m)).toContain('Change author Choose an SME… Casey Nguyen (casey@gmail.test) Change author…');
    expect(m).not.toContain('Morgan Hale (');
    expect(m).not.toContain('Jo Reyes');
    expect(m).not.toMatch(/<select[^>]* disabled=""/);
    expect(m).not.toContain('data-confirm');
    expect(a11yProblems(m)).toEqual([]);
    // On the full page, above the form.
    const page = renderToStaticMarkup(<ForgeTaskPage code="TSK-002" view={view()} people={PEOPLE} exportState={null} />);
    expect(page.indexOf('data-change-author')).toBeLessThan(page.indexOf('data-section="'));
  });

  it('In progress or Rework: shown disabled with the reason; Open, Submitted and decided tasks have none', () => {
    for (const status of ['IN_PROGRESS', 'REWORK']) {
      const m = renderToStaticMarkup(<ChangeAuthor projectId={PID} view={view({ status })} people={PEOPLE} />);
      expect(m).toMatch(/<select[^>]* disabled=""/);
      expect(text(m)).toContain('The author can be changed only before they start the task.');
    }
    for (const status of ['CREATED', 'SUBMITTED', 'ACCEPTED']) expect(renderToStaticMarkup(<ChangeAuthor projectId={PID} view={view({ status, author: status === 'CREATED' ? null : MORGAN })} people={PEOPLE} />)).toBe('');
    // No other SME on the project: the select says so and is disabled.
    const alone = renderToStaticMarkup(<ChangeAuthor projectId={PID} view={view()} people={PEOPLE.slice(0, 1)} />);
    expect(text(alone)).toContain('No other SMEs on this project');
    expect(alone).toMatch(/<select[^>]* disabled=""/);
  });
});

describe('Admin → Candidate app sign-in note', () => {
  it('says that changing the mode signs everyone out of the candidate app', () => {
    const m = renderToStaticMarkup(<CandidateSignInSettings initial={{ newFlow: true, candidateSignIn: 'OFFLINE', offlineAllowed: true }} canEdit />);
    expect(text(m)).toContain('Changing the sign-in mode signs everyone out of the candidate app');
    expect(text(m)).toContain('Every change is audited.');
  });
});
