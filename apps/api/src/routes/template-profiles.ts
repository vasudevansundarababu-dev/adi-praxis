import { isUploadedProfile, profileById, profileForWorkflow, registeredProfiles, workflowKey, type TemplateProfile } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { loadUploadedProfiles } from '../templates/uploaded-profiles';
import { checkPack, storePack } from '../templates/golden-pack-store';

const FormSummary = z.object({
  profileId: z.string(),
  name: z.string(),
  workflowName: z.string(),
  source: z.enum(['builtin', 'uploaded']),
  /** The workflow's default form (used when a template version chooses none). */
  isDefault: z.boolean(),
  agentMode: z.enum(['SINGLE', 'MULTI']),
  version: z.number().int(),
  examples: z.number().int(),
  uploadedAt: z.string().nullable(),
  /** Set when the upload created the workflow's draft template (the workflow did not exist yet). */
  createdTemplateId: z.string().uuid().nullable().optional(),
});
type FormSummary = z.infer<typeof FormSummary>;

const summary = (p: TemplateProfile, row?: { examples: unknown; createdAt: Date }): FormSummary => ({
  profileId: p.profileId,
  name: p.handoverName ?? p.catalogWorkflowName,
  workflowName: p.catalogWorkflowName,
  source: isUploadedProfile(p.profileId) ? 'uploaded' : 'builtin',
  isDefault: (() => {
    const d = profileForWorkflow(p.catalogWorkflowName);
    return d.status === 'ok' && d.profile.profileId === p.profileId;
  })(),
  agentMode: p.agentMode,
  version: p.version,
  examples: Array.isArray(row?.examples) ? row.examples.length : 0,
  uploadedAt: row?.createdAt.toISOString() ?? null,
});

/**
 * Authoring forms and golden task packs (owner, 12 Nov 2026). Admins upload a pack (form + worked golden cases) without
 * a code change; a template version then chooses the form. Validation only: nothing here runs or grades a task.
 */
export const templateProfileRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  await loadUploadedProfiles(db);
  const timer = setInterval(() => void loadUploadedProfiles(db).catch(() => undefined), 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  app.get(
    '/template-profiles',
    { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['templates'], querystring: z.object({ workflow: z.string().max(200).optional() }), response: { 200: z.object({ items: z.array(FormSummary) }) } } },
    async (req) => {
      await loadUploadedProfiles(db);
      const rows = new Map((await db.uploadedProfile.findMany({ where: { clientId: req.actor!.clientId }, select: { profileId: true, examples: true, createdAt: true } })).map((r) => [r.profileId, r]));
      const items = registeredProfiles()
        .filter((p) => !isUploadedProfile(p.profileId) || rows.has(p.profileId))
        .filter((p) => !req.query.workflow || workflowKey(p.catalogWorkflowName) === workflowKey(req.query.workflow))
        .map((p) => summary(p, rows.get(p.profileId)));
      return { items };
    },
  );

  app.get(
    '/template-profiles/:profileId',
    { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['templates'], params: z.object({ profileId: z.string().max(80) }) } },
    async (req) => {
      await loadUploadedProfiles(db);
      const row = await db.uploadedProfile.findUnique({ where: { profileId: req.params.profileId } });
      if (row && row.clientId !== req.actor!.clientId) throw notFound('Form not found');
      const p = profileById(req.params.profileId);
      if (!p) throw notFound('Form not found');
      return { summary: summary(p, row ?? undefined), profile: p, examples: req.actor!.roles.includes('ADMIN') && row ? row.examples : [], source: row?.source ?? null };
    },
  );

  /** Checks a pack without storing it: the console shows every problem before upload. */
  app.post(
    '/template-profiles/check',
    { config: { access: ['ADMIN'] }, bodyLimit: 2_000_000, schema: { tags: ['templates'], body: z.record(z.string(), z.unknown()) } },
    async (req) => {
      const r = await checkPack(db, req.body);
      return { ok: r.ok, problems: r.problems, examples: r.examples, form: r.profile ? { profileId: r.profile.profileId, workflowName: r.profile.catalogWorkflowName, agentMode: r.profile.agentMode } : null };
    },
  );

  app.post(
    '/template-profiles',
    { config: { access: ['ADMIN'] }, bodyLimit: 2_000_000, schema: { tags: ['templates'], body: z.record(z.string(), z.unknown()), response: { 201: FormSummary } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const { row, check: r, createdTemplateId } = await storePack(tx, { clientId: actor.clientId, uploaderId: actor.userId, body: req.body, audit, from: 'golden_pack' });
        const profile = r.profile!;
        return { status: 201, body: { profileId: row.profileId, name: profile.handoverName ?? profile.catalogWorkflowName, workflowName: row.workflowName, source: 'uploaded' as const, isDefault: false, agentMode: profile.agentMode, version: profile.version, examples: r.examples.length, uploadedAt: row.createdAt.toISOString(), createdTemplateId } };
      });
      // Register on this instance now; others pick it up within a minute.
      await loadUploadedProfiles(db);
      return reply;
    },
  );
};
