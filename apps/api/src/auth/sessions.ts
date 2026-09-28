import type { Db } from '../db';
import { newToken, sha256 } from '../lib/crypto';
import type { CandidateActor, InternalActor, PartnerClientActor, PartnerUserActor } from './actor';

export const SESSION_COOKIE = 'praxis_session';
export const CANDIDATE_SESSION_COOKIE = 'praxis_candidate';
export const PARTNER_SESSION_COOKIE = 'praxis_partner';

/** Creates a server-side session; only the SHA-256 of the token is stored. Returns the raw token for the cookie. */
export async function createInternalSession(
  db: Db,
  args: { userId: string; clientId: string; ttlHours: number; ip?: string; userAgent?: string },
) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + args.ttlHours * 3600_000);
  await db.session.create({
    data: {
      audience: 'INTERNAL',
      userId: args.userId,
      clientId: args.clientId,
      tokenHash: sha256(token),
      expiresAt,
      ip: args.ip,
      userAgent: args.userAgent?.slice(0, 500),
    },
  });
  return { token, expiresAt };
}

/** Resolves a raw session token to an actor, or null if missing, expired, revoked or the user is disabled. */
export async function resolveInternalSession(db: Db, token: string): Promise<InternalActor | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (
    !session ||
    session.audience !== 'INTERNAL' ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    !session.user ||
    session.user.status !== 'ACTIVE'
  ) {
    return null;
  }
  return {
    type: 'USER',
    userId: session.user.id,
    clientId: session.user.clientId,
    roles: session.user.roles,
    sessionId: session.id,
  };
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserSessions(db: Db, userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Candidate session (separate audience). Only the token hash is stored. */
export async function createCandidateSession(
  db: Db,
  args: { smeUserId: string; clientId: string; ttlHours: number; ip?: string; userAgent?: string },
) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + args.ttlHours * 3600_000);
  await db.session.create({
    data: {
      audience: 'CANDIDATE',
      smeUserId: args.smeUserId,
      clientId: args.clientId,
      tokenHash: sha256(token),
      expiresAt,
      ip: args.ip,
      userAgent: args.userAgent?.slice(0, 500),
    },
  });
  return { token, expiresAt };
}

export async function resolveCandidateSession(db: Db, token: string): Promise<CandidateActor | null> {
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { smeUser: true } });
  if (
    !session ||
    session.audience !== 'CANDIDATE' ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    !session.smeUser ||
    session.smeUser.accountStatus !== 'ACTIVE'
  ) {
    return null;
  }
  return { type: 'CANDIDATE', smeUserId: session.smeUser.id, clientId: session.smeUser.clientId, sessionId: session.id };
}

// ───────────────────────── M10 partners ─────────────────────────

export async function createPartnerSession(db: Db, args: { partnerUserId: string; clientId: string; ttlHours: number; ip?: string; userAgent?: string }) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + args.ttlHours * 3600_000);
  await db.session.create({
    data: { audience: 'PARTNER', partnerUserId: args.partnerUserId, clientId: args.clientId, tokenHash: sha256(token), expiresAt, ip: args.ip, userAgent: args.userAgent?.slice(0, 500) },
  });
  return { token, expiresAt };
}

/** A partner portal session: active user, active partner, not expired or revoked. */
export async function resolvePartnerSession(db: Db, token: string): Promise<PartnerUserActor | null> {
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { partnerUser: { include: { partner: true } } } });
  if (!s || s.audience !== 'PARTNER' || s.revokedAt || s.expiresAt <= new Date() || !s.partnerUser || s.partnerUser.status !== 'ACTIVE' || s.partnerUser.partner.status !== 'ACTIVE') return null;
  return { type: 'PARTNER_USER', partnerUserId: s.partnerUser.id, partnerId: s.partnerUser.partnerId, clientId: s.clientId, sessionId: s.id };
}

/** A Partner API bearer token (OAuth2 client credentials). Only the SHA-256 of the token is stored. */
export async function resolvePartnerToken(db: Db, header: string | undefined): Promise<PartnerClientActor | null> {
  const m = header?.match(/^Bearer\s+(\S{20,200})$/);
  if (!m) return null;
  const t = await db.partnerAccessToken.findUnique({ where: { tokenHash: sha256(m[1]!) }, include: { client: { include: { partner: true } } } });
  if (!t || t.expiresAt <= new Date() || t.client.revokedAt || t.client.partner.status !== 'ACTIVE') return null;
  return { type: 'PARTNER_CLIENT', partnerClientId: t.client.id, partnerId: t.client.partnerId, clientId: t.client.partner.clientId, scopes: t.scopes, sandbox: t.client.environment === 'SANDBOX' };
}
