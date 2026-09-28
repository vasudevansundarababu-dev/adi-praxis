import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

/**
 * Selfie re-check at the start of every certification attempt (docs/SME-SUPPLY.md section 7.4): a new Stripe Identity
 * VerificationSession with a matching-selfie check. Only the provider reference and the result are stored; never an
 * image or an ID number. The mock is for local development, the demo/test environments and tests.
 */
export interface SelfieCheck {
  readonly mode: 'stripe' | 'mock';
  start(args: { smeUserId: string; returnUrl: string }): Promise<{ sessionRef: string; url: string }>;
  /** 'verified' only when the provider confirms the selfie matches the verified identity. */
  result(sessionRef: string, smeUserId: string): Promise<'verified' | 'pending' | 'failed'>;
}

export class StripeSelfieCheck implements SelfieCheck {
  readonly mode = 'stripe' as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }
  async start(args: { smeUserId: string; returnUrl: string }) {
    const s = await this.stripe.identity.verificationSessions.create({
      type: 'document',
      options: { document: { require_matching_selfie: true } },
      metadata: { sme_user_id: args.smeUserId, purpose: 'certification_attempt' },
      return_url: args.returnUrl,
    });
    return { sessionRef: s.id, url: s.url! };
  }
  async result(sessionRef: string, smeUserId: string) {
    const s = await this.stripe.identity.verificationSessions.retrieve(sessionRef);
    if (s.metadata?.sme_user_id !== smeUserId || s.metadata?.purpose !== 'certification_attempt') return 'failed';
    return s.status === 'verified' ? 'verified' : s.status === 'processing' || s.status === 'requires_input' ? 'pending' : 'failed';
  }
}

/** Mock: every check passes (optionally after a manual step in tests). Refused in production by config. */
export class MockSelfieCheck implements SelfieCheck {
  readonly mode = 'mock' as const;
  readonly sessions = new Map<string, { smeUserId: string; outcome: 'verified' | 'pending' | 'failed' }>();
  constructor(private readonly defaultOutcome: 'verified' | 'pending' | 'failed' = 'verified') {}
  async start(args: { smeUserId: string; returnUrl: string }) {
    const ref = `vs_selfie_mock_${randomUUID().replace(/-/g, '')}`;
    this.sessions.set(ref, { smeUserId: args.smeUserId, outcome: this.defaultOutcome });
    const u = new URL(args.returnUrl);
    u.searchParams.set('selfie', ref);
    return { sessionRef: ref, url: u.toString() };
  }
  async result(sessionRef: string, smeUserId: string) {
    const s = this.sessions.get(sessionRef);
    if (!s || s.smeUserId !== smeUserId) return 'failed';
    return s.outcome;
  }
  set(sessionRef: string, outcome: 'verified' | 'pending' | 'failed') {
    const s = this.sessions.get(sessionRef);
    if (s) s.outcome = outcome;
  }
}
