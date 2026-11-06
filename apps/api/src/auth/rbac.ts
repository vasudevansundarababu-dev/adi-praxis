import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../db';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { ErrorDto } from '@praxis/shared';
import type { AccessPolicy, ApiClientActor, CandidateActor, PartnerActor } from './actor';
import { CANDIDATE_SESSION_COOKIE, PARTNER_SESSION_COOKIE, resolveCandidateSession, resolveInternalSession, resolvePartnerSession, resolvePartnerToken, SESSION_COOKIE } from './sessions';

/** Pure RBAC decision, shared by the hook and unit tests. */
export function checkAccess(policy: AccessPolicy, actor: FastifyRequest['actor'], candidate: CandidateActor | null = null, apiClient: ApiClientActor | null = null, partner: PartnerActor | null = null): 'ok' | 401 | 403 {
  if (policy === 'public') return 'ok';
  if (policy === 'candidate') return candidate ? 'ok' : 401;
  if (policy === 'partner') return partner?.type === 'PARTNER_USER' ? 'ok' : 401;
  if (typeof policy === 'object' && 'partnerScope' in policy) {
    if (partner?.type !== 'PARTNER_CLIENT') return 401;
    return partner.scopes.includes(policy.partnerScope) ? 'ok' : 403;
  }
  if (typeof policy === 'object' && 'apiClient' in policy) {
    if (actor) return actor.roles.some((r) => policy.roles.includes(r)) ? 'ok' : 403;
    if (apiClient) return apiClient.kind === policy.apiClient ? 'ok' : 403;
    return 401;
  }
  if (!actor) return 401;
  if (policy === 'authenticated') return 'ok';
  return actor.roles.some((r) => (policy as readonly string[]).includes(r)) ? 'ok' : 403;
}

/** Resolves `Authorization: Bearer <key>` to an active API client. Keys are stored only as SHA-256 hashes. */
async function resolveApiClient(db: Db, header: string | undefined): Promise<ApiClientActor | null> {
  const m = header?.match(/^Bearer\s+(\S{20,200})$/);
  if (!m) return null;
  const c = await db.apiClient.findUnique({ where: { keyHash: sha256(m[1]!) } });
  if (!c || c.revokedAt) return null;
  return { type: 'SERVICE', apiClientId: c.id, clientId: c.clientId, kind: c.kind };
}

/**
 * Resolves the session on every request and enforces each route's declared access policy.
 * A route without `config.access` fails at registration, so no endpoint can ship without RBAC.
 */
export const rbacPlugin = fp(async (app: FastifyInstance, opts: { db: Db }) => {
  app.decorateRequest('actor', null);
  app.decorateRequest('candidate', null);
  app.decorateRequest('apiClient', null);
  app.decorateRequest('partner', null);

  app.addHook('onRoute', (route) => {
    const access = (route.config as { access?: AccessPolicy } | undefined)?.access;
    if (route.method === 'HEAD' || route.url.startsWith('/docs')) return;
    if (!access) {
      throw new Error(`Route ${route.method} ${route.url} has no access policy (config.access)`);
    }
    const security: Record<string, string[]>[] = access === 'public' ? []
      : access === 'candidate' ? [{ candidateSession: [] }]
      : access === 'partner' ? [{ partnerSession: [] }]
      : typeof access === 'object' && 'partnerScope' in access ? [{ partnerOAuth: [access.partnerScope] }]
      : typeof access === 'object' && 'apiClient' in access ? [{ session: [] }, { serviceToken: [] }]
      : [{ session: [] }];
    route.schema = { ...route.schema, security, ...(access !== 'public' ? {
      response: { 401: ErrorDto, 403: ErrorDto, ...(route.schema?.response as Record<string, unknown> | undefined) },
    } : {}) };
  });

  app.addHook('onRequest', async (req) => {
    const policy = req.routeOptions.config?.access;
    // Partner audiences (M10) never read internal or candidate credentials, and vice versa.
    if (policy === 'partner') {
      const pt = req.cookies[PARTNER_SESSION_COOKIE];
      req.partner = pt ? await resolvePartnerSession(opts.db, pt) : null;
    } else if (policy && typeof policy === 'object' && 'partnerScope' in policy) {
      req.partner = await resolvePartnerToken(opts.db, req.headers.authorization);
    }
    const partnerPolicy = policy === 'partner' || (!!policy && typeof policy === 'object' && 'partnerScope' in policy);
    // Each audience only ever reads its own cookie.
    if (!partnerPolicy && (policy === 'candidate' || policy === 'public')) {
      const ct = req.cookies[CANDIDATE_SESSION_COOKIE];
      req.candidate = ct ? await resolveCandidateSession(opts.db, ct) : null;
    }
    if (!partnerPolicy && policy !== 'candidate') {
      const token = req.cookies[SESSION_COOKIE];
      req.actor = token ? await resolveInternalSession(opts.db, token) : null;
    }

    if (policy && typeof policy === 'object' && 'apiClient' in policy && !req.actor) {
      req.apiClient = await resolveApiClient(opts.db, req.headers.authorization);
    }

    if (!policy) return; // 404s and swagger-ui static assets
    const result = checkAccess(policy, req.actor, req.candidate, req.apiClient, req.partner);
    if (result === 401) throw unauthorized();
    if (result === 403) throw forbidden();
    // A temporary password from an Admin must be replaced before anything else (enforced here, not only on screen).
    const temporary = (policy !== 'public' && req.actor?.mustChangePassword) || (req.partner?.type === 'PARTNER_USER' && req.partner.mustChangePassword);
    if (temporary && !req.routeOptions.config?.allowTemporaryPassword) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before you continue.');
    }
  });
});
