import { ForgeTermsAcceptRequest, type ForgeHomeDto } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import type { Db } from '../db';
import { acceptForgeTerms, forgeAuthorTasks, forgeTermsAccepted, forgeTermsView, placeholderTermsRefused } from '../forge/candidate';
import { requireNewFlow, reviewerTaskList } from '../forge/review';
import { forgeSettings } from '../forge/settings';
import { runCandidateCommand } from '../platform/command';

/** MVP1 step 3: the candidate app's Before you start screen (terms) and Home task list. */
export const forgeCandidateRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const refusePlaceholder = placeholderTermsRefused(config);

  app.get('/me/forge/terms', { config: { access: 'candidate' }, schema: { tags: ['candidate'] } }, async (req) => {
    await requireNewFlow(db, req.candidate!.clientId);
    // D3 wording (RUBRIC_RECOMMENDATIONS_ENABLED; off by default): the declaration's exact owner-approved text.
    return { ...(await forgeTermsView(db, req.candidate!)), declarationV2: config.RUBRIC_RECOMMENDATIONS_ENABLED };
  });

  app.post('/me/forge/terms', { config: { access: 'candidate' }, schema: { tags: ['candidate'], body: ForgeTermsAcceptRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await requireNewFlow(tx, actor.clientId);
      return { status: 200, body: await acceptForgeTerms(tx, actor, req.body, refusePlaceholder, audit) };
    });
    return reply;
  });

  app.get('/me/forge/home', { config: { access: 'candidate' }, schema: { tags: ['candidate'] } }, async (req): Promise<ForgeHomeDto> => {
    const actor = req.candidate!;
    const me = await db.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId }, select: { displayName: true } });
    if (!(await forgeSettings(db, actor.clientId)).newFlow) return { newFlow: false, termsAccepted: false, name: me.displayName, authorTasks: [], reviewTasks: [] };
    const [termsAccepted, authorTasks, reviewTasks] = await Promise.all([forgeTermsAccepted(db, actor.smeUserId, actor.clientId), forgeAuthorTasks(db, actor), reviewerTaskList(db, actor)]);
    return { newFlow: true, termsAccepted, name: me.displayName, authorTasks, reviewTasks };
  });
};
