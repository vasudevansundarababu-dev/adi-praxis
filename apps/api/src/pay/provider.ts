import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Payout provider (docs/SME-SUPPLY.md section 8.3). Praxis stores the provider, the payee reference and statuses only;
 * bank and tax details stay with the provider. Adapters: Trolley (launch) and a mock for local development and tests.
 * RazorpayX (India, via the Indian subsidiary) comes later behind the same interface.
 */
export type ProviderPayeeStatus = 'PENDING' | 'READY' | 'BLOCKED';
export type ProviderPaymentStatus = 'SUBMITTED' | 'PAID' | 'FAILED' | 'RETURNED';

export interface PayoutEvent {
  id: string;
  livemode: boolean;
  kind: 'payee' | 'payment' | 'other';
  payeeRef?: string;
  payeeStatus?: ProviderPayeeStatus;
  payoutCurrency?: string | null;
  paymentRef?: string;
  paymentStatus?: ProviderPaymentStatus;
  fx?: { payoutCurrency: string; rate: string; payoutAmount: string } | null;
  reason?: string | null;
}

export interface SettlementLine {
  paymentRef: string;
  amount: string;
  currency: string;
  status: ProviderPaymentStatus;
}

export class WebhookSignatureError extends Error {}

export interface PayoutProvider {
  readonly name: 'trolley' | 'mock';
  /** Live mode (real money) or test/sandbox mode; webhooks from the other mode are ignored. */
  readonly livemode: boolean;
  createPayee(args: { smeUserId: string; email: string; name: string; country: string | null }): Promise<{ payeeRef: string }>;
  getPayeeStatus(payeeRef: string): Promise<{ status: ProviderPayeeStatus; payoutCurrency: string | null }>;
  /** Hosted onboarding (tax form, payout method, identity as the provider requires). */
  onboardingLink(args: { payeeRef: string; email: string }): Promise<string>;
  /** One batch per pay run; every payment carries our idempotency key so a retried submit pays nobody twice. */
  submitBatch(args: { batchKey: string; items: { idempotencyKey: string; payeeRef: string; amount: string; currency: string }[] }): Promise<{ batchRef: string; payments: { idempotencyKey: string; paymentRef: string }[] }>;
  getPayoutStatus(paymentRef: string): Promise<{ status: ProviderPaymentStatus; fx: PayoutEvent['fx'] }>;
  /** Verifies the signature on the raw body; throws WebhookSignatureError when it does not match. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PayoutEvent;
  /** What the provider settled on a day (UTC), for the daily reconciliation. */
  getSettlementReport(day: Date): Promise<SettlementLine[]>;
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t><raw body>">`; 5-minute tolerance. */
function checkSignature(secret: string, raw: Buffer, sig: string | undefined, joiner: string, now = Date.now()) {
  const m = sig?.match(/t=(\d+),\s*v1=([0-9a-f]{64})/);
  if (!m) throw new WebhookSignatureError('Missing or malformed webhook signature');
  if (Math.abs(now / 1000 - Number(m[1])) > 300) throw new WebhookSignatureError('Webhook signature is too old');
  const expected = createHmac('sha256', secret).update(`${m[1]}${joiner}${raw.toString('utf8')}`).digest();
  const got = Buffer.from(m[2]!, 'hex');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new WebhookSignatureError('Webhook signature does not match');
}

// ───────────────────────── Mock (local development, demo and tests; refused in production) ─────────────────────────

export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'mock' as const;
  readonly livemode = false;
  readonly payees = new Map<string, { email: string; status: ProviderPayeeStatus; payoutCurrency: string | null }>();
  readonly payments = new Map<string, { idempotencyKey: string; payeeRef: string; amount: string; currency: string; status: ProviderPaymentStatus; day: string }>();
  readonly batches = new Map<string, string>();
  /** Tests can replace the settlement report to produce mismatches. */
  settlementOverride: ((day: Date, lines: SettlementLine[]) => SettlementLine[]) | null = null;
  /** INR payouts for Indian payees: fixed test rate. */
  static readonly USD_INR = '83.00';

