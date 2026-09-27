import type { OutboxEvent } from '@prisma/client';
import type { DomainEventName } from '@praxis/shared';
import type { Tx } from '../db';
import { OfflineGeocoder } from '../staffing/geocoder';
import { closeCampaignsOnStaffed, rematchOnApproval } from '../staffing/handlers';

/** A consumer of one domain event. `name` must be stable: it keys the idempotency receipt. */
export interface EventHandler {
  name: string;
  event: DomainEventName;
  handle(event: OutboxEvent, tx: Tx): Promise<void>;
}

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
export function defaultHandlers(): HandlerRegistry {
  return new HandlerRegistry().register(rematchOnApproval(new OfflineGeocoder())).register(closeCampaignsOnStaffed());
}
