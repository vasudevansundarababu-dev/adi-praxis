import type { FastifyRequest } from 'fastify';
import type { Db } from '../db';
import { unauthorized } from '../lib/errors';
import { writeAudit, type AuditInput } from '../platform/audit';

/** Audits a read that hands data out of Praxis (UISpec export, bundle download, store export: S2-11, S4-12). */
export async function auditRead(db: Db, req: FastifyRequest, input: AuditInput) {
  const actor = req.actor;
  if (!actor) throw unauthorized();
  await db.$transaction((tx) => writeAudit(tx, { clientId: actor.clientId, actorType: 'USER', actorId: actor.userId, requestId: String(req.id) }, input));
}