  constructor(private readonly webhookSecret = 'mock-payout-webhook-secret', private readonly appUrl = 'http://localhost:3001') {}

  async createPayee(args: { email: string; country: string | null }) {
    const payeeRef = `R-mock-${randomUUID().slice(0, 12)}`;
    this.payees.set(payeeRef, { email: args.email, status: 'PENDING', payoutCurrency: args.country === 'IN' ? 'INR' : 'USD' });
    return { payeeRef };
  }
  async getPayeeStatus(payeeRef: string) {
    const p = this.payees.get(payeeRef);
    return { status: p?.status ?? 'PENDING', payoutCurrency: p?.payoutCurrency ?? null };
  }
  async onboardingLink(args: { payeeRef: string }) {
    return `${this.appUrl}/payee/mock-onboarding?ref=${encodeURIComponent(args.payeeRef)}`;
  }
  async submitBatch(args: { batchKey: string; items: { idempotencyKey: string; payeeRef: string; amount: string; currency: string }[] }) {
    const batchRef = this.batches.get(args.batchKey) ?? `B-mock-${randomUUID().slice(0, 12)}`;
    this.batches.set(args.batchKey, batchRef);
    const payments = args.items.map((i) => {
      const existing = [...this.payments.entries()].find(([, p]) => p.idempotencyKey === i.idempotencyKey);
      if (existing) return { idempotencyKey: i.idempotencyKey, paymentRef: existing[0] };
      const paymentRef = `P-mock-${randomUUID().slice(0, 12)}`;
      this.payments.set(paymentRef, { ...i, status: 'SUBMITTED', day: new Date().toISOString().slice(0, 10) });
      return { idempotencyKey: i.idempotencyKey, paymentRef };
    });
    return { batchRef, payments };
  }
  async getPayoutStatus(paymentRef: string) {
    const p = this.payments.get(paymentRef);
    return { status: p?.status ?? 'FAILED', fx: p ? this.fxOf(p) : null };
  }
  private fxOf(p: { payeeRef: string; amount: string; currency: string }) {
    const payout = this.payees.get(p.payeeRef)?.payoutCurrency ?? p.currency;
    if (payout === p.currency) return { payoutCurrency: payout, rate: '1', payoutAmount: p.amount };
    const rate = p.currency === 'USD' && payout === 'INR' ? MockPayoutProvider.USD_INR : (1 / Number(MockPayoutProvider.USD_INR)).toFixed(6);
    return { payoutCurrency: payout, rate, payoutAmount: (Number(p.amount) * Number(rate)).toFixed(2) };
  }
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PayoutEvent {
    checkSignature(this.webhookSecret, rawBody, header(headers, 'x-mock-signature'), '.');
    const e = JSON.parse(rawBody.toString('utf8')) as PayoutEvent;
    return e;
  }
  async getSettlementReport(day: Date) {
    const d = day.toISOString().slice(0, 10);
    const lines = [...this.payments.entries()].filter(([, p]) => p.day === d && p.status !== 'SUBMITTED').map(([paymentRef, p]) => ({ paymentRef, amount: p.amount, currency: p.currency, status: p.status }));
    return this.settlementOverride ? this.settlementOverride(day, lines) : lines;
  }

