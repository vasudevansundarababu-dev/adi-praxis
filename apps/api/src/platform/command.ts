import type { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor, ApiClientActor, CandidateActor, PartnerActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, badRequest, unauthorized } from '../lib/errors';
import { emitEvent, type OutboxInput } from '../outbox/outbox';
import { writeAudit, type AuditInput } from './audit';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export interface CommandContext<A = Actor> {
  tx: Tx;
  actor: A;
  audit(input: AuditInput): Promise<void>;
  emit(event: OutboxInput): Promise<void>;
}

export interface CommandResult<T> {
  status: number;
  body: T;
  /** What a replay returns instead of `body`, when the body holds a secret that must not be stored (e.g. a new API key). */
  replayBody?: unknown;
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
  return execute(db, req, reply, { actor, actorId: actor.userId, actorType: 'USER', clientId: actor.clientId }, handler);
}

/** The same guarantees for a partner portal user or a Partner API client (M10; audited as actor type PARTNER). */
export async function runPartnerCommand<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  handler: (ctx: CommandContext<PartnerActor>) => Promise<CommandResult<T>>,
): Promise<void> {
  const p = req.partner;
  if (!p) throw unauthorized();
  const actorId = p.type === 'PARTNER_USER' ? `partner-user:${p.partnerUserId}` : `partner-client:${p.partnerClientId}`;
  return execute(db, req, reply, { actor: p, actorId, actorType: 'PARTNER', clientId: p.clientId }, handler);
}

/** The same guarantees for a signed-in candidate (separate audience; audited as actor type CANDIDATE). */
export async function runCandidateCommand<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  handler: (ctx: CommandContext<CandidateActor>) => Promise<CommandResult<T>>,
): Promise<void> {
  const actor = req.candidate;
  if (!actor) throw unauthorized();
  return execute(db, req, reply, { actor, actorId: `candidate:${actor.smeUserId}`, actorType: 'CANDIDATE', clientId: actor.clientId }, handler);
}

/** For routes open to staff or a machine client (e.g. client API task-input push). Machine clients audit as SERVICE. */
export async function runStaffOrServiceCommand<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  handler: (ctx: CommandContext<Actor | ApiClientActor>) => Promise<CommandResult<T>>,
): Promise<void> {
  if (req.actor) return execute<Actor | ApiClientActor, T>(db, req, reply, { actor: req.actor, actorId: req.actor.userId, actorType: 'USER', clientId: req.actor.clientId }, handler);
  const c = req.apiClient;
  if (!c) throw unauthorized();
  return execute<Actor | ApiClientActor, T>(db, req, reply, { actor: c, actorId: `service:${c.apiClientId}`, actorType: 'SERVICE', clientId: c.clientId }, handler);
}

async function execute<A, T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  principal: { actor: A; actorId: string; actorType: 'USER' | 'CANDIDATE' | 'SERVICE' | 'PARTNER'; clientId: string },
  handler: (ctx: CommandContext<A>) => Promise<CommandResult<T>>,
): Promise<void> {
  const { actor, actorId, actorType, clientId } = principal;
  const rawKey = req.headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (!key || key.length > 200) throw badRequest('Idempotency-Key header is required (max 200 characters)');

  const path = req.routeOptions.url ?? req.url;
  // Multipart bodies are not JSON; their idempotency hash covers method and URL only.
  const body = String(req.headers['content-type'] ?? '').startsWith('multipart/') ? null : (req.body ?? null);
  const requestHash = sha256(stableStringify({ method: req.method, url: req.url, body }));

  const replay = await findReplay(db, actorId, key, requestHash);
  if (replay) {
    sendReplay(reply, replay);
    return;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let audits = 0;
      const auditCtx = {
        clientId,
        actorType,
        actorId: actorType === 'CANDIDATE' ? actorId.slice('candidate:'.length) : actorType === 'SERVICE' ? actorId.slice('service:'.length) : actorId,
        requestId: String(req.id),
      } as const;
      const ctx: CommandContext<A> = {
        tx,
        actor,
        audit: async (input) => {
          audits += 1;
          await writeAudit(tx, auditCtx, input);
        },
        emit: async (event) => {
          await emitEvent(tx, clientId, event);
        },
      };

      const out = await handler(ctx);
      if (audits === 0) {
        throw new Error(`Command ${req.method} ${path} changed state without writing an AuditEvent`);
      }
      await tx.idempotencyKey.create({
        data: {
          clientId,
          actorId,
          key,
          method: req.method,
          path,
          requestHash,
          responseStatus: out.status,
          responseBody: ((out.replayBody !== undefined ? out.replayBody : out.body) ?? null) as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return out;
      // A FLOW 2 match run over a large talent pool happens inside the command; allow it time.
    }, { timeout: 15_000, maxWait: 5_000 });
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
