import type { Domain, JobDescriptionSnapshot, Prisma, Project, ProjectDemographicFilter, Template, User } from '@prisma/client';
import {
  CANCELLABLE_STATUSES,
  computeProjectFigures,
  CoverageQuotas,
  CreateProjectRequest,
  DEFAULT_MAX_TASK_COUNT,
  ProjectDto,
  submitProblems,
  UpdateProjectRequest,
  type DemographicFilterInput,
  type ProjectStatus,
} from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { toJdDto } from './job-descriptions';

type ProjectFull = Project & {
  template: Template & { domain: Domain };
  jdSnapshot: JobDescriptionSnapshot | null;
  owner: User;
  demographicFilters: ProjectDemographicFilter[];
};

const INCLUDE = { template: { include: { domain: true } }, owner: true, jdSnapshot: true, demographicFilters: { orderBy: { createdAt: 'asc' } } } as const;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`));

const toFilter = (f: ProjectDemographicFilter): DemographicFilterInput => ({
  attributeKey: f.attributeKey,
  operator: f.operator,
  values: f.values,
  required: f.required,
});

export function toProjectDto(p: ProjectFull): ProjectDto {
  return {
    id: p.id,
    status: p.status,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    ownerName: p.owner.name,
    templateId: p.templateId,
    templateVersion: p.templateVersion,
    workflowName: p.template.workflowName,
    domainName: p.template.domain.name,
    taskMode: p.taskMode,
    taskCount: p.taskCount,
    distinctTarget: p.distinctTarget,
    maxPerExpert: p.maxPerExpert,
    coverageQuotas: CoverageQuotas.nullable().safeParse(p.coverageQuotas).data ?? null,
    tptMinutes: p.tptMinutes,
    hoursPerWorkerDay: Number(p.hoursPerWorkerDay),
    startDate: isoDate(p.startDate),
    endDate: isoDate(p.endDate),
    requiredWorkers: p.requiredWorkers,
    demographicFilters: p.demographicFilters.map(toFilter),
    jobDescriptionId: p.jobDescriptionId,
    jdSnapshotId: p.jdSnapshotId,
    jdSnapshot: p.jdSnapshot?.data ?? null,
    demographicsSnapshot: p.demographicsSnapshot,
    autoLaunchCampaign: p.autoLaunchCampaign,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const isAdmin = (actor: Actor) => actor.roles.includes('ADMIN');

/** Only the owning PM and Admins can see or change a project; anyone else gets 404 (no existence leak). */
export async function loadProject(tx: Db | Tx, id: string, actor: Actor): Promise<ProjectFull> {
  const p = await tx.project.findFirst({ where: { id, clientId: actor.clientId }, include: INCLUDE });
  if (!p || (!isAdmin(actor) && p.ownerId !== actor.userId)) throw notFound('Project not found');
  return p;
}

/** A template is offerable when it is the newest PUBLISHED version of its workflow in an active domain. */
async function isOfferable(tx: Db | Tx, t: Template & { domain: Domain }) {
  if (t.status !== 'PUBLISHED' || t.domain.status !== 'ACTIVE') return false;
  const newer = await tx.template.count({ where: { lineageId: t.lineageId, status: 'PUBLISHED', version: { gt: t.version } } });
  return newer === 0;
}

async function offerableTemplate(tx: Tx, id: string, clientId: string) {
  const t = await tx.template.findFirst({ where: { id, clientId }, include: { domain: true } });
  if (!t || !(await isOfferable(tx, t))) throw badRequest('Choose a published template (only the latest version of each workflow can be used)');
  return t;
}

async function assertJd(tx: Tx, id: string | null | undefined, clientId: string) {
  if (!id) return;
  const jd = await tx.jobDescription.findFirst({ where: { id, clientId } });
  if (!jd) throw badRequest('Job description not found');
}

async function assertUniqueName(tx: Tx, clientId: string, name: string, exceptId?: string) {
  const clash = await tx.project.findFirst({
    where: { clientId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw conflict(`A project named "${clash.name}" already exists`);
}

async function replaceFilters(tx: Tx, project: { id: string; clientId: string }, filters: DemographicFilterInput[]) {
  await tx.projectDemographicFilter.deleteMany({ where: { projectId: project.id } });
  if (filters.length === 0) return;
  await tx.projectDemographicFilter.createMany({
    data: filters.map((f) => ({
      clientId: project.clientId,
      projectId: project.id,
      attributeKey: f.attributeKey,
      operator: f.operator,
      values: f.values as Prisma.InputJsonValue,
      required: f.required,
    })),
  });
}

function scalarData(body: z.infer<typeof UpdateProjectRequest>): Prisma.ProjectUncheckedUpdateInput {
  const d: Prisma.ProjectUncheckedUpdateInput = {};
  if (body.name !== undefined) d.name = body.name;
  if (body.description !== undefined) d.description = body.description;
  if (body.startDate !== undefined) d.startDate = toDate(body.startDate);
  if (body.endDate !== undefined) d.endDate = toDate(body.endDate);
  if (body.taskMode !== undefined) d.taskMode = body.taskMode;
  if (body.taskCount !== undefined) d.taskCount = body.taskCount;
  if (body.distinctTarget !== undefined) d.distinctTarget = body.distinctTarget;
  if (body.maxPerExpert !== undefined) d.maxPerExpert = body.maxPerExpert;
  if (body.coverageQuotas !== undefined) d.coverageQuotas = (body.coverageQuotas ?? null) as Prisma.InputJsonValue;
  if (body.tptMinutes !== undefined) d.tptMinutes = body.tptMinutes;
  if (body.hoursPerWorkerDay !== undefined) d.hoursPerWorkerDay = body.hoursPerWorkerDay;
  if (body.jobDescriptionId !== undefined) d.jobDescriptionId = body.jobDescriptionId;
  if (body.autoLaunchCampaign !== undefined) d.autoLaunchCampaign = body.autoLaunchCampaign;
  return d;
}

const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({ status: z.enum(['DRAFT', 'READY_FOR_STAFFING', 'STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional() });
const ACCESS = ['PM', 'ADMIN'] as const;

/** FLOW 1: project creation (SPEC). */
export const projectRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/projects',
    { config: { access: ACCESS }, schema: { tags: ['projects'], querystring: ListQuery, response: { 200: z.object({ items: z.array(ProjectDto) }) } } },
    async (req) => {
      const actor = req.actor!;
      const items = await db.project.findMany({
        where: {
          clientId: actor.clientId,
          ...(isAdmin(actor) ? {} : { ownerId: actor.userId }),
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        include: INCLUDE,
        orderBy: { updatedAt: 'desc' },
      });
      return { items: items.map(toProjectDto) };
    },
  );

  app.get(
    '/projects/:id',
    { config: { access: ACCESS }, schema: { tags: ['projects'], params: IdParams, response: { 200: ProjectDto } } },
    async (req) => toProjectDto(await loadProject(db, req.params.id, req.actor!)),
  );

  app.post(
    '/projects',
    { config: { access: ['PM'] }, schema: { tags: ['projects'], body: CreateProjectRequest, response: { 201: ProjectDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const t = await offerableTemplate(tx, req.body.templateId, actor.clientId);
        await assertUniqueName(tx, actor.clientId, req.body.name);
        await assertJd(tx, req.body.jobDescriptionId, actor.clientId);
        const taskMode = req.body.taskMode ?? (t.taskModes.includes('AUTHORING') ? 'AUTHORING' : t.taskModes[0]!);
        if (!t.taskModes.includes(taskMode)) throw badRequest(`This template does not allow ${taskMode.toLowerCase()} projects`);

        // Defaults come from the template; the PM's values override them.
        const created = await tx.project.create({
          data: {
            distinctTarget: t.defaultDistinctTarget,
            maxPerExpert: t.defaultMaxPerExpert,
            openSlotShare: t.openSlotShare,
            tptMinutes: t.defaultTptMinutes,
            jobDescriptionId: t.defaultJdId,
            ...(scalarData(req.body) as Omit<Prisma.ProjectUncheckedCreateInput, 'clientId' | 'ownerId' | 'templateId' | 'templateVersion' | 'name'>),
            taskMode,
            clientId: actor.clientId,
            ownerId: actor.userId,
            templateId: t.id,
            templateVersion: t.version,
            name: req.body.name,
          },
        });
        if (req.body.demographicFilters) await replaceFilters(tx, created, req.body.demographicFilters);
        const p = await loadProject(tx, created.id, actor);
        const body = toProjectDto(p);
        await audit({ entityType: 'Project', entityId: p.id, action: 'project.created', after: { status: 'DRAFT', name: p.name, templateId: t.id, templateVersion: t.version } });
        return { status: 201, body };
      });
      return reply;
    },
  );

  app.patch(
    '/projects/:id',
    { config: { access: ACCESS }, schema: { tags: ['projects'], params: IdParams, body: UpdateProjectRequest, response: { 200: ProjectDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const before = await loadProject(tx, req.params.id, actor);
        if (before.status !== 'DRAFT') {
          throw new AppError(409, 'PROJECT_NOT_EDITABLE', 'Only draft projects can be edited; submitted projects keep their snapshot.');
        }
        const data = scalarData(req.body);
        if (req.body.templateId !== undefined && req.body.templateId !== before.templateId) {
          const t = await offerableTemplate(tx, req.body.templateId, actor.clientId);
          data.templateId = t.id;
          data.templateVersion = t.version;
          if (req.body.taskMode === undefined && !t.taskModes.includes(before.taskMode)) data.taskMode = t.taskModes[0];
        }
        if (req.body.name !== undefined) await assertUniqueName(tx, actor.clientId, req.body.name, before.id);
        await assertJd(tx, req.body.jobDescriptionId, actor.clientId);

        // Always touch updatedAt: an edit may change only the filters, and an empty update would match no row.
        const { count } = await tx.project.updateMany({ where: { id: before.id, status: 'DRAFT' }, data: { ...data, updatedAt: new Date() } });
        if (count === 0) throw new AppError(409, 'PROJECT_NOT_EDITABLE', 'This project was submitted or cancelled meanwhile.');
        if (req.body.demographicFilters) await replaceFilters(tx, before, req.body.demographicFilters);

        const after = await loadProject(tx, before.id, actor);
        const changed = Object.keys(req.body) as (keyof ProjectDto)[];
        const pick = (d: ProjectDto) => Object.fromEntries(changed.map((k) => [k, d[k]]));
        await audit({ entityType: 'Project', entityId: before.id, action: 'project.updated', before: pick(toProjectDto(before)), after: pick(toProjectDto(after)) });
        return { status: 200, body: toProjectDto(after) };
      });
      return reply;
    },
  );

  app.post(
    '/projects/:id/submit',
    { config: { access: ACCESS }, schema: { tags: ['projects'], params: IdParams, response: { 200: ProjectDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        if (p.status !== 'DRAFT') throw new AppError(409, 'NOT_A_DRAFT', `Only drafts can be submitted (this project is ${p.status}).`);

        const [attributes, jd, client] = await Promise.all([
          tx.demographicAttribute.findMany({ where: { clientId: actor.clientId } }),
          p.jobDescriptionId ? tx.jobDescription.findFirst({ where: { id: p.jobDescriptionId, clientId: actor.clientId } }) : null,
          tx.client.findUniqueOrThrow({ where: { id: actor.clientId } }),
        ]);
        const maxTaskCount = Number((client.settings as { maxTaskCount?: number }).maxTaskCount ?? DEFAULT_MAX_TASK_COUNT);
        const dto = toProjectDto(p);
        const input = { ...dto, taskMode: p.taskMode };
        const { problems, warnings } = submitProblems(input, {
          template: { ...p.template, offerable: await isOfferable(tx, p.template) },
          attributes,
          jobDescription: jd ? { wagePerTask: Number(jd.wagePerTask) } : null,
          maxTaskCount,
        });
        if (problems.length > 0) {
          throw new AppError(422, 'PROJECT_INCOMPLETE', `Cannot submit yet: ${problems.join('; ')}.`, { problems, warnings });
        }

        // Freeze what FLOW 2 and the dataset rely on: the JD, the demographics and the computed figures.
        const jdSnapshot = await tx.jobDescriptionSnapshot.create({
          data: { clientId: actor.clientId, jobDescriptionId: jd!.id, data: toJdDto(jd!) as unknown as Prisma.InputJsonValue },
        });
        const usedKeys = new Set(dto.demographicFilters.map((f) => f.attributeKey));
        const demographicsSnapshot = {
          filters: dto.demographicFilters,
          attributes: attributes.filter((a) => usedKeys.has(a.key)).map((a) => ({ key: a.key, label: a.label, type: a.type })),
        };
        const figures = computeProjectFigures({ ...input, wagePerTask: Number(jd!.wagePerTask) });
        const now = new Date();

        const { count } = await tx.project.updateMany({
          where: { id: p.id, status: 'DRAFT' },
          data: {
            status: 'READY_FOR_STAFFING',
            submittedAt: now,
            jdSnapshotId: jdSnapshot.id,
            demographicsSnapshot: demographicsSnapshot as unknown as Prisma.InputJsonValue,
            requiredWorkers: figures.requiredWorkers,
            figures: figures as unknown as Prisma.InputJsonValue,
          },
        });
        if (count === 0) throw new AppError(409, 'NOT_A_DRAFT', 'This project was submitted or cancelled meanwhile.');

        await audit({
          entityType: 'Project',
          entityId: p.id,
          action: 'project.submitted',
          before: { status: 'DRAFT' },
          after: { status: 'READY_FOR_STAFFING', templateId: p.templateId, templateVersion: p.templateVersion, jdSnapshotId: jdSnapshot.id, requiredWorkers: figures.requiredWorkers },
        });
        await emit({
          name: 'project.ready_for_staffing',
          aggregateType: 'Project',
          aggregateId: p.id,
          payload: {
            projectId: p.id,
            templateId: p.templateId,
            templateVersion: p.templateVersion,
            jdSnapshotId: jdSnapshot.id,
            requiredWorkers: figures.requiredWorkers,
            taskMode: p.taskMode,
          },
        });
        return { status: 200, body: toProjectDto(await loadProject(tx, p.id, actor)) };
      });
      return reply;
    },
  );

  const transition = (path: string, action: string, from: ProjectStatus[], to: ProjectStatus) =>
    app.post(
      `/projects/:id/${path}`,
      { config: { access: ACCESS }, schema: { tags: ['projects'], params: IdParams, response: { 200: ProjectDto } } },
      async (req, reply) => {
        await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
          const p = await loadProject(tx, req.params.id, actor);
          if (!from.includes(p.status)) {
            throw new AppError(409, 'INVALID_TRANSITION', `A ${p.status} project cannot be ${action.split('.')[1]}.`);
          }
          const { count } = await tx.project.updateMany({ where: { id: p.id, status: p.status }, data: { status: to } });
          if (count === 0) throw new AppError(409, 'INVALID_TRANSITION', 'The project changed meanwhile; reload and try again.');
          await audit({ entityType: 'Project', entityId: p.id, action, before: { status: p.status }, after: { status: to } });
          return { status: 200, body: toProjectDto(await loadProject(tx, p.id, actor)) };
        });
        return reply;
      },
    );

  transition('cancel', 'project.cancelled', CANCELLABLE_STATUSES, 'CANCELLED');
  transition('pause', 'project.paused', ['IN_PROGRESS'], 'PAUSED');
};
