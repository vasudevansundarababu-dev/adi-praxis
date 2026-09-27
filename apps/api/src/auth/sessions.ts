import type { Db } from '../db';
import { newToken, sha256 } from '../lib/crypto';
import type { InternalActor } from './actor';

export const SESSION_COOKIE = 'praxis_session';

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
