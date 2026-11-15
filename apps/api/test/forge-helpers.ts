import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { MockGoogleVerifier } from '../src/candidate/google';
import { idem } from './helpers';

export type Method = 'GET' | 'POST' | 'PUT';

/** An API call with a session cookie; state-changing calls carry a fresh Idempotency-Key. */
export const call = (a: FastifyInstance, method: Method, cookie: string, url: string, payload?: object) =>
  a.inject({ method, url: `/api/v1${url}`, headers: { cookie, ...(method === 'GET' ? {} : idem()) }, ...(payload ? { payload } : {}) });

/**
 * MVP1 test kit shared by the forge step tests. `ctx` is read at call time, so the cookies set in `beforeEach` apply.
 */
export function forgeKit(ctx: () => { app: FastifyInstance; pm: string; admin: string }, google: MockGoogleVerifier) {
  const setFlow = async (newFlow: boolean) => expect((await call(ctx().app, 'PUT', ctx().admin, '/admin/forge-settings', { newFlow })).statusCode).toBe(200);

  /** Sourcing → New, as the PM. */
  async function source(projectId: string, role: 'SME' | 'REVIEWER', o: { first?: string; last?: string; email?: string; assessment?: Record<string, string> } = {}) {
    const res = await call(ctx().app, 'POST', ctx().pm, '/sourcing/people', { projectId, role, firstName: o.first ?? 'Grace', lastName: o.last ?? 'Hopper', email: o.email ?? `${randomUUID().slice(0, 8)}@gmail.test`, ...(o.assessment ? { assessment: o.assessment } : {}) });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; email: string };
  }

  /**
   * A candidate signed in through the mock Google sign-in (subject `mock-<email>`), with no identity check. With the
   * new flow on, they also accept the current terms (step 3's Before you start), unless `terms: false`.
   */
  async function signIn(mail: string, subject = `mock-${mail}`, name = 'Grace Hopper', o: { terms?: boolean } = {}) {
    const res = await ctx().app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject, email: mail, name }), adultAttested: true } });
    expect(res.statusCode, res.body).toBe(200);
    const me = { smeUserId: res.json().id as string, cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}` };
    if (o.terms !== false) await acceptTerms(me.cookie, { ifNewFlow: true });
    return me;
  }

  /** Before you start: accept the current terms by their hashes and confirm synthetic data only. */
  async function acceptTerms(cookie: string, o: { ifNewFlow?: boolean } = {}) {
    const view = await call(ctx().app, 'GET', cookie, '/me/forge/terms');
    if (o.ifNewFlow && view.statusCode === 409 && view.json().error === 'NEW_FLOW_OFF') return null;
    expect(view.statusCode, view.body).toBe(200);
    const hashes = Object.fromEntries((view.json().terms as { key: string; sha256: string }[]).map((t) => [t.key, t.sha256]));
    const res = await call(ctx().app, 'POST', cookie, '/me/forge/terms', { hashes, syntheticOnly: true });
    expect(res.statusCode, res.body).toBe(200);
    return res;
  }

  const assign = (projectId: string, sourcedPersonId: string, taskId: string) => call(ctx().app, 'POST', ctx().pm, `/projects/${projectId}/assignments/direct`, { sourcedPersonId, taskId });

  return { setFlow, source, signIn, acceptTerms, assign };
}
