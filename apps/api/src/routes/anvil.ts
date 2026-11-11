import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROJECT_POLICY_SCHEMA_VERSION } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import { createHash } from 'node:crypto';
import { AppError, notFound } from '../lib/errors';
import { policyProject } from '../policy/access';
import { buildProjectPolicyManifest } from '../policy/anvil-project-policy';

const Params = z.object({ id: z.string().uuid() });
const SourceParams = Params.extend({ '*': z.string().min(1).max(240) });
/** Same audience as the praxis-contract export, plus the project's own PM: Admins, the owning PM, RL Gym's API key. */
const READ = { roles: ['ADMIN', 'PM'] as const, apiClient: 'RL_GYM' as const };

/**
 * Anvil project policy manifest v1 (docs/integrations/ANVIL-PROJECT-POLICY-V1.md). Read-only: every response is built
 * fresh from published rule sets and approved records, validated with the shared validator, and audited. An invalid
 * manifest is never served: the response is 409 with the problem list.
 */
export const anvilRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage }> = async (app, { db, storage }) => {
  /** Admin: any project of the tenant; PM: only the projects they own; RL Gym: any project of its tenant. Else 404. */
  async function project(req: FastifyRequest, id: string) {
    if (req.actor) return policyProject(db, req.actor, id);
    const p = await db.project.findFirst({ where: { id, clientId: req.apiClient!.clientId }, select: { id: true, clientId: true, name: true } });
    if (!p) throw notFound('Project not found');
    return p;
  }
  const audit = (req: FastifyRequest, p: { id: string; clientId: string }, action: string, after: object) =>
    db.auditEvent.create({ data: { clientId: p.clientId, actorType: req.actor ? 'USER' : 'SERVICE', actorId: req.actor?.userId ?? req.apiClient!.apiClientId, requestId: String(req.id), entityType: 'Project', entityId: p.id, action, after } });

  async function build(req: FastifyRequest, id: string) {
    const p = await project(req, id);
    const built = await buildProjectPolicyManifest(db, storage, p);
    if (built.problems.length) {
      await audit(req, p, 'anvil.project_policy_blocked', { codes: [...new Set(built.problems.map((x) => x.code))] });
      throw new AppError(409, 'PROJECT_POLICY_INVALID', 'The project policy manifest is not valid, so it was not exported.', { problems: built.problems });
    }
    return { p, built };
  }

  app.get('/projects/:id/anvil/project-policy', {
    config: { access: READ },
    schema: { tags: ['anvil'], summary: 'Anvil project policy manifest (praxis.anvil.project_policy.v1)', params: Params },
  }, async (req, reply) => {
    const { p, built } = await build(req, req.params.id);
    await audit(req, p, 'anvil.project_policy_exported', { manifestSha256: built.sha256, version: built.manifest.source_project.version, policies: built.manifest.policies.length, sources: built.manifest.sources.length, taskBindings: built.manifest.task_bindings.length });
    return reply.header('content-type', 'application/json')
      .header('content-disposition', `attachment; filename="praxis-project-policy-${p.id}.json"`)
      .header('x-praxis-schema-version', PROJECT_POLICY_SCHEMA_VERSION)
      .header('x-praxis-manifest-sha256', built.sha256)
      .send(built.bytes);
  });

  app.get('/projects/:id/anvil/project-policy/sources/*', {
    config: { access: READ },
    schema: { tags: ['anvil'], summary: 'Exact bytes of one source declared in the project policy manifest', params: SourceParams },
  }, async (req, reply) => {
    const { p, built } = await build(req, req.params.id);
    const path = req.params['*'];
    const source = built.manifest.sources.find((s) => s.path === path);
    const bytes = built.sources.get(path);
    if (!source || !bytes) throw notFound('Source not found in this project policy manifest');
    const digest = createHash('sha256').update(bytes).digest('hex');
    await audit(req, p, 'anvil.project_policy_source_downloaded', { path, sha256: digest, manifestSha256: built.sha256 });
    return reply.header('content-type', source.media_type)
      .header('content-disposition', `attachment; filename="${path.split('/').pop()}"`)
      .header('x-praxis-source-sha256', digest)
      .header('x-praxis-manifest-sha256', built.sha256)
      .send(bytes);
  });
};
