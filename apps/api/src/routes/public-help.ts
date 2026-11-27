import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { publicHelpFor } from '../support/public-help';

/**
 * D-109 / D-110 (owner, 27 Nov 2026): Help for signed-out pages. Public, read-only and static: it returns the help-pack
 * text for one public page (sign-in, forgot password, change password, ...) and 404 for any other page. No session is
 * read, nothing is stored, no Support Bot or model call is made, so there is no spend for signed-out visitors.
 */
export const publicHelpRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/help/public',
    {
      config: { access: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['support'],
        summary: 'Static help for a page anyone can open without signing in',
        querystring: z.object({ app: z.enum(['sme', 'console']), path: z.string().min(1).max(300) }),
      },
    },
    async (req, reply) => {
      const help = publicHelpFor(req.query.app, req.query.path);
      if (!help) throw new AppError(404, 'NOT_FOUND', 'There is no public help for this page.');
      reply.header('cache-control', 'public, max-age=300');
      return help;
    },
  );
};
