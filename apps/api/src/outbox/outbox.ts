import type { Prisma } from '@prisma/client';
import type { DomainEventName } from '@praxis/shared';
import type { Tx } from '../db';

export interface OutboxInput {
  name: DomainEventName;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** Records a domain event in the same transaction as the state change; the dispatcher publishes it later. */
export async function emitEvent(tx: Tx, clientId: string, event: OutboxInput) {
  return tx.outboxEvent.create({
    data: {
      clientId,
      name: event.name,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
}
