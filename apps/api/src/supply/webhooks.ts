import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PartnerWebhookEvent } from '@praxis/shared';
import type { Db, Tx } from '../db';
import type { SecretBox } from '../lib/secrets';
import { signBody } from '../rl/rl-gym';

/**
 * Partner webhooks (docs/SME-SUPPLY.md section 5): every state change a partner may see is queued as one delivery per
 * matching webhook, in the same transaction as the change. A worker sends due deliveries with a Stripe-style
 * signature (header `Praxis-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`), retrying with
 * exponential backoff. Partners can replay any delivery from the portal.
 */
export const MAX_WEBHOOK_ATTEMPTS = 8;
export const SIGNATURE_HEADER = 'praxis-signature';

export async function notifyPartner(tx: Tx, args: { partnerId: string | null; sandbox: boolean; type: PartnerWebhookEvent; data: Record<string, unknown> }) {
  if (!args.partnerId) return 0;
  const hooks = await tx.partnerWebhook.findMany({ where: { partnerId: args.partnerId, status: 'ACTIVE', environment: args.sandbox ? 'SANDBOX' : 'LIVE' } });
  const eventId = randomUUID();
  const payload = { id: eventId, type: args.type, created: new Date().toISOString(), sandbox: args.sandbox, data: args.data };
  const targets = hooks.filter((h) => h.events.includes('*') || h.events.includes(args.type));
  for (const h of targets) {
    await tx.partnerWebhookDelivery.create({ data: { clientId: h.clientId, webhookId: h.id, eventId, eventType: args.type, payload: payload as unknown as Prisma.InputJsonValue } });
  }
  return targets.length;
}

export interface WebhookSender {
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }>;
}

export const fetchSender: WebhookSender = {
  async post(url, body, headers) {
    const res = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    return { status: res.status };
  },
};

/** Backoff after the nth failed attempt: 30 s, 2 min, 8 min, 32 min, ~2 h, ~8.5 h, ~34 h. */
export const backoffMs = (attempt: number) => 30_000 * 4 ** Math.max(0, attempt - 1);

/** Sends every due delivery once. Returns counts. Called by the worker every 30 seconds (and directly in tests). */
export async function processPartnerWebhooks(db: Db, box: SecretBox, sender: WebhookSender = fetchSender, now = new Date(), limit = 50) {
  // SENDING rows whose lease ran out (a worker died mid-send) are due again.
  const due = await db.partnerWebhookDelivery.findMany({ where: { status: { in: ['PENDING', 'SENDING'] }, nextAttemptAt: { lte: now } }, include: { webhook: true }, orderBy: { nextAttemptAt: 'asc' }, take: limit });
  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    // Claim the delivery so two workers never send it at the same time.
    const claimed = await db.partnerWebhookDelivery.updateMany({ where: { id: d.id, status: d.status, attempts: d.attempts }, data: { attempts: { increment: 1 }, status: 'SENDING', nextAttemptAt: new Date(now.getTime() + 5 * 60_000) } });
    if (!claimed.count) continue;
    const body = JSON.stringify(d.payload);
    let status = 0;
    let error: string | null = null;
    try {
      const secret = box.decrypt(d.webhook.secretEnc);
      status = (await sender.post(d.webhook.url, body, { 'content-type': 'application/json', [SIGNATURE_HEADER]: signBody(secret, body, Math.floor(now.getTime() / 1000)), 'praxis-event-id': d.eventId, 'praxis-delivery-id': d.id })).status;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 500) : 'Request failed';
    }
    const ok = status >= 200 && status < 300;
    const attempts = d.attempts + 1;
    if (ok) delivered++;
    else failed++;
    await db.partnerWebhookDelivery.update({
      where: { id: d.id },
      data: ok
        ? { status: 'DELIVERED', deliveredAt: new Date(), lastStatusCode: status, lastError: null }
        : { status: attempts >= MAX_WEBHOOK_ATTEMPTS ? 'FAILED' : 'PENDING', lastStatusCode: status || null, lastError: error ?? `HTTP ${status}`, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) },
    });
  }
  return { delivered, failed };
}

/** Replay: a new delivery of the same event (same event id, so partners can deduplicate). */
export async function replayDelivery(tx: Tx, deliveryId: string, partnerId: string) {
  const d = await tx.partnerWebhookDelivery.findFirst({ where: { id: deliveryId, webhook: { partnerId } } });
  if (!d) return null;
  return tx.partnerWebhookDelivery.create({ data: { clientId: d.clientId, webhookId: d.webhookId, eventId: d.eventId, eventType: d.eventType, payload: d.payload as Prisma.InputJsonValue, replayOfId: d.id } });
}