  // ── Test and local helpers ──
  /** A signed webhook body and headers, as the provider would send them. */
  signed(event: PayoutEvent, secret = this.webhookSecret, t = Math.floor(Date.now() / 1000)) {
    const body = JSON.stringify(event);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return { body, headers: { 'content-type': 'application/json', 'x-mock-signature': `t=${t},v1=${sig}` } };
  }
  /** Moves a payment and returns the webhook event the provider would send. */
  settle(paymentRef: string, status: ProviderPaymentStatus, reason: string | null = null): PayoutEvent {
    const p = this.payments.get(paymentRef)!;
    p.status = status;
    return { id: `evt_${randomUUID()}`, livemode: false, kind: 'payment', paymentRef, paymentStatus: status, fx: this.fxOf(p), reason };
  }
  payeeEvent(payeeRef: string, status: ProviderPayeeStatus): PayoutEvent {
    const p = this.payees.get(payeeRef)!;
    p.status = status;
    return { id: `evt_${randomUUID()}`, livemode: false, kind: 'payee', payeeRef, payeeStatus: status, payoutCurrency: p.payoutCurrency };
  }
}

// ───────────────────────── Trolley ─────────────────────────

const TROLLEY_PAYEE: Record<string, ProviderPayeeStatus> = { active: 'READY', incomplete: 'PENDING', pending: 'PENDING', blocked: 'BLOCKED', disabled: 'BLOCKED', suspended: 'BLOCKED', archived: 'BLOCKED' };
const TROLLEY_PAYMENT: Record<string, ProviderPaymentStatus> = { pending: 'SUBMITTED', processing: 'SUBMITTED', processed: 'PAID', failed: 'FAILED', returned: 'RETURNED', cancelled: 'FAILED' };

/**
 * Trolley REST adapter (api.trolley.com, v1). Requests are signed with the access key and an HMAC of
 * "<timestamp>\n<METHOD>\n<path>\n<body>\n". Field names and statuses follow Trolley's public API reference and must be
 * checked against a Trolley sandbox account before go-live (docs/M10-STATUS.md); tests never call it.
 */
