import type { Prisma } from '@prisma/client';
import type { Tx } from '../db';

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditContext {
  clientId: string;
  actorType: 'USER' | 'CANDIDATE' | 'SYSTEM' | 'SERVICE';
  actorId: string | null;
  requestId?: string;
}

const toJson = (v: unknown) => (v === undefined ? undefined : (v as Prisma.InputJsonValue));

/** Appends one AuditEvent inside the caller's transaction. */
export async function writeAudit(tx: Tx, ctx: AuditContext, input: AuditInput) {
  await tx.auditEvent.create({
    data: {
      clientId: ctx.clientId,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: toJson(input.before),
      after: toJson(input.after),
    },
  });
}
