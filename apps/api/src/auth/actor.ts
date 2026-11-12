import type { InternalRole } from '@praxis/shared';

/** An internal user (Admin, PM, Reviewer), resolved from the internal session cookie. */
export interface InternalActor {
  type: 'USER';
  userId: string;
  clientId: string;
  roles: InternalRole[];
  sessionId: string;
  /** Signed in with a temporary password: only "who am I", sign-out and change-password are allowed. */
  mustChangePassword: boolean;
}

export type Actor = InternalActor;

/** A machine client (client API push, RL Gym), resolved from a Bearer API key. Audited as actor type SERVICE. */
export interface ApiClientActor {
  type: 'SERVICE';
  apiClientId: string;
  clientId: string;
  kind: 'CLIENT_API' | 'RL_GYM' | 'ANVIL';
}

/** A candidate (SME user), resolved from the separate candidate session cookie. A different token audience. */
export interface CandidateActor {
  type: 'CANDIDATE';
  smeUserId: string;
  clientId: string;
  sessionId: string;
}

/** M10: a person at a staffing partner, signed in to the partner portal (cookie praxis_partner). */
export interface PartnerUserActor {
  type: 'PARTNER_USER';
  partnerUserId: string;
  partnerId: string;
  clientId: string;
  sessionId: string;
  /** Signed in with a temporary password: only "who am I", sign-out and change-password are allowed. */
  mustChangePassword: boolean;
}

/** M10: a partner's system calling the Partner API with an OAuth2 client-credentials token. */
export interface PartnerClientActor {
  type: 'PARTNER_CLIENT';
  partnerClientId: string;
  partnerId: string;
  clientId: string;
  scopes: string[];
  sandbox: boolean;
}

export type PartnerActor = PartnerUserActor | PartnerClientActor;

/**
 * Access policy every route must declare in `config.access`.
 * - 'public': no session needed (health, login, OpenAPI, public opportunity pages, signed webhooks).
 * - 'authenticated': any signed-in internal user.
 * - InternalRole[]: signed-in internal user holding at least one of these roles.
 * - 'candidate': a signed-in candidate. Internal sessions never satisfy it, and candidate sessions never
 *   satisfy an internal policy.
 * - { roles, apiClient }: an internal user with one of the roles, or a machine client of that kind (Bearer key).
 * - 'partner': a signed-in partner portal user (M10). Never satisfied by internal or candidate sessions.
 * - { partnerScope }: a Partner API client token carrying that OAuth scope (M10).
 */
export type AccessPolicy =
  | 'public'
  | 'authenticated'
  | 'candidate'
  | 'partner'
  | readonly InternalRole[]
  | { roles: readonly InternalRole[]; apiClient: ApiClientActor['kind'] }
  | { partnerScope: string };

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    candidate: CandidateActor | null;
    apiClient: ApiClientActor | null;
    partner: PartnerActor | null;
  }
  interface FastifyContextConfig {
    access?: AccessPolicy;
    /** Reachable while the user still has a temporary password (me, logout, change-password). */
    allowTemporaryPassword?: boolean;
  }
}
