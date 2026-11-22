import type { ForgeComment, ForgeTaskRow, ProjectPersonDto, TaskRejectReason } from '@praxis/shared';

/**
 * MVP1 step 8: pure helpers for the console's new-flow screens (docs/design/PROJECT-SCREEN-DESIGN.md and
 * docs/design/mockups/project-screen.html): the project tabs, Tasks table, Assign screen and the task page.
 */

export type ReviewRoute = 'SME_PM' | 'SME_EXPERT_PM';

/** GET /admin/forge-settings. */
export interface ForgeSettingsView {
  newFlow: boolean;
  candidateSignIn: 'OFFLINE' | 'ONLINE';
  /** False when the server refuses Offline sign-in (production). */
  offlineAllowed: boolean;
  /** PUT only: candidate-app sessions signed out because the sign-in mode changed. */
  candidateSessionsEnded?: number;
}

/** The Save body: only what changed, so a stored Offline mode never blocks switching the flow where Offline is refused. */
export function settingsUpdate(initial: Pick<ForgeSettingsView, 'newFlow' | 'candidateSignIn'>, next: Pick<ForgeSettingsView, 'newFlow' | 'candidateSignIn'>) {
  return {
    ...(next.newFlow !== initial.newFlow ? { newFlow: next.newFlow } : {}),
    ...(next.candidateSignIn !== initial.candidateSignIn ? { candidateSignIn: next.candidateSignIn } : {}),
  };
}

export const PROJECT_TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'people', label: 'Resource assignments' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'policies', label: 'Policies' },
  { key: 'benchmark', label: 'Benchmark review' },
  { key: 'needs', label: 'SME needs' },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]['key'];

/** `?tab=` value to a tab; anything else is the Dashboard. */
export function projectTab(v: string | string[] | undefined): ProjectTab {
  const s = Array.isArray(v) ? v[0] : v;
  return PROJECT_TABS.some((t) => t.key === s) ? (s as ProjectTab) : 'dashboard';
}

export const tabHref = (projectId: string, tab: ProjectTab) => (tab === 'dashboard' ? `/projects/${projectId}` : `/projects/${projectId}?tab=${tab}`);

/** The seven task statuses as the console shows them (owner, 15 Nov), with the pill tone of the mockup. */
const TASK_STATUS: Record<string, [string, string]> = {
  CREATED: ['Open', ''],
  ASSIGNED: ['Assigned', 'pill-info'],
  IN_PROGRESS: ['In progress', 'pill-info'],
  SUBMITTED: ['Submitted', 'pill-warning'],
  ACCEPTED: ['Approved', 'pill-success'],
  REWORK: ['Rework', 'pill-warning'],
  REJECTED: ['Rejected', 'pill-error'],
};
export const taskStatusLabel = (s: string) => TASK_STATUS[s]?.[0] ?? s;
export const taskStatusTone = (s: string) => TASK_STATUS[s]?.[1] ?? '';

/** Short stable task ID by slot order: TSK-001, TSK-002, ... (the API lists tasks in slot order). */
export const taskCode = (index: number) => `TSK-${String(index + 1).padStart(3, '0')}`;

/** taskId -> TSK-00n, from the Tasks list. */
export function taskCodes(rows: Pick<ForgeTaskRow, 'taskId'>[]): Map<string, string> {
  return new Map(rows.map((r, i) => [r.taskId, taskCode(i)]));
}

/**
 * The task name shown in tables: the first sentence of the slot brief ("Governing state: California (CA)"), which is
 * the task label the API gives until the author writes a title.
 */
export function taskName(label: string): string {
  const first = label.split(/\.\s/)[0]!.trim();
  return first.replace(/\.$/, '') || label;
}

/**
 * The coverage selector of one task, read from its slot brief: "Governing state: California (CA). Write ..." gives
 * field "Governing state", value "California (CA)"; a dimension slot "State: CA · Edge case: ..." gives "State", "CA".
 * An open slot has no selector value.
 */
