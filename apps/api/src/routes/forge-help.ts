import { TaskHelpRequest } from '@praxis/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { requireForgeTerms } from '../forge/candidate';
import { requireNewFlow, reviewerTaskView } from '../forge/review';
import { commentsOf, helpGuides, publishedRules, sectionStatus, taskBasics, type TaskHelpContext } from '../forge/task-help';
import { AppError } from '../lib/errors';
import { SupportUnavailableError, type SupportAssistant, type SupportContext } from '../support/assistant';
import { SME_HELP } from '../support/help-pack';
import { profileFor } from '../tasks/profile-output';
import { templateRef } from '../tasks/task-service';
import { ownTask } from './work';

/**
 * MVP1 step 7: Help scoped to one task, for the author (their own task) and for the task's assigned Reviewer. The
 * same Support Bot and model as /me/support/ask, with the task-scope rules and only the task's minimal context. It
 * explains and gives generic examples; it never writes the task and never decides. Questions are not stored.
 */
const perSession = { max: 20, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => r.cookies?.praxis_candidate ?? r.ip };

export const forgeHelpRoutes: FastifyPluginAsyncZod<{ db: Db; assistant: SupportAssistant }> = async (app, { db, assistant }) => {
  async function answer(req: FastifyRequest, scope: NonNullable<SupportContext['scope']>, context: TaskHelpContext, templates: string[], body: TaskHelpRequest) {
    const started = Date.now();
    try {
      const r = await assistant.answer(
        { audience: 'SME', roles: [scope === 'TASK_REVIEWER' ? 'Reviewer' : 'SME'], help: SME_HELP, scope, templates, record: { source: 'this task', data: context }, screen: { path: '/', title: scope === 'TASK_REVIEWER' ? 'Review a task' : 'Task', headings: context.template.sections.map((s) => `${s.section} ${s.title}`), fields: [], messages: [] } },
        body.history,
        body.question,
      );
      req.log.info({ taskHelp: { scope, model: assistant.model, ms: Date.now() - started, ...r.usage } }, 'task help answer');
      return { answer: r.answer, scoped: true as const };
    } catch (err) {
      if (err instanceof SupportUnavailableError) throw new AppError(503, 'SUPPORT_UNAVAILABLE', 'Help is not available right now. Try again in a minute.');
      throw err;
    }
  }

  // The author's own task: the same access as GET /me/tasks/:id (with or without the new flow).
  app.post('/me/tasks/:id/help', { config: { access: 'candidate', rateLimit: perSession }, schema: { tags: ['work'], params: z.object({ id: z.string().uuid() }), body: TaskHelpRequest } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const template = await templateRef(db, t.project.templateId);
    const profile = profileFor({ workflowName: template.workflowName, profileId: template.profileId });
    const context: TaskHelpContext = {
      task: taskBasics(t),
      template: { name: template.workflowName, sections: sectionStatus(profile, t.output) },
      rules: await publishedRules(db, t),
      reviewComments: commentsOf(t.reviews[0]?.comments),
    };
    return answer(req, 'TASK_AUTHOR', context, helpGuides(profile), req.body);
  });

  // A task this person is the assigned Reviewer for: the same access as GET /me/reviews/:taskId.
  app.post('/me/reviews/:taskId/help', { config: { access: 'candidate', rateLimit: perSession }, schema: { tags: ['work'], params: z.object({ taskId: z.string().uuid() }), body: TaskHelpRequest } }, async (req) => {
    await requireNewFlow(db, req.candidate!.clientId);
    await requireForgeTerms(db, req.candidate!);
    const v = await reviewerTaskView(db, req.candidate!, req.params.taskId);
    const context: TaskHelpContext = {
      task: taskBasics({ status: v.taskStatus, input: v.input, coverageTags: v.coverageTags }),
      template: { name: v.template.workflow, sections: sectionStatus(v.template.profile, v.output) },
      rules: await publishedRules(db, { id: v.taskId, projectId: v.project.id, clientId: req.candidate!.clientId }),
      reviewComments: v.myDecisions.flatMap((d) => commentsOf(d.comments)),
    };
    return answer(req, 'TASK_REVIEWER', context, helpGuides(v.template.profile), req.body);
  });
};
