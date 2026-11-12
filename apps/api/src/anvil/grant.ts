import { randomBytes } from 'node:crypto';
import type { Db } from '../db';
import { sha256 } from '../lib/crypto';
import { writeAudit } from '../platform/audit';

/**
 * The keyless Anvil grant (K6, owner 12 Nov 2026): one ANVIL ApiClient row naming Anvil's Google service account.
 * It has no usable key (the hash is of a discarded random value), expires at the pilot stop, and an Admin revokes it
 * with the normal Revoke action. Created by the deploy's setup job, so nobody issues or pastes anything.
 * Idempotent: an existing grant (even a revoked one) is left as it is, so a revocation is never undone by a redeploy.
 */
export async function ensureAnvilGrant(db: Db, clientId: string, env: { ANVIL_CALLER_SERVICE_ACCOUNT?: string; ANVIL_CREDENTIAL_NOT_AFTER?: string }, log: (level: string, message: string, extra?: object) => void) {
  const email = env.ANVIL_CALLER_SERVICE_ACCOUNT?.trim().toLowerCase();
  if (!email) return null;
  const stop = env.ANVIL_CREDENTIAL_NOT_AFTER ? new Date(env.ANVIL_CREDENTIAL_NOT_AFTER) : null;
  if (!stop || Number.isNaN(stop.getTime()) || stop <= new Date()) {
    log('warn', 'Anvil keyless grant not created: no pilot stop, or it has passed');
    return null;
  }
  const existing = await db.apiClient.findUnique({ where: { serviceAccount: email } });
  if (existing) return existing;
  return db.$transaction(async (tx) => {
    const c = await tx.apiClient.create({ data: { clientId, name: 'Anvil (keyless service identity)', kind: 'ANVIL', keyHash: sha256(`unusable:${randomBytes(32).toString('hex')}`), serviceAccount: email, expiresAt: stop } });
    await writeAudit(tx, { clientId, actorType: 'SYSTEM', actorId: null }, { entityType: 'ApiClient', entityId: c.id, action: 'api_client.keyless_granted', after: { kind: 'ANVIL', serviceAccount: email, expiresAt: stop.toISOString() } });
    log('info', 'Anvil keyless grant created', { serviceAccount: email });
    return c;
  });
}
