import { createHmac } from 'node:crypto';
import type { Config } from '../config';
import type { Db } from '../db';
import type { EventHandler } from '../outbox/handlers';
import { rlResultPayload } from './rl-records';

/**
 * RL Gym is a separate platform (SPEC). This is the only way results leave: a signed webhook. Its receiving side is
 * not specified here; the mock in tests verifies the signature and can fail on demand.
 */
export interface RlGymClient {
  deliver(payload: unknown, eventId: string): Promise<{ ok: boolean; status: number }>;
}

/** `x-praxis-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">` (Stripe-style, replay-resistant). */
export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export class WebhookRlGymClient implements RlGymClient {
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async deliver(payload: unknown, eventId: string) {
    const body = JSON.stringify(payload);
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-praxis-signature': signBody(this.secret, body), 'x-praxis-event-id': eventId },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  }
}

export const defaultRlGym = (config: Config): RlGymClient | null => (config.RL_GYM_WEBHOOK_URL ? new WebhookRlGymClient(config.RL_GYM_WEBHOOK_URL, config.RL_GYM_WEBHOOK_SECRET) : null);

/**
 * Delivers each new verdict to RL Gym. Failures throw so the queue retries with exponential backoff (8 attempts);
 * every attempt is recorded. Without a configured webhook the result waits for the pull API.
 */
export function deliverRlResult(client: RlGymClient | null): EventHandler {
  return {
    name: 'flow4.deliver-result',
    event: 'rl_review.completed',
    async run(event, db: Db) {
      const { recordId } = event.payload as { recordId: string };
      const delivery = await db.rLResultDelivery.findUniqueOrThrow({ where: { recordId } });
      if (delivery.status === 'DELIVERED') return;
      if (!client) {
        await db.rLResultDelivery.update({ where: { id: delivery.id }, data: { status: 'PULL_ONLY' } });
        return;
      }
      const record = await db.rLReviewRecord.findUniqueOrThrow({ where: { id: recordId } });
      let result: { ok: boolean; status: number } | null = null;
      let error: string | null = null;
      try {
        result = await client.deliver(rlResultPayload(record), event.id);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const now = new Date();
      await db.rLResultDelivery.update({
        where: { id: delivery.id },
        data: { attempts: { increment: 1 }, lastAttemptAt: now, lastStatus: result?.status ?? null, lastError: result?.ok ? null : (error ?? `HTTP ${result?.status}`).slice(0, 500), ...(result?.ok ? { status: 'DELIVERED', deliveredAt: now } : {}) },
      });
      if (!result?.ok) throw new Error(`RL Gym delivery failed: ${error ?? `HTTP ${result?.status}`}`);
    },
  };
}
