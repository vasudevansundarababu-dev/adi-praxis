import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import type { Db } from '../db';
import { parseAuthoringModel } from '../tasks/conversation/assistant';

/**
 * Authoring v2.1 QA: which model providers this deployment actually uses (live Vertex or local mock), the models
 * configured, and today's chatbot usage against its cap. No secrets, keys or prompts are returned.
 */
export const modelProviderRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  app.get('/admin/model-providers', { config: { access: ['ADMIN'] as const }, schema: { tags: ['admin'] } }, async (req) => {
    const live = config.assistantMode === 'vertex';
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const clientId = req.actor!.clientId;
    const callsToday = await db.taskDraftRun.count({ where: { clientId, section: 'CHAT', createdAt: { gte: since } } });
    const failedToday = await db.taskDraftRun.count({ where: { clientId, section: 'CHAT', createdAt: { gte: since }, status: 'FAILED' } });
    return {
      mode: live ? 'vertex' : 'mock',
      vertex: live ? { projectConfigured: true, location: config.VERTEX_LOCATION } : { projectConfigured: false, location: null },
      models: {
        authoringChatbot: live ? config.AUTHORING_MODEL : 'mock-conversation-no-model',
        authoringChatbotVendor: live ? parseAuthoringModel(config.AUTHORING_MODEL).vendor : 'mock',
        support: live ? config.SUPPORT_MODEL : 'mock',
        certification: live ? config.CERT_MODEL : 'mock',
        embeddings: live ? config.EMBEDDING_MODEL : 'local-hashing-mock',
      },
      authoringChatbot: { dailyCallCap: config.AUTHORING_DAILY_CALL_CAP, callsToday, failedToday, resetsAt: new Date(since.getTime() + 86_400_000).toISOString() },
      note: live ? 'Live Vertex: calls are billed. Automated tests never use this mode.' : 'Mock mode: no model is called. QA must run with VERTEX_PROJECT_ID set.',
    };
  });
};