export function slotSelector(label: string): { field: string; value: string } | null {
  if (/^Open slot\b/.test(label)) return { field: '', value: 'Open slot' };
  const m = /^([^:.·]{1,60}):\s*([^.·]+?)(?:\.\s|\s·\s|\.$|$)/.exec(label.trim());
  return m ? { field: m[1]!.trim(), value: m[2]!.trim() } : null;
}

/**
 * The coverage selector of one task row: the API's `selector` (read from the task's slot, MVP1 step 9), shown as
 * field and display value. Only a row without one (an older API) falls back to reading the brief.
 */
export function rowSelector(r: Pick<ForgeTaskRow, 'label' | 'selector'>): { field: string; value: string } | null {
  if (r.selector !== undefined) return r.selector ? { field: r.selector.field, value: r.selector.label } : null;
  return slotSelector(r.label);
}

/** The heading word for the coverage table, e.g. "governing state", from the tasks' selectors (most common field). */
export function selectorName(rows: Pick<ForgeTaskRow, 'label' | 'selector'>[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const f = rowSelector(r)?.field;
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? best.toLowerCase() : 'task';
}

export const fmtDate = (iso: string) => iso.slice(0, 10);
export const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Tasks tab summary: "1 approved · 1 waiting for review". */
export function tasksSummary(rows: Pick<ForgeTaskRow, 'status'>[]): string {
  const approved = rows.filter((r) => r.status === 'ACCEPTED').length;
  const waiting = rows.filter((r) => r.status === 'SUBMITTED').length;
  return `${approved} approved · ${waiting} waiting for review`;
}

/** Where an export result that needs fixing links: the new task page with the new flow on, else Task review. */
export const exportFixHref = (projectId: string, taskId: string, newFlow: boolean) => (newFlow ? `/projects/${projectId}/tasks/${taskId}/review` : `/review/tasks/${taskId}`);

/** The recruiter page's back link: the project's Resource assignments tab with the new flow on, else the project. */
export const recruiterBackHref = (projectId: string, newFlow: boolean) => (newFlow ? tabHref(projectId, 'people') : `/projects/${projectId}`);

/**
 * "Change author" on the task page (PM or Admin): shown for Assigned, In progress and Rework tasks that have an author.
 * The author can be changed only before they start (owner, 15 Nov; the API answers AUTHOR_STARTED otherwise), so it
 * is enabled only while the task is Assigned.
 */
export function changeAuthorState(status: string, hasAuthor: boolean): 'enabled' | 'started' | null {
  if (!hasAuthor || !['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(status)) return null;
  return status === 'ASSIGNED' ? 'enabled' : 'started';
}

/** The Tasks tab offers "Assign SME…" only on an Open task with no author. */
export const canPickAuthor = (r: Pick<ForgeTaskRow, 'status' | 'author'>) => r.status === 'CREATED' && !r.author;

export const smesOf = (people: ProjectPersonDto[]) => people.filter((p) => p.role === 'SME');
export const reviewersOf = (people: ProjectPersonDto[]) => people.filter((p) => p.role === 'REVIEWER');
export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

export const routeLabel = (r: ReviewRoute) => (r === 'SME_EXPERT_PM' ? 'Author → Reviewer → PM/Admin' : 'Author → PM/Admin');

/** The Dashboard's "Next step" banner: whatever is blocking, most urgent first. */
export function nextStep(args: {
  projectId: string;
  tasks: ForgeTaskRow[];
  smesAssigned: number;
  requiredWorkers: number | null;
}): { text: string; href: string; link: string } {
  const { projectId, tasks } = args;
  const codes = taskCodes(tasks);
  const mine = tasks.find((t) => t.canDecide);
  if (mine) return { text: `${codes.get(mine.taskId)} is waiting for your decision.`, href: `/projects/${projectId}/tasks/${mine.taskId}/review`, link: 'Open the task →' };
  const atReviewer = tasks.find((t) => t.waitingFor === 'REVIEWER');
  if (atReviewer) return { text: `${codes.get(atReviewer.taskId)} is waiting for its Reviewer.`, href: tabHref(projectId, 'tasks'), link: 'Open tasks →' };
  const need = args.requiredWorkers !== null ? args.requiredWorkers - args.smesAssigned : 0;
  if (need > 0) return { text: `${need} more ${need === 1 ? 'expert is' : 'experts are'} needed (${args.smesAssigned} of ${args.requiredWorkers} assigned).`, href: `/projects/${projectId}/assign`, link: 'Assign people →' };
  const open = tasks.filter((t) => canPickAuthor(t));
  if (open.length) return { text: `${open.length} ${open.length === 1 ? 'task has' : 'tasks have'} no author yet.`, href: tabHref(projectId, 'tasks'), link: 'Open tasks →' };
  if (tasks.length && tasks.every((t) => t.status === 'ACCEPTED')) return { text: `All ${tasks.length} tasks are approved.`, href: tabHref(projectId, 'tasks'), link: 'Export to RL Gym →' };
  const rework = tasks.filter((t) => t.status === 'REWORK').length;
  if (rework) return { text: `${rework} ${rework === 1 ? 'task is' : 'tasks are'} back with the author for rework.`, href: tabHref(projectId, 'tasks'), link: 'Open tasks →' };
  return { text: 'Authors are working on their tasks.', href: tabHref(projectId, 'tasks'), link: 'Open tasks →' };
}

/** Dashboard "Export to RL Gym" row (new RL Gym, part 2). */
export function exportStatusLine(e: { canExport: boolean; reason: string | null; connected: boolean; runs: { outcome: string; createdAt: string }[] } | null): string {
  if (!e) return '—';
  if (!e.connected) return 'Not connected · RL Gym isn’t connected yet';
  const last = e.runs.find((r) => r.outcome === 'received');
  if (last) return `Exported ${fmtWhen(last.createdAt)}${e.canExport ? ' · can be re-exported' : ''}`;
  if (e.canExport) return 'Not exported · ready to export the approved tasks so far';
  return `Not exported · ${e.reason ? e.reason.replace(/\.$/, '') : 'not open yet'}`;
}

// ── Assign screen ──

export interface AssignableTask {
  taskId: string;
  label: string;
  status: string;
}
export interface CriterionMatch<T> {
  value: T | null;
  /** True met, false missed, null not stated by the person. */
  matched: boolean | null;
}
export interface AssignablePerson {
  /** SOURCING: a profile on this project. POOL: someone in the platform pool (D20), given a record here on assign. */
  source?: 'SOURCING' | 'POOL';
  sourcedPersonId: string | null;
  candidateId?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  /** Null for a pool person: they can be assigned in either role. */
  role: 'SME' | 'REVIEWER' | null;
  assessed: boolean;
  matchingSkills: { skill: string; matched: boolean | null }[];
  location?: CriterionMatch<string> | null;
  experience?: CriterionMatch<number> | null;
  activeProjects?: number | null;
  projectLimit?: number | null;
  reviewableTaskIds: string[];
}
export interface AssignableData {
  reviewRoute: ReviewRoute;
  requiredWorkers: number | null;
  /** D19: the project's tasks, and the lowest Required workers the PM may set. */
  taskCount?: number;
  minRequiredWorkers?: number;
  smePlacesUsed: number;
  smePlacesFull: boolean;
  projectSkills: string[];
  criteria?: { countries: string[] | null; countryRequired: boolean; minYears: number | null; yearsRequired: boolean };
  openTasks: AssignableTask[];
  reviewableTasks: AssignableTask[];
  people: AssignablePerson[];
  /** D23 + D24, when asked for a page: everyone before the search, then the page and the filtered total. */
  peopleAvailable?: number;
  page?: number;
  pageSize?: number;
  total?: number;
  pageCount?: number;
}

/** A row's stable key: the Sourcing profile, else the pool person. */
export const personKey = (p: Pick<AssignablePerson, 'sourcedPersonId' | 'candidateId'>) => p.sourcedPersonId ?? `pool:${p.candidateId}`;

const canSme = (p: Pick<AssignablePerson, 'role'>) => p.role === 'SME' || p.role === null;
const canReview = (d: Pick<AssignableData, 'reviewRoute'>, p: Pick<AssignablePerson, 'role'>) => d.reviewRoute === 'SME_EXPERT_PM' && (p.role === 'REVIEWER' || p.role === null);

/** The Task select's groups: "To author (SME)" open tasks; on the Reviewer route also "To review (Reviewer)". */
export function assignOptions(d: Pick<AssignableData, 'reviewRoute' | 'openTasks' | 'reviewableTasks'>, person: Pick<AssignablePerson, 'role' | 'reviewableTaskIds'>) {
  const groups: { label: string; role: 'SME' | 'REVIEWER'; tasks: AssignableTask[] }[] = [];
  if (canSme(person)) groups.push({ label: 'To author (SME)', role: 'SME', tasks: d.openTasks });
  if (canReview(d, person)) groups.push({ label: 'To review (Reviewer)', role: 'REVIEWER', tasks: d.reviewableTasks.filter((t) => person.reviewableTaskIds.includes(t.taskId)) });
  return groups;
}

/** Which assign buttons a person gets: Assign as SME unless places are full; Assign as Reviewer on the Reviewer route only. */
export function assignButtons(d: Pick<AssignableData, 'reviewRoute' | 'smePlacesFull'>, person: Pick<AssignablePerson, 'role'>) {
  return {
    sme: canSme(person) && !d.smePlacesFull,
    smeFull: canSme(person) && d.smePlacesFull,
    reviewer: canReview(d, person),
  };
}

/** The assign request: the Sourcing profile, or the pool person with the role chosen (D20). */
export function assignBody(p: Pick<AssignablePerson, 'sourcedPersonId' | 'candidateId'>, role: 'SME' | 'REVIEWER', taskId: string) {
  return p.sourcedPersonId ? { sourcedPersonId: p.sourcedPersonId, taskId } : { candidateId: p.candidateId, role, taskId };
}

/** D19: why SME places are full and how to change it; null while places are left. */
export function placesFullNote(d: Pick<AssignableData, 'smePlacesFull' | 'smePlacesUsed' | 'requiredWorkers'>): string | null {
  if (!d.smePlacesFull) return null;
  return `All ${d.requiredWorkers} SME places are filled (${d.smePlacesUsed} of ${d.requiredWorkers} assigned). Required workers sets how many SMEs this project can have: raise it here to assign another SME.`;
}

/** A Required workers value the PM typed, checked before it is sent (D19). */
export function requiredWorkersProblem(value: string, min: number): string | null {
  const n = Number(value);
  if (!value.trim() || !Number.isInteger(n)) return 'Enter a whole number.';
  if (n < min) return `Required workers can't be lower than ${min} (one place per task, and the SMEs already assigned).`;
  if (n > 10000) return 'Enter 10,000 or fewer.';
  return null;
}

const mark = (m: boolean | null) => (m === true ? '✓' : m === false ? '✗' : 'not stated');

/** A pool person's match against the project's criteria, in short words (D20). Empty for Sourcing profiles. */
export function criteriaLine(p: Pick<AssignablePerson, 'source' | 'location' | 'experience' | 'activeProjects' | 'projectLimit'>): string[] {
  if (p.source !== 'POOL') return [];
  const out: string[] = [];
  if (p.location) out.push(`Location ${p.location.value ?? ''} ${mark(p.location.matched)}`.replace(/\s+/g, ' '));
  if (p.experience) out.push(`Experience ${p.experience.value === null ? '' : `${p.experience.value} yrs `}${mark(p.experience.matched)}`.replace(/\s+/g, ' '));
  if (p.activeProjects !== null && p.activeProjects !== undefined && p.projectLimit) out.push(`On ${p.activeProjects} of ${p.projectLimit} projects`);
  return out;
}

/** Inline error before anything is sent: a task must be chosen, from the right group. */
export function assignProblem(role: 'SME' | 'REVIEWER', taskId: string, d: Pick<AssignableData, 'openTasks' | 'reviewableTasks'>): string | null {
  if (role === 'SME') return d.openTasks.some((t) => t.taskId === taskId) ? null : 'Choose a task to author.';
  return d.reviewableTasks.some((t) => t.taskId === taskId) ? null : 'Choose a task to review.';
}

// ── Task page: decision box ──

export type Decision = 'APPROVE' | 'REWORK' | 'REJECT';
export interface DecisionForm {
  comments: { section: string; text: string }[];
  notes: string;
  rejectReason: TaskRejectReason | '';
  checklist: Record<string, boolean>;
  duplicateOk: boolean;
  coverageOk: boolean;
  edgeCase: string;
}
export interface DecisionNeeds {
  checklistKeys: string[];
  checklistRequired: boolean;
  /** The one-step route needs an explicit duplicate decision for a flagged task. */
  duplicateNeeded: boolean;
  confirmCoverage: boolean;
}

export const REJECT_REASONS: { value: TaskRejectReason; label: string }[] = [
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'NOT_REALISTIC', label: 'Not realistic' },
  { value: 'INCORRECT', label: 'Incorrect' },
  { value: 'REAL_DATA', label: 'Contains real data (quarantine)' },
];

const filled = (f: DecisionForm) => f.comments.filter((c) => c.section && c.text.trim());

/** The decision box's inline error, or null when the decision can be sent. Mirrors the API's rules. */
export function decisionProblem(decision: Decision, f: DecisionForm, needs: DecisionNeeds): string | null {
  if (decision !== 'APPROVE' && !filled(f).length && !f.notes.trim()) return 'Add a comment for the author before asking for rework or rejecting.';
  if (decision === 'REJECT' && !f.rejectReason) return 'Choose a reason for rejecting.';
  if (decision === 'APPROVE') {
    if (needs.checklistRequired && needs.checklistKeys.some((k) => f.checklist[k] !== true)) return 'Tick every checklist item to approve.';
    if (needs.duplicateNeeded && !f.duplicateOk) return 'This task looks like an existing one: confirm it is distinct to approve.';
    if (needs.confirmCoverage && (!f.coverageOk || !f.edgeCase.trim())) return 'Confirm the coverage this task fills, with its edge case, to approve.';
  }
  return null;
}

/** The body for POST /projects/:id/tasks/:taskId/decision. */
export function decisionBody(
  decision: Decision,
  f: DecisionForm,
  needs: DecisionNeeds & { flaggedDuplicate: boolean; coverageTags: Record<string, string> },
  expected: { version: number; revision: number },
) {
  const comments: ForgeComment[] = filled(f).map((c) => ({ section: c.section, text: c.text.trim() }));
  const dup = needs.flaggedDuplicate
    ? decision === 'APPROVE'
      ? 'ACCEPT_AS_DISTINCT'
      : decision === 'REWORK'
        ? 'REWORK'
        : f.rejectReason === 'DUPLICATE'
          ? 'REJECT_DUPLICATE'
          : undefined
    : undefined;
  return {
    decision,
    expectedVersion: expected.version,
    expectedRevision: expected.revision,
    comments,
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
    ...(decision === 'REJECT' && f.rejectReason ? { rejectReason: f.rejectReason } : {}),
    ...(needs.checklistRequired ? { checklist: Object.fromEntries(needs.checklistKeys.map((k) => [k, f.checklist[k] === true])) } : {}),
    ...(dup ? { duplicateDecision: dup } : {}),
    ...(decision === 'APPROVE' && needs.confirmCoverage ? { confirmedCoverage: { tags: needs.coverageTags, edgeCase: f.edgeCase.trim() } } : {}),
  };
}

// ── Task page: banner and review trail ──

export function taskBanner(status: string, last: { decision: string; by: string; at: string } | null): string {
  switch (status) {
    case 'CREATED':
      return 'Not assigned yet. The form fills in once an expert is assigned and starts authoring.';
    case 'ASSIGNED':
      return 'Assigned. The expert has not started authoring yet.';
    case 'IN_PROGRESS':
      return 'Draft in progress. Read-only; you can review it once the expert submits.';
    case 'SUBMITTED':
      return 'Submitted. Waiting for review.';
    case 'ACCEPTED':
      return `Approved${last ? ` on ${fmtWhen(last.at)} by ${last.by}` : ''}. Added to the approved dataset.`;
    case 'REWORK':
      return `Sent back for rework${last ? ` on ${fmtWhen(last.at)} by ${last.by}` : ''}. The expert can edit and resubmit.`;
    case 'REJECTED':
      return `Rejected${last ? ` on ${fmtWhen(last.at)} by ${last.by}` : ''}. Final; the slot is freed.`;
    default:
      return status;
  }
}

export interface ReviewEntry {
  by: string;
  decision: string;
  stage: string | null;
  at: string;
}
export interface TrailStep {
  role: 'Author' | 'Reviewer' | 'PM/Admin';
  who: string;
  state: 'done' | 'current' | 'next';
  note: string;
}

const DECISION_WORD: Record<string, string> = { PASS: 'Passed', ACCEPT: 'Approved', APPROVE: 'Approved', REWORK: 'Sent back', REJECT: 'Rejected' };

/** Author → (Reviewer) → PM/Admin, with who and when, for the task's current submission. */
export function reviewTrail(v: {
  status: string;
  reviewRoute: ReviewRoute;
  reviewStage: string | null;
  author: { name: string } | null;
  reviewer: { name: string } | null;
  versions: { submittedAt: string }[];
  reviews: ReviewEntry[];
}): TrailStep[] {
  const submitted = v.versions.at(-1)?.submittedAt ?? null;
  const after = (r: ReviewEntry) => !submitted || r.at >= submitted;
  const authored = ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'REWORK'].includes(v.status);
  const steps: TrailStep[] = [
    {
      role: 'Author',
      who: v.author?.name ?? 'Not assigned',
      state: v.status === 'REWORK' ? 'current' : authored ? 'done' : v.author ? 'current' : 'next',
      note: v.status === 'REWORK' ? 'Fixing and resubmitting' : authored && submitted ? `Submitted ${fmtWhen(submitted)}` : v.author ? 'Authoring' : 'Assign an SME on the Tasks tab',
    },
  ];
  const decided = ['ACCEPTED', 'REJECTED'].includes(v.status);
  if (v.reviewRoute === 'SME_EXPERT_PM') {
    const mine = [...v.reviews].reverse().find((r) => r.stage === 'EXPERT_REVIEW' && after(r));
    const atReviewer = v.status === 'SUBMITTED' && v.reviewStage === 'EXPERT_REVIEW';
    steps.push({
      role: 'Reviewer',
      who: v.reviewer?.name ?? 'Not assigned',
      state: atReviewer ? 'current' : mine || decided || (v.status === 'SUBMITTED' && v.reviewStage === 'PM_APPROVAL') ? 'done' : 'next',
      note: atReviewer ? 'Waiting' : mine ? `${DECISION_WORD[mine.decision] ?? mine.decision} ${fmtWhen(mine.at)}` : 'Checks first',
    });
  }
  const pm = [...v.reviews].reverse().find((r) => r.stage !== 'EXPERT_REVIEW' && after(r));
  const atPm = v.status === 'SUBMITTED' && (v.reviewRoute === 'SME_PM' || v.reviewStage === 'PM_APPROVAL');
  steps.push({
    role: 'PM/Admin',
    who: pm?.by ?? 'PM or Admin',
    state: decided ? 'done' : atPm ? 'current' : 'next',
    note: pm && (decided || v.status === 'REWORK') ? `${DECISION_WORD[pm.decision] ?? pm.decision} ${fmtWhen(pm.at)}` : 'Final decision',
  });
  return steps;
}

