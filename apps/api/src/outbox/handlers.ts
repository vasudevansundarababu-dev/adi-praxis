import type { OutboxEvent } from '@prisma/client';
import type { DomainEventName } from '@praxis/shared';
import type { Tx } from '../db';

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

/**
 * Production handler registry. Empty in M0: FLOW 2 registers `project.ready_for_staffing` consumers in M3,
 * FLOW 3 registers `candidate.assigned` in M5, and so on.
 */
export function defaultHandlers(): HandlerRegistry {
  return new HandlerRegistry();
}
