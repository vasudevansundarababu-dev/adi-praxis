import type { InternalRole } from '@praxis/shared';

/** The authenticated caller, resolved from the session cookie. Candidates get their own actor type in M4. */
export interface InternalActor {
  type: 'USER';
  userId: string;
  clientId: string;
  roles: InternalRole[];
  sessionId: string;
}

export type Actor = InternalActor;

/**
 * Access policy every route must declare in `config.access`.
 * - 'public': no session needed (health, login, OpenAPI).
 * - 'authenticated': any signed-in internal user.
 * - InternalRole[]: signed-in user holding at least one of these roles.
 */
export type AccessPolicy = 'public' | 'authenticated' | readonly InternalRole[];

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyContextConfig {
    access?: AccessPolicy;
  }
}
