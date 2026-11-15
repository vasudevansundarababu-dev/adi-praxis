import { Prisma, type Project, type SourcedPerson, type TaskInstance } from '@prisma/client';
import { CAPPED_TASK_STATUSES, normEmail, type ProjectPersonDto, type SourcedPersonDto, type SourcedPersonInput } from '@praxis/shared';
import type { Actor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { EXPERT_TASK_TYPES } from '../tasks/task-service';

type Audit = (i: AuditInput) => Promise<void>;

/** Sourcing lists "only New or active projects, never completed or cancelled" (owner, 15 Nov). A draft is not yet a project people can join. */
export const SOURCING_OPEN_STATUSES = ['READY_FOR_STAFFING', 'STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED'] as const;
/** Tasks a Reviewer can be put on: authored or being authored, not yet decided. */
export const REVIEWABLE_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK'] as const;

const isAdmin = (actor: Actor) => actor.roles.includes('ADMIN');
/** Projects the caller may see: Admins every project in the client, a PM only the projects they own. */
export const visibleProjects = (actor: Actor): Prisma.ProjectWhereInput => ({ clientId: actor.clientId, ...(isAdmin(actor) ? {} : { ownerId: actor.userId }) });

export const isAssigned = (p: Pick<SourcedPerson, 'assignedAt' | 'releasedAt'>) => p.assignedAt !== null && p.releasedAt === null;

/** Case-insensitive de-duplication, first spelling wins. */
function uniqueSkills(list: string[]) {
  const seen = new Set<string>();
  return list.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

type SkillSource = Pick<Project, 'id'> & {
  jdSnapshot?: { data: Prisma.JsonValue } | null;
  jobDescription?: { skills: string[]; mandatorySkills: string[] } | null;
};
/** The project's skills, from its job description snapshot (taken on submit), else its job description. */
export function projectSkills(p: SkillSource): string[] {
  const snap = p.jdSnapshot?.data as { skills?: unknown; mandatorySkills?: unknown } | undefined;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  if (snap) return uniqueSkills([...strings(snap.mandatorySkills), ...strings(snap.skills)]);
  return uniqueSkills([...(p.jobDescription?.mandatorySkills ?? []), ...(p.jobDescription?.skills ?? [])]);
}

export const PROJECT_SKILL_INCLUDE = { jdSnapshot: { select: { data: true } }, jobDescription: { select: { skills: true, mandatorySkills: true } } } as const;

/** Loads a project for sourcing: same client, and owned by the caller unless they are an Admin (404 otherwise). */
export async function sourcingProject(tx: Db | Tx, actor: Actor, projectId: string) {
  const p = await tx.project.findFirst({ where: { id: projectId, ...visibleProjects(actor) }, include: PROJECT_SKILL_INCLUDE });
  if (!p) throw notFound('Project not found');
  return p;
}

export function toSourcedPersonDto(
  s: SourcedPerson,
  project: { name: string; skills: string[] },
  submittedBy: string,
): SourcedPersonDto {
  return {
    id: s.id,
    projectId: s.projectId,
    projectName: project.name,
    projectSkills: project.skills,
    role: s.role,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.emailNorm,
    linkedinUrl: s.linkedinUrl,
    hasCv: s.cvStorageKey !== null,
    hasAssessment: s.assessmentStorageKey !== null || Object.keys((s.assessment ?? {}) as object).length > 0,
    agency: s.agency,
    submittedBy,
    createdAt: s.createdAt.toISOString(),
    assigned: isAssigned(s),
  };
}

type SourcingTarget = Awaited<ReturnType<typeof sourcingProject>>;

/** The rules for adding anyone to a project: it is new or active, and Reviewers only where the route has a Reviewer step. */
export function assertCanSource(p: Pick<Project, 'status' | 'reviewRoute'>, role: 'SME' | 'REVIEWER') {
  if (!(SOURCING_OPEN_STATUSES as readonly string[]).includes(p.status)) {
    throw new AppError(409, 'PROJECT_NOT_OPEN', 'People can be added only to new or active projects.');
  }
  if (role === 'REVIEWER' && p.reviewRoute !== 'SME_EXPERT_PM') {
    throw new AppError(409, 'NO_REVIEWER_STEP', 'This project has no Reviewer step, so Reviewers cannot be added to it.');
  }
}

/** Loads the project (caller's visibility) and checks the sourcing rules: the shared start of Sourcing → New and the sheet import. */
export async function sourcingTarget(tx: Db | Tx, actor: Actor, projectId: string, role: 'SME' | 'REVIEWER') {
  const p = await sourcingProject(tx, actor, projectId);
  assertCanSource(p, role);
  return p;
}

/** Creates one sourced person on a checked project. The same person twice on a project and role is refused. Audited without names or emails. */
export async function createSourcedPerson(tx: Tx, actor: Actor, p: SourcingTarget, input: Omit<SourcedPersonInput, 'projectId'>, audit: Audit, extra: { assessmentStorageKey?: string } = {}) {
  const emailNorm = normEmail(input.email);
  const dup = await tx.sourcedPerson.findUnique({ where: { projectId_role_emailNorm: { projectId: p.id, role: input.role, emailNorm } } });
  if (dup) throw new AppError(409, 'DUPLICATE_PERSON', 'This person was already submitted to this project for this role.', { sourcedPersonId: dup.id });
  let s: SourcedPerson;
  try {
    s = await tx.sourcedPerson.create({
      data: {
        clientId: p.clientId,
        projectId: p.id,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
        emailNorm,
        linkedinUrl: input.linkedinUrl ?? null,
        agency: input.agency ?? null,
        assessment: (input.assessment ?? {}) as Prisma.InputJsonValue,
        assessmentStorageKey: extra.assessmentStorageKey ?? null,
        submittedById: actor.userId,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError(409, 'DUPLICATE_PERSON', 'This person was already submitted to this project for this role.');
    throw e;
  }
  // Ids and role only: names and emails stay out of the audit log.
  await audit({ entityType: 'SourcedPerson', entityId: s.id, action: 'sourcing.person_added', after: { projectId: p.id, role: s.role } });
  return s;
}

/** Sourcing → New: one person for one project and role. */
export async function addSourcedPerson(tx: Tx, actor: Actor, input: SourcedPersonInput, audit: Audit) {
  const p = await sourcingTarget(tx, actor, input.projectId, input.role);
  const s = await createSourcedPerson(tx, actor, p, input, audit);
  return { person: s, project: { name: p.name, skills: projectSkills(p) } };
}

/** Projects the caller may upload people for (the New screen's dropdown): new or active, never draft, completed or cancelled. */
export async function sourcingProjects(db: Db, actor: Actor) {
  const ps = await db.project.findMany({
    where: { ...visibleProjects(actor), status: { in: [...SOURCING_OPEN_STATUSES] } },
    include: PROJECT_SKILL_INCLUDE,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return ps.map((p) => ({ id: p.id, name: p.name, status: p.status, reviewRoute: p.reviewRoute, skills: projectSkills(p) }));
}

/** Sourcing list and search. With a search term both roles are searched (owner, 15 Nov). */
export async function listSourcedPeople(db: Db, actor: Actor, args: { role?: 'SME' | 'REVIEWER'; q?: string }): Promise<SourcedPersonDto[]> {
  const q = args.q?.trim().toLowerCase();
  const people = await db.sourcedPerson.findMany({
    where: { clientId: actor.clientId, project: visibleProjects(actor), ...(q || !args.role ? {} : { role: args.role }) },
    include: { project: { include: PROJECT_SKILL_INCLUDE } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 2000,
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(people.map((p) => p.submittedById))] } }, select: { id: true, name: true, email: true } });
  const by = new Map(users.map((u) => [u.id, u.name || u.email]));
  const rows = people.map((s) => ({ s, skills: projectSkills(s.project) }));
  const hit = (r: (typeof rows)[number]) =>
    !q || [r.s.firstName, r.s.lastName, `${r.s.firstName} ${r.s.lastName}`, r.s.emailNorm, r.s.role, r.s.project.name, ...r.skills].some((v) => v.toLowerCase().includes(q));
  return rows.filter(hit).map((r) => toSourcedPersonDto(r.s, { name: r.s.project.name, skills: r.skills }, by.get(r.s.submittedById) ?? ''));
}

export const taskLabel = (t: Pick<TaskInstance, 'input'> & { slot?: { position: number } | null }) =>
  (t.input as { slot?: { brief?: string } }).slot?.brief ?? (t.slot ? `Task ${t.slot.position + 1}` : 'Task');

/** Resource assignments: the people assigned to the project, each with the tasks they author or review. */
export async function projectPeople(tx: Db | Tx, projectId: string): Promise<ProjectPersonDto[]> {
  const people = await tx.sourcedPerson.findMany({ where: { projectId, assignedAt: { not: null }, releasedAt: null }, orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }] });
  const ids = people.map((p) => p.smeUserId).filter((x): x is string => !!x);
  const tasks = await tx.taskInstance.findMany({
    where: { projectId, taskType: EXPERT_TASK_TYPES, OR: [{ assignedTo: { smeUserId: { in: ids } } }, { reviewerSmeUserId: { in: ids } }] },
    include: { assignedTo: { select: { smeUserId: true } }, slot: { select: { position: true } } },
    orderBy: [{ slot: { position: 'asc' } }, { createdAt: 'asc' }],
  });
  return people.map((p) => ({
    sourcedPersonId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.emailNorm,
    role: p.role,
    status: 'ASSIGNED' as const,
    tasks: tasks
      .filter((t) => p.smeUserId && (p.role === 'SME' ? t.assignedTo?.smeUserId === p.smeUserId : t.reviewerSmeUserId === p.smeUserId))
      .map((t) => ({ taskId: t.id, label: taskLabel(t), status: t.status })),
  }));
}

/** Assigned SMEs on the project (each holds an SME place). */
export const assignedSmeCount = (tx: Db | Tx, projectId: string) => tx.sourcedPerson.count({ where: { projectId, role: 'SME', assignedAt: { not: null }, releasedAt: null } });

/** The Assign screen: sourced people not yet assigned, with matching skills, and the tasks they can be put on. */
export async function assignable(tx: Db | Tx, p: Project & SkillSource) {
  const skills = projectSkills(p);
  const people = await tx.sourcedPerson.findMany({ where: { projectId: p.id, OR: [{ assignedAt: null }, { releasedAt: { not: null } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  // A person is never both SME and Reviewer on one project (owner, 15 Nov).
  const assignedEmails = new Set((await tx.sourcedPerson.findMany({ where: { projectId: p.id, assignedAt: { not: null }, releasedAt: null }, select: { emailNorm: true } })).map((x) => x.emailNorm));
  const tasks = await tx.taskInstance.findMany({
    where: { projectId: p.id, taskType: EXPERT_TASK_TYPES },
    include: { assignedTo: { include: { smeUser: { select: { id: true, contactEmail: true } } } }, slot: { select: { position: true } } },
    orderBy: [{ slot: { position: 'asc' } }, { createdAt: 'asc' }],
  });
  const open = tasks.filter((t) => t.status === 'CREATED' && !t.assignedToId);
  const reviewable = p.reviewRoute === 'SME_EXPERT_PM' ? tasks.filter((t) => t.assignedToId && !t.reviewerSmeUserId && (REVIEWABLE_STATUSES as readonly string[]).includes(t.status)) : [];
  const placesUsed = await assignedSmeCount(tx, p.id);
  return {
    reviewRoute: p.reviewRoute,
    requiredWorkers: p.requiredWorkers,
    smePlacesUsed: placesUsed,
    smePlacesFull: p.requiredWorkers !== null && placesUsed >= p.requiredWorkers,
    projectSkills: skills,
    openTasks: open.map((t) => ({ taskId: t.id, label: taskLabel(t), status: t.status })),
    reviewableTasks: reviewable.map((t) => ({ taskId: t.id, label: taskLabel(t), status: t.status })),
    people: people
      .filter((s) => (s.role === 'SME' || p.reviewRoute === 'SME_EXPERT_PM') && !assignedEmails.has(s.emailNorm))
      .map((s) => {
        const values = Object.values((s.assessment ?? {}) as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
        const text = values.join('\n').toLowerCase();
        const assessed = values.length > 0;
        return {
          sourcedPersonId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          email: s.emailNorm,
          role: s.role,
          assessed,
          matchingSkills: skills.map((skill) => ({ skill, matched: assessed ? text.includes(skill.toLowerCase()) : null })),
          // Reviewers are never put on their own task.
          reviewableTaskIds:
            s.role === 'REVIEWER'
              ? reviewable.filter((t) => t.assignedTo?.smeUserId !== s.smeUserId && normEmail(t.assignedTo?.smeUser.contactEmail ?? '') !== s.emailNorm).map((t) => t.id)
              : [],
        };
      }),
  };
}

/**
 * The person's candidate-app account (SmeUser) in this client. Reuses one already signed in with the mock Google
 * subject `mock-<email>`, or with this contact email; otherwise creates one with no sign-in identity yet (it is claimed
 * at first sign-in).
 */
export async function ensureSmeUser(tx: Tx, person: SourcedPerson, audit: Audit): Promise<string> {
  if (person.smeUserId) return person.smeUserId;
  const bySubject = await tx.providerIdentity.findUnique({ where: { provider_subject: { provider: 'GOOGLE', subject: `mock-${person.emailNorm}` } }, include: { smeUser: true } });
  if (bySubject && bySubject.smeUser.clientId === person.clientId && !bySubject.smeUser.anonymizedAt) return bySubject.smeUserId;
  const byEmail = await tx.smeUser.findFirst({ where: { clientId: person.clientId, anonymizedAt: null, contactEmail: { equals: person.emailNorm, mode: 'insensitive' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (byEmail) return byEmail.id;
  const u = await tx.smeUser.create({ data: { clientId: person.clientId, displayName: `${person.firstName} ${person.lastName}`, contactEmail: person.emailNorm } });
  await audit({ entityType: 'SmeUser', entityId: u.id, action: 'sourcing.account_created', after: { sourcedPersonId: person.id } });
  return u.id;
}

/** The SmeUser's matching record, created minimal for a directly assigned person who has none. */
async function ensureCandidate(tx: Tx, clientId: string, smeUserId: string) {
  const c = await tx.candidate.findUnique({ where: { smeUserId } });
  if (c) return c;
  return tx.candidate.create({ data: { clientId, smeUserId, poolStatus: 'ASSIGNED_DIRECT', specialties: [], jurisdictions: [], skills: [] } });
}

/** The candidate's place on the project with no proposal to accept: reused if active, otherwise restored or created. */
async function ensureProjectAssignment(tx: Tx, p: Project, candidateId: string, audit: Audit) {
  const pa = await tx.projectAssignment.findUnique({ where: { projectId_candidateId: { projectId: p.id, candidateId } }, include: { smeAssignment: true } });
  if (pa && !pa.releasedAt && (!pa.smeAssignment || ['ACCEPTED', 'HANDED_OFF'].includes(pa.smeAssignment.status))) return pa;
  const a = await tx.projectAssignment.upsert({
    where: { projectId_candidateId: { projectId: p.id, candidateId } },
    create: { clientId: p.clientId, projectId: p.id, candidateId },
    update: { releasedAt: null, assignedAt: new Date(), smeAssignmentId: null },
  });
  await audit({ entityType: 'ProjectAssignment', entityId: a.id, action: 'project.candidate_assigned', after: { projectId: p.id, candidateId, direct: true } });
  return a;
}

/** Locks one task row and checks it belongs to the project. */
async function lockTask(tx: Tx, projectId: string, taskId: string) {
  await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${taskId}::uuid FOR UPDATE`;
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, projectId, taskType: EXPERT_TASK_TYPES }, include: { assignedTo: { include: { smeUser: true } } } });
  if (!t) throw notFound('Task not found');
  return t;
}

async function lockPerson(tx: Tx, projectId: string, sourcedPersonId: string) {
  await tx.$executeRaw`SELECT 1 FROM "SourcedPerson" WHERE id = ${sourcedPersonId}::uuid FOR UPDATE`;
  const s = await tx.sourcedPerson.findFirst({ where: { id: sourcedPersonId, projectId } });
  if (!s) throw notFound('Person not found on this project');
  return s;
}

/** A person is never both SME and Reviewer on one project (owner, 15 Nov). */
async function refuseOtherRole(tx: Tx, s: SourcedPerson) {
  const other = await tx.sourcedPerson.findFirst({ where: { projectId: s.projectId, role: s.role === 'SME' ? 'REVIEWER' : 'SME', emailNorm: s.emailNorm, assignedAt: { not: null }, releasedAt: null } });
  if (other) throw new AppError(409, 'BOTH_ROLES', `This person is already ${other.role === 'SME' ? 'an SME' : 'a Reviewer'} on this project. One person has one role per project.`);
}

const stale = () => new AppError(409, 'STALE_REVISION', 'The task changed meanwhile; reload and try again.');

/** Marks the person assigned (the first time, or again after a release). */
async function markAssigned(tx: Tx, s: SourcedPerson, smeUserId: string, actor: Actor, audit: Audit, taskId: string) {
  const first = !isAssigned(s);
  await tx.sourcedPerson.update({ where: { id: s.id }, data: { smeUserId, ...(first ? { assignedAt: new Date(), assignedById: actor.userId, releasedAt: null } : {}) } });
  await audit({ entityType: 'SourcedPerson', entityId: s.id, action: 'sourcing.person_assigned', after: { projectId: s.projectId, role: s.role, smeUserId, taskId, first } });
}

/** Moves STAFFED (or earlier) to IN_PROGRESS once the PM has put the first author on a task. */
async function markStarted(tx: Tx, projectId: string, audit: Audit) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!['READY_FOR_STAFFING', 'STAFFING', 'STAFFED'].includes(p.status)) return;
  const { count } = await tx.project.updateMany({ where: { id: projectId, status: p.status }, data: { status: 'IN_PROGRESS' } });
  if (count) await audit({ entityType: 'Project', entityId: projectId, action: 'project.started', before: { status: p.status }, after: { status: 'IN_PROGRESS', direct: true } });
}

/** Checks an SME may take one more task on the project: places (Required workers) and the per-expert cap. */
async function checkSmeCapacity(tx: Tx, p: Project, s: SourcedPerson, candidateId: string | null) {
  if (!isAssigned(s) && p.requiredWorkers !== null && (await assignedSmeCount(tx, p.id)) >= p.requiredWorkers) {
    throw new AppError(409, 'SME_PLACES_FULL', `All ${p.requiredWorkers} SME places on this project are filled.`);
  }
  if (p.maxPerExpert !== null && candidateId) {
    const held = await tx.taskInstance.count({ where: { projectId: p.id, assignedToId: candidateId, status: { in: [...CAPPED_TASK_STATUSES] } } });
    if (held >= p.maxPerExpert) throw new AppError(409, 'MAX_PER_EXPERT', `This person already has ${held} task(s) on this project, the most one expert may hold.`);
  }
}

/** Puts an SME (author) on a task: account, matching record and project place as needed, then the task and its slot. */
async function putAuthorOnTask(tx: Tx, p: Project, s: SourcedPerson, t: TaskInstance, actor: Actor, audit: Audit, extra: Record<string, unknown> = {}) {
  await refuseOtherRole(tx, s);
  const smeUserId = await ensureSmeUser(tx, s, audit);
  const existing = await tx.candidate.findUnique({ where: { smeUserId } });
  if (t.reviewerSmeUserId === smeUserId) throw new AppError(409, 'REVIEWER_IS_AUTHOR', 'This person reviews this task, so they cannot author it.');
  await checkSmeCapacity(tx, p, s, existing?.id ?? null);
  const candidate = existing ?? (await ensureCandidate(tx, p.clientId, smeUserId));
  const pa = await ensureProjectAssignment(tx, p, candidate.id, audit);
  const now = new Date();
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, revision: t.revision },
    data: { status: 'ASSIGNED', assignedToId: candidate.id, projectAssignmentId: pa.id, assignedAt: now, revision: { increment: 1 } },
  });
  if (!count) throw stale();
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'OFFERED', assignedToId: candidate.id } });
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.issued', after: { projectId: p.id, candidateId: candidate.id, slotId: t.slotId, status: 'ASSIGNED', direct: true, by: actor.userId, ...extra } });
  await markAssigned(tx, s, smeUserId, actor, audit, t.id);
  await markStarted(tx, p.id, audit);
  return { smeUserId, candidateId: candidate.id };
}

/** MVP1: the PM or Admin assigns a sourced person to one task, as author (SME) or Reviewer. Assigning is the selection. */
export async function directAssign(tx: Tx, p: Project, args: { sourcedPersonId: string; taskId: string }, actor: Actor, audit: Audit) {
  const s = await lockPerson(tx, p.id, args.sourcedPersonId);
  const t = await lockTask(tx, p.id, args.taskId);
  if (s.role === 'SME') {
    if (t.status !== 'CREATED' || t.assignedToId) throw new AppError(409, 'TASK_NOT_OPEN', 'This task already has an author.');
    await putAuthorOnTask(tx, p, s, t, actor, audit);
  } else {
    if (p.reviewRoute !== 'SME_EXPERT_PM') throw new AppError(409, 'NO_REVIEWER_STEP', 'This project has no Reviewer step.');
    if (!t.assignedToId || !(REVIEWABLE_STATUSES as readonly string[]).includes(t.status)) throw new AppError(409, 'TASK_NOT_REVIEWABLE', 'Only a task with an author, not yet decided, can be given a Reviewer.');
    if (t.reviewerSmeUserId) throw new AppError(409, 'HAS_REVIEWER', 'This task already has a Reviewer.');
    await refuseOtherRole(tx, s);
    const authorEmail = t.assignedTo?.smeUser.contactEmail ? normEmail(t.assignedTo.smeUser.contactEmail) : null;
    if (authorEmail === s.emailNorm || (s.smeUserId && s.smeUserId === t.assignedTo?.smeUserId)) throw new AppError(409, 'OWN_TASK', 'A Reviewer never reviews their own task.');
    const smeUserId = await ensureSmeUser(tx, s, audit);
    if (smeUserId === t.assignedTo?.smeUserId) throw new AppError(409, 'OWN_TASK', 'A Reviewer never reviews their own task.');
    const { count } = await tx.taskInstance.updateMany({ where: { id: t.id, revision: t.revision }, data: { reviewerSmeUserId: smeUserId, revision: { increment: 1 } } });
    if (!count) throw stale();
    await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.reviewer_assigned', after: { projectId: p.id, reviewerSmeUserId: smeUserId, sourcedPersonId: s.id, by: actor.userId } });
    await markAssigned(tx, s, smeUserId, actor, audit, t.id);
  }
  return tx.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
}

/** Changes a task's author, only before they start (owner, 15 Nov). The old author is released if it was their last task. */
export async function changeAuthor(tx: Tx, p: Project, args: { taskId: string; sourcedPersonId: string }, actor: Actor, audit: Audit) {
  const t = await lockTask(tx, p.id, args.taskId);
  if (t.status !== 'ASSIGNED' || t.startedAt) throw new AppError(409, 'AUTHOR_STARTED', 'The author can be changed only before they start the task.');
  const s = await lockPerson(tx, p.id, args.sourcedPersonId);
  if (s.role !== 'SME') throw new AppError(409, 'NOT_AN_SME', 'Only a person sourced as SME can author a task.');
  const old = t.assignedTo!;
  if (s.smeUserId && s.smeUserId === old.smeUserId) throw new AppError(409, 'SAME_AUTHOR', 'This person already authors this task.');
  const r = await putAuthorOnTask(tx, p, s, t, actor, audit, { replacedCandidateId: old.id });
  if (r.candidateId === old.id) throw new AppError(409, 'SAME_AUTHOR', 'This person already authors this task.');
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.author_changed', before: { candidateId: old.id }, after: { candidateId: r.candidateId, sourcedPersonId: s.id } });
  // The old author keeps their place only while they hold another task here.
  const left = await tx.taskInstance.count({ where: { projectId: p.id, assignedToId: old.id } });
  if (!left) {
    const released = new Date();
    const prev = await tx.sourcedPerson.findMany({ where: { projectId: p.id, role: 'SME', smeUserId: old.smeUserId, assignedAt: { not: null }, releasedAt: null } });
    for (const x of prev) {
      await tx.sourcedPerson.update({ where: { id: x.id }, data: { releasedAt: released } });
      await audit({ entityType: 'SourcedPerson', entityId: x.id, action: 'sourcing.person_released', after: { projectId: p.id, role: x.role, reason: 'author_changed' } });
    }
    const pa = await tx.projectAssignment.findFirst({ where: { projectId: p.id, candidateId: old.id, releasedAt: null } });
    if (pa) {
      await tx.projectAssignment.update({ where: { id: pa.id }, data: { releasedAt: released } });
      await audit({ entityType: 'ProjectAssignment', entityId: pa.id, action: 'project.candidate_released', before: { releasedAt: null }, after: { candidateId: old.id, reason: 'author_changed' } });
    }
  }
  return tx.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
}

/** Whether this SME is put on the project by a PM or Admin (new flow): then being assigned is the selection. */
export async function directlyAssignedSme(tx: Db | Tx, smeUserId: string, projectId: string) {
  return (await tx.sourcedPerson.count({ where: { smeUserId, projectId, role: 'SME', assignedAt: { not: null }, releasedAt: null } })) > 0;
}
