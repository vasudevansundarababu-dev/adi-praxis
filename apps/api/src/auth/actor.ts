import type { InternalRole } from '@praxis/shared';

/** An internal user (Admin, PM, Reviewer), resolved from the internal session cookie. */
export interface InternalActor {
  type: 'USER';
  userId: string;
  clientId: string;
  roles: InternalRole[];
  sessionId: string;
}

export type Actor = InternalActor;

/** A candidate (SME user), resolved from the separate candidate session cookie. A different token audience. */
export interface CandidateActor {
  type: 'CANDIDATE';
  smeUserId: string;
  clientId: string;
  sessionId: string;
}

/**
 * Access policy every route must declare in `config.access`.
 * - 'public': no session needed (health, login, OpenAPI, public opportunity pages, signed webhooks).
 * - 'authenticated': any signed-in internal user.
 * - InternalRole[]: signed-in internal user holding at least one of these roles.
 * - 'candidate': a signed-in candidate. Internal sessions never satisfy it, and candidate sessions never
 *   satisfy an internal policy.
 */
export type AccessPolicy = 'public' | 'authenticated' | 'candidate' | readonly InternalRole[];

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    candidate: CandidateActor | null;
  }
  interface FastifyContextConfig {
    access?: AccessPolicy;
  }
}
