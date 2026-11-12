import type { Domain, Prisma, Template } from '@prisma/client';
import {
  CoverageDimensions,
  CreateDomainRequest,
  CreateTemplateRequest,
  DomainDto,
  EdgeCaseCatalog,
  profileForTemplate,
  publishProblems,
  TemplateDto,
  UpdateTemplateRequest,
} from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { AppError, conflict, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { loadUploadedProfiles } from '../templates/uploaded-profiles';

type TemplateWithDomain = Template & { domain: Domain };

/** A chosen authoring form must be a registered profile of the same workflow (owner, 11 Nov 2026). */
function assertProfile(workflowName: string, profileId: string | null | undefined) {
  if (!profileId) return;
  const r = profileForTemplate({ workflowName, profileId });
  if (r.status !== 'ok') throw new AppError(400, 'UNKNOWN_PROFILE', r.status === 'unsupported' ? r.problems.join('; ') : `Unknown template profile ${profileId}`);
}

export function toTemplateDto(t: TemplateWithDomain): TemplateDto {
  return {
    id: t.id,
    lineageId: t.lineageId,
    version: t.version,
    status: t.status,
    domainId: t.domainId,
    domainName: t.domain.name,
    workflowName: t.workflowName,
    primaryWork: t.primaryWork,
    verificationCriteria: t.verificationCriteria,
    humanGate: t.humanGate,
    taskDefinitionSchema: t.taskDefinitionSchema as Record<string, unknown>,
    collectionSchema: t.collectionSchema as Record<string, unknown>,
    defaultTptMinutes: t.defaultTptMinutes,
    skills: t.skills,
    taskModes: t.taskModes,
    coverageDimensions: CoverageDimensions.safeParse(t.coverageDimensions).data ?? { dimensions: [], cells: [] },
    edgeCaseCatalog: EdgeCaseCatalog.safeParse(t.edgeCaseCatalog).data ?? [],
    defaultDistinctTarget: t.defaultDistinctTarget,
    defaultMaxPerExpert: t.defaultMaxPerExpert,
    openSlotShare: Number(t.openSlotShare),
    similarityThreshold: Number(t.similarityThreshold),
    profileId: t.profileId,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    retiredAt: t.retiredAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/**
 * Which templates a list returns:
 * - offerable: the newest PUBLISHED version of each workflow (what FLOW 1 offers PMs);
 * - latest: the newest version of each workflow, any status (the Admin catalog view);
 * - all: every version.
 */
export function selectView<T extends Pick<Template, 'lineageId' | 'version' | 'status'>>(
  rows: T[],
  view: 'offerable' | 'latest' | 'all',
): T[] {
  if (view === 'all') return rows;
  const best = new Map<string, T>();
  for (const r of rows) {
    if (view === 'offerable' && r.status !== 'PUBLISHED') continue;
    const cur = best.get(r.lineageId);
    if (!cur || r.version > cur.version) best.set(r.lineageId, r);
  }
  return rows.filter((r) => best.get(r.lineageId) === r);
}

const isAdmin = (actor: Actor | null) => !!actor?.roles.includes('ADMIN');

const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({
  domainId: z.string().uuid().optional(),
  view: z.enum(['offerable', 'latest', 'all']).optional(),
});
const ADMIN = ['ADMIN'] as const;
const ADMIN_OR_PM = ['ADMIN', 'PM'] as const;

/** Serialises changes to one workflow's versions (e.g. two Admins creating a new draft at once). */
async function lockLineage(tx: Tx, lineageId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`template:${lineageId}`}))`;
}

async function assertUniqueWorkflowName(tx: Tx, clientId: string, domainId: string, name: string, lineageId?: string) {
  const clash = await tx.template.findFirst({
    where: {
      clientId,
      domainId,
      workflowName: { equals: name, mode: 'insensitive' },
      ...(lineageId ? { lineageId: { not: lineageId } } : {}),
    },
  });
  if (clash) throw conflict(`A workflow named "${clash.workflowName}" already exists in this domain`);
}

/** Maps request fields onto Prisma data. JSON fields are stored already validated and normalised. */
function fieldData(body: z.infer<typeof UpdateTemplateRequest>): Prisma.TemplateUncheckedUpdateInput {
  const data: Prisma.TemplateUncheckedUpdateInput = {};
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  if (body.workflowName !== undefined) data.workflowName = body.workflowName;
  if (body.primaryWork !== undefined) data.primaryWork = body.primaryWork;
  if (body.verificationCriteria !== undefined) data.verificationCriteria = body.verificationCriteria;
  if (body.humanGate !== undefined) data.humanGate = body.humanGate;
  if (body.taskDefinitionSchema !== undefined) data.taskDefinitionSchema = json(body.taskDefinitionSchema);
  if (body.collectionSchema !== undefined) data.collectionSchema = json(body.collectionSchema);
  if (body.defaultTptMinutes !== undefined) data.defaultTptMinutes = body.defaultTptMinutes;
  if (body.skills !== undefined) data.skills = [...new Set(body.skills)];
  if (body.taskModes !== undefined) data.taskModes = [...new Set(body.taskModes)];
  if (body.coverageDimensions !== undefined) data.coverageDimensions = json(body.coverageDimensions);
  if (body.edgeCaseCatalog !== undefined) data.edgeCaseCatalog = json(body.edgeCaseCatalog);
  if (body.defaultDistinctTarget !== undefined) data.defaultDistinctTarget = body.defaultDistinctTarget;
  if (body.defaultMaxPerExpert !== undefined) data.defaultMaxPerExpert = body.defaultMaxPerExpert;
  if (body.openSlotShare !== undefined) data.openSlotShare = body.openSlotShare;
  if (body.similarityThreshold !== undefined) data.similarityThreshold = body.similarityThreshold;
  if (body.profileId !== undefined) data.profileId = body.profileId;
  return data;
}

/** Admin template catalog: Domain -> Workflow templates, versioning, publish and retire (SPEC M1). */
export const templateRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const findTemplate = async (tx: Db | Tx, id: string, clientId: string) =>
    tx.template.findFirst({ where: { id, clientId }, include: { domain: true } });

  // ── Domains ──

  app.get(
    '/domains',
    { config: { access: ADMIN_OR_PM }, schema: { tags: ['templates'], response: { 200: z.object({ items: z.array(DomainDto) }) } } },
    async (req) => {
      const items = await db.domain.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { name: 'asc' } });
      return { items: items.map((d) => ({ id: d.id, name: d.name, status: d.status })) };
    },
  );

  app.post(
    '/domains',
    { config: { access: ADMIN }, schema: { tags: ['templates'], body: CreateDomainRequest, response: { 201: DomainDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const clash = await tx.domain.findFirst({
          where: { clientId: actor.clientId, name: { equals: req.body.name, mode: 'insensitive' } },
        });
        if (clash) throw conflict(`Domain "${clash.name}" already exists`);
        const d = await tx.domain.create({ data: { clientId: actor.clientId, name: req.body.name } });
        const body = { id: d.id, name: d.name, status: d.status };
        await audit({ entityType: 'Domain', entityId: d.id, action: 'domain.created', after: body });
        return { status: 201, body };
      });
      return reply;
    },
  );

  // ── Templates: reads ──

  app.get(
    '/templates',
    {
      config: { access: ADMIN_OR_PM },
      schema: { tags: ['templates'], querystring: ListQuery, response: { 200: z.object({ items: z.array(TemplateDto) }) } },
    },
    async (req) => {
      // PMs only ever see what FLOW 1 may offer; Admins default to one row per workflow.
      const view = isAdmin(req.actor) ? (req.query.view ?? 'latest') : 'offerable';
      const rows = await db.template.findMany({
        where: {
          clientId: req.actor!.clientId,
          ...(req.query.domainId ? { domainId: req.query.domainId } : {}),
          ...(view === 'offerable' ? { status: 'PUBLISHED', domain: { status: 'ACTIVE' } } : {}),
        },
        include: { domain: true },
        orderBy: [{ domain: { name: 'asc' } }, { workflowName: 'asc' }, { version: 'desc' }],
      });
      return { items: selectView(rows, view).map(toTemplateDto) };
    },
  );

  app.get(
    '/templates/:id',
    { config: { access: ADMIN_OR_PM }, schema: { tags: ['templates'], params: IdParams, response: { 200: TemplateDto } } },
    async (req) => {
      const t = await findTemplate(db, req.params.id, req.actor!.clientId);
      // PMs may read any PUBLISHED or RETIRED version (projects keep theirs), never drafts.
      if (!t || (!isAdmin(req.actor) && t.status === 'DRAFT')) throw notFound('Template not found');
      return toTemplateDto(t);
    },
  );

  app.get(
    '/templates/:id/versions',
    {
      config: { access: ADMIN },
      schema: { tags: ['templates'], params: IdParams, response: { 200: z.object({ items: z.array(TemplateDto) }) } },
    },
    async (req) => {
      const t = await findTemplate(db, req.params.id, req.actor!.clientId);
      if (!t) throw notFound('Template not found');
      const rows = await db.template.findMany({
        where: { lineageId: t.lineageId, clientId: req.actor!.clientId },
        include: { domain: true },
        orderBy: { version: 'desc' },
      });
      return { items: rows.map(toTemplateDto) };
    },
  );

  // ── Templates: commands ──

  app.post(
    '/templates',
    { config: { access: ADMIN }, schema: { tags: ['templates'], body: CreateTemplateRequest, response: { 201: TemplateDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const domain = await tx.domain.findFirst({ where: { id: req.body.domainId, clientId: actor.clientId } });
        if (!domain) throw notFound('Domain not found');
        await assertUniqueWorkflowName(tx, actor.clientId, domain.id, req.body.workflowName);
        await loadUploadedProfiles(tx as unknown as Db);
        assertProfile(req.body.workflowName, req.body.profileId);
        const { domainId, ...fields } = req.body;
        const t = await tx.template.create({
          data: {
            ...(fieldData(fields) as Prisma.TemplateUncheckedCreateInput),
            clientId: actor.clientId,
            domainId,
            workflowName: req.body.workflowName,
            lineageId: randomUUID(),
            version: 1,
            status: 'DRAFT',
          },
          include: { domain: true },
        });
        const body = toTemplateDto(t);
        await audit({ entityType: 'Template', entityId: t.id, action: 'template.created', after: body });
        return { status: 201, body };
      });
      return reply;
    },
  );

  app.patch(
    '/templates/:id',
    {
      config: { access: ADMIN },
      schema: { tags: ['templates'], params: IdParams, body: UpdateTemplateRequest, response: { 200: TemplateDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const before = await findTemplate(tx, req.params.id, actor.clientId);
        if (!before) throw notFound('Template not found');
        if (before.status !== 'DRAFT') {
          throw new AppError(409, 'TEMPLATE_NOT_EDITABLE', 'Only drafts can be edited. Create a new version to change a published template.');
        }
        if (req.body.workflowName !== undefined) {
          await assertUniqueWorkflowName(tx, actor.clientId, before.domainId, req.body.workflowName, before.lineageId);
        }
        await loadUploadedProfiles(tx as unknown as Db);
        assertProfile(req.body.workflowName ?? before.workflowName, req.body.profileId === undefined ? before.profileId : req.body.profileId);
        // Guard against a concurrent publish: only update while still DRAFT.
        const { count } = await tx.template.updateMany({ where: { id: before.id, status: 'DRAFT' }, data: fieldData(req.body) });
        if (count === 0) throw new AppError(409, 'TEMPLATE_NOT_EDITABLE', 'This draft was published or retired meanwhile.');
        const after = (await findTemplate(tx, before.id, actor.clientId))!;
        const changed = Object.keys(req.body) as (keyof TemplateDto)[];
        const pick = (dto: TemplateDto) => Object.fromEntries(changed.map((k) => [k, dto[k]]));
        await audit({
          entityType: 'Template',
          entityId: before.id,
          action: 'template.updated',
          before: pick(toTemplateDto(before)),
          after: pick(toTemplateDto(after)),
        });
        return { status: 200, body: toTemplateDto(after) };
      });
      return reply;
    },
  );

  app.post(
    '/templates/:id/versions',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, response: { 201: TemplateDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const source = await findTemplate(tx, req.params.id, actor.clientId);
        if (!source) throw notFound('Template not found');
        if (source.status === 'DRAFT') {
          throw new AppError(409, 'TEMPLATE_IS_DRAFT', 'This version is still a draft; edit it directly.');
        }
        await lockLineage(tx, source.lineageId);
        const versions = await tx.template.findMany({ where: { lineageId: source.lineageId }, orderBy: { version: 'desc' } });
        const draft = versions.find((v) => v.status === 'DRAFT');
        if (draft) {
          throw new AppError(409, 'DRAFT_EXISTS', `Version ${draft.version} of this workflow is already a draft (${draft.id}).`);
        }
        const { id: _id, createdAt: _c, updatedAt: _u, publishedAt: _p, retiredAt: _r, ...copy } = source;
        const t = await tx.template.create({
          data: {
            ...copy,
            domain: undefined,
            taskDefinitionSchema: copy.taskDefinitionSchema as Prisma.InputJsonValue,
            collectionSchema: copy.collectionSchema as Prisma.InputJsonValue,
            coverageDimensions: copy.coverageDimensions as Prisma.InputJsonValue,
            edgeCaseCatalog: copy.edgeCaseCatalog as Prisma.InputJsonValue,
            version: versions[0]!.version + 1,
            status: 'DRAFT',
          } as Prisma.TemplateUncheckedCreateInput,
          include: { domain: true },
        });
        const body = toTemplateDto(t);
        await audit({
          entityType: 'Template',
          entityId: t.id,
          action: 'template.version_created',
          before: { sourceId: source.id, sourceVersion: source.version },
          after: body,
        });
        return { status: 201, body };
      });
      return reply;
    },
  );

  app.post(
    '/templates/:id/publish',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, response: { 200: TemplateDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const t = await findTemplate(tx, req.params.id, actor.clientId);
        if (!t) throw notFound('Template not found');
        if (t.status !== 'DRAFT') throw new AppError(409, 'NOT_A_DRAFT', `Only drafts can be published (this one is ${t.status}).`);
        if (t.domain.status !== 'ACTIVE') throw conflict('The domain is retired');
        await loadUploadedProfiles(tx as unknown as Db);
        assertProfile(t.workflowName, t.profileId);
        const problems = publishProblems(t);
        if (problems.length > 0) {
          throw new AppError(422, 'TEMPLATE_INCOMPLETE', `Cannot publish yet: ${problems.join('; ')}.`);
        }
        await lockLineage(tx, t.lineageId);
        const { count } = await tx.template.updateMany({
          where: { id: t.id, status: 'DRAFT' },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
        if (count === 0) throw new AppError(409, 'NOT_A_DRAFT', 'This draft was published or retired meanwhile.');
        const after = (await findTemplate(tx, t.id, actor.clientId))!;
        await audit({
          entityType: 'Template',
          entityId: t.id,
          action: 'template.published',
          before: { status: 'DRAFT' },
          after: { status: 'PUBLISHED', version: after.version },
        });
        return { status: 200, body: toTemplateDto(after) };
      });
      return reply;
    },
  );

  app.post(
    '/templates/:id/retire',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, response: { 200: TemplateDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const t = await findTemplate(tx, req.params.id, actor.clientId);
        if (!t) throw notFound('Template not found');
        if (t.status !== 'PUBLISHED') throw new AppError(409, 'NOT_PUBLISHED', `Only published templates can be retired (this one is ${t.status}).`);
        await lockLineage(tx, t.lineageId);
        // Retiring hides the workflow from new projects: every published version of it is retired, so an older
        // version never resurfaces in FLOW 1. Projects keep the version row they reference, so nothing breaks.
        const published = await tx.template.findMany({ where: { lineageId: t.lineageId, status: 'PUBLISHED' } });
        const now = new Date();
        await tx.template.updateMany({
          where: { id: { in: published.map((p) => p.id) } },
          data: { status: 'RETIRED', retiredAt: now },
        });
        for (const p of published) {
          await audit({
            entityType: 'Template',
            entityId: p.id,
            action: 'template.retired',
            before: { status: 'PUBLISHED' },
            after: { status: 'RETIRED', version: p.version },
          });
        }
        return { status: 200, body: toTemplateDto((await findTemplate(tx, t.id, actor.clientId))!) };
      });
      return reply;
    },
  );
};
