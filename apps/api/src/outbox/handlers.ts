import type { OutboxEvent } from '@prisma/client';
import type { DomainEventName } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { assessOnSubmit } from '../candidate/selection-service';
import type { SuitabilityEvaluator } from '../candidate/suitability';
import { OfflineGeocoder } from '../staffing/geocoder';
import { closeCampaignsOnStaffed, rematchOnApproval } from '../staffing/handlers';

/**
 * A consumer of one domain event. `name` must be stable: it keys the idempotency receipt.
 * - `handle` runs inside a transaction together with the receipt (exactly-once effects).
 * - `run` is for slow work (e.g. model calls) that must not hold a transaction open. It runs outside one, must be
 *   idempotent itself, and the receipt is written after it succeeds.
 */
export type EventHandler =
  | { name: string; event: DomainEventName; handle(event: OutboxEvent, tx: Tx): Promise<void>; run?: never }
  | { name: string; event: DomainEventName; run(event: OutboxEvent, db: Db): Promise<void>; handle?: never };

export class HandlerRegistry {
  private readonly byEvent = new Map<string, EventHandler[]>();

  register(handler: EventHandler) {
    const list = this.byEvent.get(handler.event) ?? [];
    if (list.some((h) => h.name === handler.name)) {
      throw new Error(`Duplicate handler ${handler.name} for ${handler.event}`);
    }
    list.push(handler);
    this.byEvent.set(handler.event, list);
    return this;
  }

  for(event: string): EventHandler[] {
    return this.byEvent.get(event) ?? [];
  }
}

/** Production handler registry. FLOW 3 registers `candidate.assigned` / `project.staffed` consumers in M5. */
export function defaultHandlers(evaluator?: SuitabilityEvaluator): HandlerRegistry {
  const r = new HandlerRegistry().register(rematchOnApproval(new OfflineGeocoder())).register(closeCampaignsOnStaffed());
  return evaluator ? r.register(assessOnSubmit(evaluator)) : r;
}