export class TrolleyPayoutProvider implements PayoutProvider {
  readonly name = 'trolley' as const;
  constructor(
    private readonly cfg: { accessKey: string; secretKey: string; webhookSecret: string; apiUrl: string; widgetUrl: string; livemode: boolean },
    private readonly http: typeof fetch = fetch,
  ) {}
  get livemode() {
    return this.cfg.livemode;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = body === undefined ? '' : JSON.stringify(body);
    const sig = createHmac('sha256', this.cfg.secretKey).update(`${ts}\n${method}\n${path}\n${payload}\n`).digest('hex');
    const res = await this.http(`${this.cfg.apiUrl}${path}`, { method, headers: { Authorization: `prsign ${this.cfg.accessKey}:${sig}`, 'X-PR-Timestamp': ts, 'Content-Type': 'application/json' }, ...(payload ? { body: payload } : {}) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Trolley ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  async createPayee(args: { smeUserId: string; email: string; name: string; country: string | null }) {
    const [firstName, ...rest] = args.name.trim().split(/\s+/);
    const r = await this.call<{ recipient: { id: string } }>('POST', '/v1/recipients', { type: 'individual', referenceId: args.smeUserId, email: args.email, firstName: firstName || args.name, lastName: rest.join(' ') || '-', ...(args.country ? { address: { country: args.country } } : {}) });
    return { payeeRef: r.recipient.id };
  }
  async getPayeeStatus(payeeRef: string) {
    const r = await this.call<{ recipient: { status: string; payoutMethod?: string; accounts?: { currency?: string; primary?: boolean }[] } }>('GET', `/v1/recipients/${encodeURIComponent(payeeRef)}`);
    const primary = r.recipient.accounts?.find((a) => a.primary) ?? r.recipient.accounts?.[0];
    return { status: TROLLEY_PAYEE[r.recipient.status] ?? 'PENDING', payoutCurrency: primary?.currency ?? null };
  }
  async onboardingLink(args: { payeeRef: string; email: string }) {
    // Trolley's hosted widget: a query string signed with the secret key.
    const q = new URLSearchParams({ ts: Math.floor(Date.now() / 1000).toString(), key: this.cfg.accessKey, email: args.email, refid: args.payeeRef, hideEmail: 'true', roEmail: 'true', locale: 'en' });
    q.append('sign', createHmac('sha256', this.cfg.secretKey).update(q.toString()).digest('hex'));
    return `${this.cfg.widgetUrl}?${q.toString()}`;
  }
  async submitBatch(args: { batchKey: string; items: { idempotencyKey: string; payeeRef: string; amount: string; currency: string }[] }) {
    const b = await this.call<{ batch: { id: string; payments?: { payments?: { id: string; externalId?: string }[] } } }>('POST', '/v1/batches', {
      description: `Praxis pay run ${args.batchKey}`,
      payments: args.items.map((i) => ({ recipient: { id: i.payeeRef }, sourceAmount: i.amount, sourceCurrency: i.currency, externalId: i.idempotencyKey })),
    });
    await this.call('POST', `/v1/batches/${encodeURIComponent(b.batch.id)}/start-processing`);
    const byExternal = new Map((b.batch.payments?.payments ?? []).map((p) => [p.externalId, p.id]));
    return { batchRef: b.batch.id, payments: args.items.map((i) => ({ idempotencyKey: i.idempotencyKey, paymentRef: byExternal.get(i.idempotencyKey) ?? '' })).filter((p) => p.paymentRef) };
  }
  async getPayoutStatus(paymentRef: string) {
    const r = await this.call<{ payment: { status: string; targetCurrency?: string; exchangeRate?: string; targetAmount?: string } }>('GET', `/v1/payments/${encodeURIComponent(paymentRef)}`);
    const p = r.payment;
    return { status: TROLLEY_PAYMENT[p.status] ?? 'SUBMITTED', fx: p.targetCurrency ? { payoutCurrency: p.targetCurrency, rate: p.exchangeRate ?? '1', payoutAmount: p.targetAmount ?? '' } : null };
  }
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PayoutEvent {
    checkSignature(this.cfg.webhookSecret, rawBody, header(headers, 'x-paymentrails-signature') ?? header(headers, 'trolley-signature'), '');
    const e = JSON.parse(rawBody.toString('utf8')) as { id?: string; model?: string; action?: string; object?: Record<string, unknown> };
    const o = (e.object ?? {}) as { id?: string; status?: string; targetCurrency?: string; exchangeRate?: string; targetAmount?: string; returnedReason?: string; accounts?: { currency?: string; primary?: boolean }[] };
    const id = e.id ?? createHmac('sha256', 'event-id').update(rawBody).digest('hex');
    if (e.model === 'recipient' && o.id) {
      const primary = o.accounts?.find((a) => a.primary) ?? o.accounts?.[0];
      return { id, livemode: this.cfg.livemode, kind: 'payee', payeeRef: o.id, payeeStatus: TROLLEY_PAYEE[o.status ?? ''] ?? 'PENDING', payoutCurrency: primary?.currency ?? null };
    }
    if (e.model === 'payment' && o.id) {
      return { id, livemode: this.cfg.livemode, kind: 'payment', paymentRef: o.id, paymentStatus: TROLLEY_PAYMENT[o.status ?? ''] ?? 'SUBMITTED', fx: o.targetCurrency ? { payoutCurrency: o.targetCurrency, rate: o.exchangeRate ?? '1', payoutAmount: o.targetAmount ?? '' } : null, reason: o.returnedReason ?? null };
    }
    return { id, livemode: this.cfg.livemode, kind: 'other' };
  }
  async getSettlementReport(day: Date) {
    const d = day.toISOString().slice(0, 10);
    const r = await this.call<{ payments: { id: string; sourceAmount: string; sourceCurrency: string; status: string }[] }>('GET', `/v1/payments/search?startDate=${d}&endDate=${d}&pageSize=1000`);
    return r.payments.map((p) => ({ paymentRef: p.id, amount: p.sourceAmount, currency: p.sourceCurrency, status: TROLLEY_PAYMENT[p.status] ?? 'SUBMITTED' }));
  }
}
