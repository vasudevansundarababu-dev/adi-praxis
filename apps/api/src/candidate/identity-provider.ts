import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';

/** Provider session states (Stripe Identity VerificationSession.status). */
export type ProviderStatus = 'requires_input' | 'processing' | 'verified' | 'canceled';

export interface IdentityWebhookEvent {
  id: string;
  type: string;
  /** Provider timestamp (seconds); used to ignore out-of-order deliveries. */
  created: number;
  livemode: boolean;
  sessionId: string;
}

export interface AuthoritativeStatus {
  status: ProviderStatus;
  livemode: boolean;
  /** Over-18 from the verified document, or null when not (yet) known. The date of birth itself is discarded. */
  adult: boolean | null;
  /** Provider's reason code when more input is needed (e.g. document_expired). */
  lastErrorCode: string | null;
}

/**
 * FLOW2-SME C02: identity verification provider. Server-side status is authoritative (CF-04); webhooks are verified
 * on the raw body (CF-05). Identity images, ID numbers and dates of birth never leave this adapter.
 */
export interface IdentityProvider {
  readonly mode: 'stripe' | 'mock';
  /** Creates a session, or resumes an eligible one; returns where to send the candidate. */
  createOrResume(args: { smeUserId: string; existingSessionId: string | null; returnUrl: string }): Promise<{ sessionId: string; url: string; livemode: boolean }>;
  /** Verifies and parses a webhook. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): IdentityWebhookEvent;
  /** Fetches the current status from the provider (never trusts the browser or the webhook body alone). */
  retrieve(sessionId: string): Promise<AuthoritativeStatus>;
}

export const IDENTITY_EVENT_TYPES = [
  'identity.verification_session.verified',
  'identity.verification_session.requires_input',
  'identity.verification_session.processing',
  'identity.verification_session.canceled',
];

/** Age in whole years on `today` from a date of birth. Used in memory only. */
export function isAdult(dob: { day: number | null; month: number | null; year: number | null } | null | undefined, today = new Date()): boolean | null {
  if (!dob?.year || !dob.month || !dob.day) return null;
  let age = today.getUTCFullYear() - dob.year;
  const beforeBirthday = today.getUTCMonth() + 1 < dob.month || (today.getUTCMonth() + 1 === dob.month && today.getUTCDate() < dob.day);
  if (beforeBirthday) age -= 1;
  return age >= 18;
}

/** Real Stripe Identity adapter (switched on by STRIPE_SECRET_KEY). */
export class StripeIdentityProvider implements IdentityProvider {
  readonly mode = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createOrResume(args: { smeUserId: string; existingSessionId: string | null; returnUrl: string }) {
    if (args.existingSessionId) {
      const s = await this.stripe.identity.verificationSessions.retrieve(args.existingSessionId);
      // An interrupted flow can reuse an eligible session (FLOW2 C02).
      if (s.status === 'requires_input' && s.url) return { sessionId: s.id, url: s.url, livemode: s.livemode };
    }
    const s = await this.stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { sme_user_id: args.smeUserId },
      return_url: args.returnUrl,
    });
    return { sessionId: s.id, url: s.url!, livemode: s.livemode };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): IdentityWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature ?? '', this.webhookSecret);
    const obj = event.data.object as { id?: string; object?: string };
    return { id: event.id, type: event.type, created: event.created, livemode: event.livemode, sessionId: obj.id ?? '' };
  }

  async retrieve(sessionId: string): Promise<AuthoritativeStatus> {
    const s = await this.stripe.identity.verificationSessions.retrieve(sessionId, { expand: ['verified_outputs.dob'] });
    // Only the over-18 answer leaves this function; the date of birth is not stored or logged.
    const adult = s.status === 'verified' ? isAdult(s.verified_outputs?.dob ?? null) : null;
    return { status: s.status as ProviderStatus, livemode: s.livemode, adult, lastErrorCode: s.last_error?.code ?? null };
  }
}

/**
 * LOCAL DEV / TESTS ONLY. Simulates Stripe: sessions live in memory; `simulate` produces a webhook signed exactly
 * like Stripe's (t=…,v1=HMAC-SHA256 of "t.body") so the real verification path runs. Refused in production.
 */
export class MockIdentityProvider implements IdentityProvider {
  readonly mode = 'mock' as const;
  private readonly sessions = new Map<string, AuthoritativeStatus>();

  constructor(
    private readonly webhookSecret: string,
    private readonly devBaseUrl: string,
    private readonly livemode = false,
  ) {}

  async createOrResume(args: { smeUserId: string; existingSessionId: string | null; returnUrl: string }) {
    if (args.existingSessionId && this.sessions.get(args.existingSessionId)?.status === 'requires_input') {
      return { sessionId: args.existingSessionId, url: this.url(args.existingSessionId, args.returnUrl), livemode: this.livemode };
    }
    const sessionId = `vs_mock_${randomUUID().replace(/-/g, '')}`;
    this.sessions.set(sessionId, { status: 'requires_input', livemode: this.livemode, adult: null, lastErrorCode: null });
    return { sessionId, url: this.url(sessionId, args.returnUrl), livemode: this.livemode };
  }

  /** Sets the provider-side outcome and returns a signed webhook for it. */
  simulate(sessionId: string, outcome: { status: ProviderStatus; adult?: boolean; errorCode?: string }, createdAt = Math.floor(Date.now() / 1000)) {
    const current = this.sessions.get(sessionId) ?? { status: 'requires_input' as ProviderStatus, livemode: this.livemode, adult: null, lastErrorCode: null };
    this.sessions.set(sessionId, {
      ...current,
      status: outcome.status,
      adult: outcome.status === 'verified' ? (outcome.adult ?? true) : null,
      lastErrorCode: outcome.errorCode ?? null,
    });
    const body = JSON.stringify({
      id: `evt_mock_${randomUUID().replace(/-/g, '')}`,
      type: `identity.verification_session.${outcome.status}`,
      created: createdAt,
      livemode: this.livemode,
      data: { object: { id: sessionId, object: 'identity.verification_session' } },
    });
    return { rawBody: Buffer.from(body), signature: this.sign(body, createdAt) };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): IdentityWebhookEvent {
    const parts = Object.fromEntries((signature ?? '').split(',').map((kv) => kv.split('=') as [string, string]));
    const expected = Buffer.from(createHmac('sha256', this.webhookSecret).update(`${parts.t}.${rawBody.toString()}`).digest('hex'));
    const given = Buffer.from(parts.v1 ?? '');
    if (!parts.t || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('Invalid webhook signature');
    const e = JSON.parse(rawBody.toString()) as { id: string; type: string; created: number; livemode: boolean; data: { object: { id: string } } };
    return { id: e.id, type: e.type, created: e.created, livemode: e.livemode, sessionId: e.data.object.id };
  }

  async retrieve(sessionId: string): Promise<AuthoritativeStatus> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Unknown mock session ${sessionId}`);
    return s;
  }

  private sign(body: string, t: number) {
    return `t=${t},v1=${createHmac('sha256', this.webhookSecret).update(`${t}.${body}`).digest('hex')}`;
  }

  private url(sessionId: string, returnUrl: string) {
    return `${this.devBaseUrl}/dev/identity/${sessionId}?returnTo=${encodeURIComponent(returnUrl)}`;
  }
}
