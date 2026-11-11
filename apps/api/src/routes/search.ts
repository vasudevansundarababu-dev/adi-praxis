import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { SearchService } from '../search/service';
import { SEARCH_SOURCES, SEARCH_TYPES } from '../search/sources';

/** GET /search/:type?q=… — the console lists' search bar (owner, 12 Nov 2026). */
export const searchRoutes: FastifyPluginAsyncZod<{ service: SearchService }> = async (app, { service }) => {
  app.get(
    '/search/:type',
    {
      config: { access: ['ADMIN', 'PM', 'REVIEWER', 'FINANCE'], rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        tags: ['search'],
        params: z.object({ type: z.enum(SEARCH_TYPES) }),
        querystring: z.object({ q: z.string().max(200).default(''), limit: z.coerce.number().int().min(1).max(20).default(8) }),
        response: {
          200: z.object({
            items: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string(), href: z.string(), score: z.number(), match: z.enum(['letters', 'meaning', 'both']) })),
            ids: z.array(z.string()),
            semantic: z.enum(['used', 'short_query', 'unavailable']),
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      // Each list keeps its own access rule: no search where the list itself is not available.
      if (!SEARCH_SOURCES[req.params.type].roles.some((r) => actor.roles.includes(r as never))) throw new AppError(403, 'FORBIDDEN', 'You do not have access to this list.');
      return service.search(actor, req.params.type, req.query.q, req.query.limit);
    },
  );
};
