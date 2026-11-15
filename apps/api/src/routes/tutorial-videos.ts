import { OPEN_TUTORIAL_RUN_STATUSES, RejectTutorialRequest, TutorialRunDto, TutorialRunsResponse } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SignedUrlStorage } from '../candidate/storage';
import type { Db } from '../db';
import { notFound } from '../lib/errors';
import { runCommand, type CommandContext } from '../platform/command';
import { approveTutorialRun, generationStatus, rejectTutorialRun, requestTutorialRun, toRunDto, type TutorialSettings } from '../forge/tutorial-video/service';

const ADMIN = ['ADMIN'] as const;
const IdParams = z.object({ id: z.string().uuid() });
const GenerateResponse = z.object({ outcome: z.enum(['started', 'existing', 'refused']), reason: z.string().nullable(), run: TutorialRunDto.nullable() });

/**
 * D2 (docs/plan/PLAN-D2-TUTORIAL-VIDEO.md): the Admin's tutorial video panel on a template. Generate (in every
 * environment where generation is on; the only trigger in QA), preview, approve or reject. Admin only.
 */
export const tutorialVideoRoutes: FastifyPluginAsyncZod<{ db: Db; settings: TutorialSettings; storage: SignedUrlStorage }> = async (app, { db, settings, storage }) => {
  const runsOf = (clientId: string, lineageId: string) =>
    db.templateTutorialRun.findMany({ where: { clientId, lineageId }, orderBy: { createdAt: 'desc' }, take: 20, include: { template: { select: { version: true } } } });

  app.get(
    '/templates/:id/tutorial/runs',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, response: { 200: TutorialRunsResponse } } },
    async (req) => {
      const clientId = req.actor!.clientId;
      const t = await db.template.findFirst({ where: { id: req.params.id, clientId } });
      if (!t) throw notFound('Template not found');
      const runs = await runsOf(clientId, t.lineageId);
      const open = runs.find((r) => (OPEN_TUTORIAL_RUN_STATUSES as readonly string[]).includes(r.status)) ?? null;
      const g = await generationStatus(db, settings, t, open);
      return {
        runs: await Promise.all(runs.map((r) => toRunDto(r, storage))),
        generation: { blockedReason: g.blockedReason, live: g.live, estimatedUsd: g.estimatedUsd, spentTodayUsd: g.spentTodayUsd, costCapUsd: g.costCapUsd, dailyCapUsd: g.dailyCapUsd, chapters: g.chapters },
      };
    },
  );

  app.post(
    '/templates/:id/tutorial/generate',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, response: { 202: GenerateResponse, 200: GenerateResponse, 409: GenerateResponse } } },
    async (req, reply) => {
      await runCommand<z.infer<typeof GenerateResponse>>(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const t = await tx.template.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!t) throw notFound('Template not found');
        const out = await requestTutorialRun(tx, { clientId: actor.clientId, audit, emit }, settings, { template: t, trigger: 'ADMIN', requestedBy: actor.userId });
        if (out.kind === 'refused') return { status: 409, body: { outcome: 'refused' as const, reason: out.reason, run: null } };
        if (out.kind === 'existing') {
          // Nothing changed; the command still records that the Admin asked.
          await audit({ entityType: 'TemplateTutorialRun', entityId: out.run.id, action: 'template.tutorial_request_repeated', after: { status: out.run.status } });
        }
        const run = await toRunDto({ ...out.run, template: { version: t.version } }, null);
        return { status: out.kind === 'started' ? 202 : 200, body: { outcome: out.kind, reason: null, run } };
      });
      return reply;
    },
  );

  async function decide(action: 'approve' | 'reject', runId: string, reason: string | null, { tx, actor, audit }: CommandContext) {
    const run = action === 'approve' ? await approveTutorialRun(tx, actor.clientId, runId, actor.userId, audit) : await rejectTutorialRun(tx, actor.clientId, runId, actor.userId, reason!, audit);
    const version = (await tx.template.findUnique({ where: { id: run.templateId }, select: { version: true } }))!.version;
    return toRunDto({ ...run, template: { version } }, storage);
  }

  app.post(
    '/tutorial-runs/:id/approve',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, response: { 200: TutorialRunDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async (ctx) => ({ status: 200, body: await decide('approve', req.params.id, null, ctx) }));
      return reply;
    },
  );

  app.post(
    '/tutorial-runs/:id/reject',
    { config: { access: ADMIN }, schema: { tags: ['templates'], params: IdParams, body: RejectTutorialRequest, response: { 200: TutorialRunDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async (ctx) => ({ status: 200, body: await decide('reject', req.params.id, req.body.reason, ctx) }));
      return reply;
    },
  );
};
