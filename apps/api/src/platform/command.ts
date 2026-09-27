import type { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, badRequest, unauthorized } from '../lib/errors';
import { emitEvent, type OutboxInput } from '../outbox/outbox';
import { writeAudit, type AuditInput } from './audit';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export interface CommandContext {
  tx: Tx;
  actor: Actor;
  audit(input: AuditInput): Promise<void>;
  emit(event: OutboxInput): Promise<void>;
}

export interface CommandResult<T> {
  status: number;
  body: T;
}

/**
 * Runs a state-changing request with the platform guarantees (CLAUDE.md non-negotiables):
 * - authorised: requires a resolved actor (route RBAC has already run);
 * - idempotent: requires an Idempotency-Key; a repeat with the same key and body replays the stored response,
 *   a repeat with a different body is rejected;
 * - audited: the handler must write at least one AuditEvent, in the same transaction as the change;
 * - events: outbox rows are written in that same transaction.
 */
export async function runCommand<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  handler: (ctx: CommandContext) => Promise<CommandResult<T>>,
): Promise<void> {
  const actor = req.actor;
  if (!actor) throw unauthorized();

  const rawKey = req.headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (!key || key.length > 200) throw badRequest('Idempotency-Key header is required (max 200 characters)');

  const path = req.routeOptions.url ?? req.url;
  const requestHash = sha256(stableStringify({ method: req.method, url: req.url, body: req.body ?? null }));
  const actorId = actor.userId;

  const replay = await findReplay(db, actorId, key, requestHash);
  if (replay) {
    sendReplay(reply, replay);
    return;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let audits = 0;
      const auditCtx = {
        clientId: actor.clientId,
        actorType: actor.type,
        actorId,
        requestId: String(req.id),
      } as const;
      const ctx: CommandContext = {
        tx,
        actor,
        audit: async (input) => {
          audits += 1;
          await writeAudit(tx, auditCtx, input);
        },
        emit: async (event) => {
          await emitEvent(tx, actor.clientId, event);
        },
      };

      const out = await handler(ctx);
      if (audits === 0) {
        throw new Error(`Command ${req.method} ${path} changed state without writing an AuditEvent`);
      }
      await tx.idempotencyKey.create({
        data: {
          clientId: actor.clientId,
          actorId,
          key,
          method: req.method,
          path,
          requestHash,
          responseStatus: out.status,
          responseBody: (out.body ?? null) as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return out;
    });
    reply.status(result.status).send(result.body);
  } catch (err) {
    // A concurrent request with the same key may have committed first (our transaction then fails on the
    // idempotency row or on the entity it also created): replay its response instead of surfacing the clash.
    const again = await findReplay(db, actorId, key, requestHash);
    if (again) {
      sendReplay(reply, again);
      return;
    }
    throw err;
  }
}

async function findReplay(db: Db, actorId: string, key: string, requestHash: string) {
  const existing = await db.idempotencyKey.findUnique({ where: { actorId_key: { actorId, key } } });
  if (!existing) return null;
  if (existing.expiresAt <= new Date()) {
    await db.idempotencyKey.deleteMany({ where: { id: existing.id } });
    return null;
  }
  if (existing.requestHash !== requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
  }
  return existing;
}

function sendReplay(reply: FastifyReply, row: { responseStatus: number; responseBody: unknown }) {
  reply.header('idempotent-replayed', 'true').status(row.responseStatus).send(row.responseBody);
}
