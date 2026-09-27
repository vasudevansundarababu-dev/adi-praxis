import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../db';
import { forbidden, unauthorized } from '../lib/errors';
import type { AccessPolicy } from './actor';
import { resolveInternalSession, SESSION_COOKIE } from './sessions';

/** Pure RBAC decision, shared by the hook and unit tests. */
export function checkAccess(policy: AccessPolicy, actor: FastifyRequest['actor']): 'ok' | 401 | 403 {
  if (policy === 'public') return 'ok';
  if (!actor) return 401;
  if (policy === 'authenticated') return 'ok';
  return actor.roles.some((r) => policy.includes(r)) ? 'ok' : 403;
}

/**
 * Resolves the session on every request and enforces each route's declared access policy.
 * A route without `config.access` fails at registration, so no endpoint can ship without RBAC.
 */
export const rbacPlugin = fp(async (app: FastifyInstance, opts: { db: Db }) => {
  app.decorateRequest('actor', null);

  app.addHook('onRoute', (route) => {
    const access = (route.config as { access?: AccessPolicy } | undefined)?.access;
    if (route.method === 'HEAD' || route.url.startsWith('/docs')) return;
    if (!access) {
      throw new Error(`Route ${route.method} ${route.url} has no access policy (config.access)`);
    }
  });

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.actor = token ? await resolveInternalSession(opts.db, token) : null;

    const policy = req.routeOptions.config?.access;
    if (!policy) return; // 404s and swagger-ui static assets
    const result = checkAccess(policy, req.actor);
    if (result === 401) throw unauthorized();
    if (result === 403) throw forbidden();
  });
});
