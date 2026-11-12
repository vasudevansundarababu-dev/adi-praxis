import { Prisma } from '@prisma/client';
import {
  BlueprintResponse,
  HarborBlueprint,
  SaveBlueprintRequest,
  SaveVariantRequest,
  SaveVariantResponse,
  slugify,
  TemplateDirectoryResponse,
  validSectionCount,
} from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { stableStringify } from '../lib/crypto';
import { AppError, conflict, notFound } from '../lib/errors';
import { auditRead } from '../meta-compiler/audit';
import { blueprintOf, serverProblems } from '../meta-compiler/blueprint';
import { templateDirectory } from '../meta-compiler/directory';
import { runCommand } from '../platform/command';

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;
const ADMIN_OR_PM = ['ADMIN', 'PM'] as const;

async function findTemplate(tx: Db | Tx, id: string, clientId: string) {
  return tx.template.findFirst({ where: { id, clientId }, include: { domain: true } });
}

/** Serialises changes to one workflow's versions (same lock key as routes/templates.ts). */
async function lockLineage(tx: Tx, lineageId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`template:${lineageId}`}))`;
}

const notEditable = (status: string) => new AppError(409, 'TEMPLATE_NOT_EDITABLE', `Only drafts can be edited (this version is ${status}). Create a new version to change it.`);

/** Panel 0 is today's catalog fields (D11b): saving the blueprint keeps the template columns that publish and FLOW 1 read in step. */
export function catalogColumns(bp: HarborBlueprint): Prisma.TemplateUncheckedUpdateInput {
  const c = bp.catalog;
  return {
    primaryWork: c.primary_work || null,
    verificationCriteria: c.verification_criteria || null,
    humanGate: c.human_gate || null,
    skills: [...new Set(c.skills)],
    taskModes: [...new Set(c.task_modes)],
    defaultJdId: c.default_jd_id,
    coverageDimensions: c.coverage_dimensions as Prisma.InputJsonValue,
    edgeCaseCatalog: c.edge_case_catalog as Prisma.InputJsonValue,
    defaultDistinctTarget: c.default_distinct_target,
    defaultMaxPerExpert: c.default_max_per_expert,
    defaultTptMinutes: bp.template_meta.tpt_minutes,
    executionMode: bp.template_meta.modes[0] ?? null,
  };
}

/** Screens 1 and 2 of the Meta-Compiler: directory, blueprint, Save Variant, UISpec export (architecture section 5). */
export const metaCompilerRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const blueprintResponse = async (tx: Db | Tx, t: NonNullable<Awaited<ReturnType<typeof findTemplate>>>, admin: boolean): Promise<BlueprintResponse> => {
    const bp = blueprintOf(t);
    const problems = await serverProblems(tx, t, bp);
    return {
      templateId: t.id,
      lineageId: t.lineageId,
      version: t.version,
      templateStatus: t.status,
      editable: admin && t.status === 'DRAFT',
      blueprint: bp,
      blueprintRevision: t.blueprintRevision,
      problems,
      validSections: validSectionCount(problems),
      variantOfId: t.variantOfId,
    };
  };

  app.get(
    '/templates/directory',
    { config: { access: ADMIN_OR_PM }, schema: { tags: ['meta-compiler'], querystring: z.object({ includeRetired: z.enum(['true', 'false']).optional() }), response: { 200: TemplateDirectoryResponse } } },
    async (req) => {
      const admin = req.actor!.roles.includes('ADMIN');
      return templateDirectory(db, { clientId: req.actor!.clientId, view: admin ? 'ADMIN' : 'PM', includeRetired: admin && req.query.includeRetired === 'true', candidateAppUrl: config.CANDIDATE_APP_URL });
    },
  );

  app.get(
    '/templates/:id/blueprint',
    { config: { access: ADMIN_OR_PM }, schema: { tags: ['meta-compiler'], params: IdParams, response: { 200: BlueprintResponse } } },
    async (req) => {
      const admin = req.actor!.roles.includes('ADMIN');
      const t = await findTemplate(db, req.params.id, req.actor!.clientId);
      // PMs get a read-only summary of published versions only (D10, S1-15).
      if (!t || (!admin && t.status !== 'PUBLISHED')) throw notFound('Template not found');
      return blueprintResponse(db, t, admin);
    },
  );

  app.put(
    '/templates/:id/blueprint',
    { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, body: SaveBlueprintRequest, response: { 200: BlueprintResponse } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const before = await findTemplate(tx, req.params.id, actor.clientId);
        if (!before) throw notFound('Template not found');
        if (before.status !== 'DRAFT') throw notEditable(before.status);
        const bp = req.body.blueprint;
        if (bp.catalog.default_jd_id && !(await tx.jobDescription.findFirst({ where: { id: bp.catalog.default_jd_id, clientId: actor.clientId } }))) {
          throw new AppError(422, 'JD_NOT_FOUND', 'The default job description does not exist.');
        }
        const { count } = await tx.template.updateMany({
          where: { id: before.id, status: 'DRAFT', blueprintRevision: req.body.expectedRevision },
          data: { ...catalogColumns(bp), blueprint: bp as unknown as Prisma.InputJsonValue, blueprintRevision: { increment: 1 } },
        });
        if (count === 0) {
          const now = await tx.template.findUniqueOrThrow({ where: { id: before.id } });
          if (now.status !== 'DRAFT') throw notEditable(now.status);
          throw new AppError(409, 'BLUEPRINT_CONFLICT', 'Someone else saved this blueprint meanwhile. Reload to see their changes.', { revision: now.blueprintRevision });
        }
        const after = (await findTemplate(tx, before.id, actor.clientId))!;
        const body = await blueprintResponse(tx, after, true);
        await audit({
          entityType: 'Template',
          entityId: before.id,
          action: 'template.blueprint_saved',
          before: { revision: before.blueprintRevision },
          after: { revision: after.blueprintRevision, validSections: body.validSections, studioId: bp.studio_id },
        });
        return { status: 200, body };
      });
      return reply;
    },
  );

  app.post(
    '/templates/:id/variant',
    { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, body: SaveVariantRequest, response: { 201: SaveVariantResponse } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const source = await findTemplate(tx, req.params.id, actor.clientId);
        if (!source) throw notFound('Template not found');
        const label = req.body.label;
        // Serialise variant creation per domain so two Admins cannot take the same label at once.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`domain-labels:${source.domainId}`}))`;
        const clash = await tx.template.findFirst({ where: { clientId: actor.clientId, domainId: source.domainId, workflowName: { equals: label, mode: 'insensitive' } } });
        if (clash) throw conflict(`A workflow named "${clash.workflowName}" already exists in this domain`);
        const bp = blueprintOf(source);
        const lineageId = randomUUID();
        bp.template_meta = { ...bp.template_meta, label, version: 1, template_id: '' };
        bp.studio_id = await uniqueStudioId(tx, actor.clientId, slugify(label).replace(/_/g, '-'));
        const { id: _i, createdAt: _c, updatedAt: _u, publishedAt: _p, retiredAt: _r, domain: _d, blueprint: _b, ...copy } = source;
        const t = await tx.template.create({
          data: {
            ...copy,
            taskDefinitionSchema: copy.taskDefinitionSchema as Prisma.InputJsonValue,
            collectionSchema: copy.collectionSchema as Prisma.InputJsonValue,
            coverageDimensions: copy.coverageDimensions as Prisma.InputJsonValue,
            edgeCaseCatalog: copy.edgeCaseCatalog as Prisma.InputJsonValue,
            // A variant is a new workflow: a chosen form and Anvil's spec belong to the source workflow, not to it.
            profileId: null,
            anvilSpec: Prisma.DbNull,
            workflowName: label,
            lineageId,
            version: 1,
            status: 'DRAFT',
            blueprint: bp as unknown as Prisma.InputJsonValue,
            blueprintRevision: 0,
            variantOfId: source.id,
          },
        });
        const body = { templateId: t.id, lineageId, version: 1 as const, variantOfId: source.id };
        await audit({ entityType: 'Template', entityId: t.id, action: 'template.variant_created', before: { sourceId: source.id, sourceVersion: source.version }, after: { ...body, label } });
        return { status: 201, body };
      });
      return reply;
    },
  );

  app.get(
    '/templates/:id/uispec',
    { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams } },
    async (req, reply) => {
      const t = await findTemplate(db, req.params.id, req.actor!.clientId);
      if (!t) throw notFound('Template not found');
      const bp = blueprintOf(t);
      const text = `${JSON.stringify(JSON.parse(stableStringify(bp)), null, 2)}\n`;
      await auditRead(db, req, { entityType: 'Template', entityId: t.id, action: 'template.uispec_exported', after: { version: t.version, revision: t.blueprintRevision } });
      const name = (bp.studio_id || slugify(t.workflowName)).replace(/[^A-Za-z0-9_-]/g, '_');
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}-v${t.version}.UISpec.json"`)
        .send(text);
    },
  );
};

async function uniqueStudioId(tx: Tx, clientId: string, base: string): Promise<string> {
  const stem = (/^[a-z0-9]/.test(base) ? base : `s-${base}`).slice(0, 90) || 'studio';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? stem : `${stem}-${n}`;
    const taken = await tx.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM "Template" WHERE client_id = ${clientId}::uuid AND blueprint->>'studio_id' = ${candidate} LIMIT 1`;
    if (!taken.length) return candidate.length >= 3 ? candidate : `${candidate}-studio`;
  }
}
