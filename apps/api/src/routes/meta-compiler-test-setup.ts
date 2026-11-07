import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { seedPlaceholderTerms } from '../candidate/onboarding-service';
import { AppError } from '../lib/errors';
import { deployStudio } from '../meta-compiler/deployments';
import { ensureFixtures, ensureVerified, type Fixtures, type VerifyDeps } from '../meta-compiler/test-setup';
import { writeAudit } from '../platform/audit';
import { IDEMPOTENCY_HEADER, runCommand } from '../platform/command';

const Request = z.object({
  /** An existing candidate account to use as the test SME (staging, where sign-in is real Google). Default: a synthetic SME. */
  smeEmail: z.string().email().max(320).optional(),
});
const Response = z.object({
  templateId: z.string().uuid(),
  templateVersion: z.number().int(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  verificationRunId: z.string().uuid(),
  deploymentId: z.string().uuid(),
  studioKey: z.string(),
  studioUrl: z.string(),
  sme: z.object({ smeUserId: z.string().uuid(), candidateId: z.string().uuid(), email: z.string() }),
  /** `temporaryPassword` only when the Reviewer was created by this call; a replay or a later call never shows it. */
  reviewer: z.object({ userId: z.string().uuid(), email: z.string(), temporaryPassword: z.string().nullable() }),
  created: z.array(z.string()),
});

/** D4a, S4-14: `POST /test-setup/meta-compiler`. Admin only, refused in production, idempotent and audited. */
export const metaCompilerTestSetupRoutes: FastifyPluginAsyncZod<VerifyDeps> = async (app, w) => {
  const { db, config } = w;
  app.post(
    '/test-setup/meta-compiler',
    { config: { access: ['ADMIN'], rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['meta-compiler'], body: Request, response: { 200: Response } } },
    async (req, reply) => {
      if (config.appEnv === 'production') throw new AppError(403, 'TEST_SETUP_DISABLED', 'The test setup is not available in production.');
      // D-12: as for every verification, staging never "measures" with the mock runner.
      if (w.runner.kind === 'mock' && config.appEnv === 'staging') {
        throw new AppError(409, 'RUNNER_UNAVAILABLE', 'Verification needs the sandbox job in this environment (HARBOR_RUNNER=job); the mock runner cannot produce real scores.');
      }
      const actor = req.actor!;
      const key = req.headers[IDEMPOTENCY_HEADER];
      const stored = typeof key === 'string' ? await db.idempotencyKey.findUnique({ where: { actorId_key: { actorId: actor.userId, key } } }) : null;
      let ready: { f: Fixtures; verificationRunId: string } | null = null;
      if (!(stored && stored.expiresAt > new Date())) {
        const ctx = { clientId: actor.clientId, actorType: 'USER' as const, actorId: actor.userId, requestId: String(req.id) };
        // Placeholder terms are create-only and allowed outside production (FLOW2 section 11).
        await seedPlaceholderTerms(db, actor.clientId, actor.userId);
        const f = await db.$transaction((tx) => ensureFixtures(tx, { clientId: actor.clientId, adminId: actor.userId, smeEmail: req.body.smeEmail }, (input) => writeAudit(tx, ctx, input)), { timeout: 15_000 });
        ready = { f, verificationRunId: await ensureVerified(w, f, ctx) };
      }
      await runCommand(db, req, reply, async (cmd) => {
        const { f, verificationRunId } = ready!;
        const d = await deployStudio(cmd, { templateId: f.templateId, verificationRunId, projectId: f.projectId, candidateId: f.candidateId, candidateAppUrl: config.CANDIDATE_APP_URL });
        const body = {
          templateId: f.templateId,
          templateVersion: f.templateVersion,
          projectId: f.projectId,
          projectName: f.projectName,
          verificationRunId,
          deploymentId: d.body.id,
          studioKey: d.body.studioKey,
          studioUrl: d.body.studioUrl,
          sme: { smeUserId: f.smeUserId, candidateId: f.candidateId, email: f.smeEmail },
          reviewer: { userId: f.reviewerUserId, email: f.reviewerEmail, temporaryPassword: f.temporaryPassword },
          created: f.created,
        };
        await cmd.audit({ entityType: 'StudioDeployment', entityId: d.body.id, action: 'test_setup.meta_compiler_ready', after: { ...body, reviewer: { userId: f.reviewerUserId, email: f.reviewerEmail } } });
        return { status: 200, body, replayBody: { ...body, reviewer: { ...body.reviewer, temporaryPassword: null } } };
      });
      return reply;
    },
  );
};
