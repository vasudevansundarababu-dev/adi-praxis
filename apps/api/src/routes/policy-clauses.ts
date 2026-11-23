import { FactCatalog } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, policyProject } from '../policy/access';
import { approvedClauses, projectFactCatalog, templateBoundFacts } from '../policy/fact-catalog';
import { jcsSha256 } from '../anvil/jcs';
import { ownTask } from './work';

/**
 * E-002 §4.1 (owner decisions 23 Nov 2026): the project scope's fact catalog, the approved clause versions with their
 * conditions in plain language, and the S4 clause list for an SME's task ("setup needed" when the template does not bind
 * a fact the condition needs; shown, never hidden). The SME selects clauses; only the PM approves conditions.
 */
const ProjectParams = z.object({ projectId: z.string().uuid() });

export const policyClauseRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get('/projects/:projectId/policy/fact-catalog', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const row = await db.projectFactCatalog.findFirst({ where: { projectId: p.id }, orderBy: { version: 'desc' } });
    return { catalog: row ? (row.catalog as unknown) : null, version: row?.version ?? null, at: row?.createdAt.toISOString() ?? null };
  });

  // A new version of the project's fact catalog (frozen and versioned; earlier versions stay).
  app.put('/projects/:projectId/policy/fact-catalog', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: FactCatalog } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      if (req.body.owner.kind !== 'project_scope' || req.body.owner.id !== p.id) throw new AppError(422, 'NOT_PROJECT_SCOPE', 'A project fact catalog has owner kind project_scope and this project’s ID.');
      const latest = await tx.projectFactCatalog.findFirst({ where: { projectId: p.id }, orderBy: { version: 'desc' } });
      const { version: _v, ...content } = req.body;
      if (latest && jcsSha256({ ...(latest.catalog as Record<string, unknown>), version: 0 }) === jcsSha256({ ...content, version: 0 })) {
        await audit({ entityType: 'ProjectFactCatalog', entityId: latest.id, action: 'policy.fact_catalog_unchanged', after: { version: latest.version } });
        return { status: 200, body: { version: latest.version, unchanged: true } };
      }
      const version = (latest?.version ?? 0) + 1;
      const row = await tx.projectFactCatalog.create({ data: { clientId: actor.clientId, projectId: p.id, version, catalog: { ...content, version } as object, createdById: actor.userId } });
      await audit({ entityType: 'ProjectFactCatalog', entityId: row.id, action: 'policy.fact_catalog_saved', after: { version, facts: req.body.facts.map((f) => f.id) } });
      return { status: 201, body: { version } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/clauses', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    return { factCatalogVersion: (await projectFactCatalog(db, p.id))?.version ?? null, templateBinds: templateBoundFacts(project.template.anvilSpec), items: await approvedClauses(db, req.actor!.clientId, p.id, project.template.anvilSpec) };
  });

  // The S4 clause list for the SME's own task: approved versions only; the SME selects, never edits a condition.
  app.get('/me/tasks/:id/policy-clauses', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const items = await approvedClauses(db, t.clientId, t.projectId, t.project.template.anvilSpec);
    return { items: items.map(({ approval: _a, ...c }) => c) };
  });
};
