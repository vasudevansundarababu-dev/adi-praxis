import { aiFailureKind, aiUnavailableMessage } from '../lib/ai-errors';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError } from '../lib/errors';
import { jointTemplateSpec } from '../anvil/joint-template';
import { declaredToolIds } from '../anvil/tool-binding';
import { StepTranslatorUnavailableError, translateSteps, TRANSLATE_MAX_TEXT, type StepTranslator } from '../tasks/steps/translator';
import { ownTask } from './work';

/**
 * D-016: POST /me/tasks/:id/steps/translate turns the SME's business-language procedure into proposed S5 steps with
 * tools from the template's own tool list. Nothing is stored; the SME reviews the proposal and applies it in the form.
 */
export const stepTranslateRoutes: FastifyPluginAsyncZod<{ db: Db; translator: StepTranslator }> = async (app, { db, translator }) => {
  app.post('/me/tasks/:id/steps/translate', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: z.object({ id: z.string().uuid() }), body: z.object({ text: z.string().trim().min(10).max(TRANSLATE_MAX_TEXT) }).strict() } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    if (t.taskType !== 'AUTHORING' || !['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) throw new AppError(409, 'READ_ONLY', 'This task cannot be edited now.');
    const spec = jointTemplateSpec(t.project.template);
    const offered = spec ? declaredToolIds(spec.execution) : null;
    if (!offered?.length) throw new AppError(422, 'NO_TOOLS', 'This template does not list tools, so steps cannot be matched to tools.');
    try {
      return await translateSteps(translator, req.body.text, offered);
    } catch (err) {
      if (err instanceof StepTranslatorUnavailableError) throw new AppError(503, 'TRANSLATOR_UNAVAILABLE', aiUnavailableMessage(err, 'Step drafting', 'You can add the steps yourself.', 'The steps could not be drafted just now. Try again, or add the steps yourself.'), { reason: aiFailureKind(err) });
      throw err;
    }
  });
};
