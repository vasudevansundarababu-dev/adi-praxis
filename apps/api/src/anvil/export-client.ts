/**
 * Server-side client for Anvil's dataset-export API (Praxis-Anvil contract, approved 12 Nov 2026; Anvil's
 * praxis-export-validation-api.md). Bearer export-client token, raw application/zip bodies, no cookies, Origin or
 * CSRF. Business results (`{data}`) are kept apart from auth, transport, availability and internal errors (`{error}`),
 * and nothing is ever reported as a success Anvil did not return. The token is never logged or echoed.
 */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface AnvilBusiness {
  kind: 'business';
  httpStatus: number;
  /** export_valid, export_invalid, anvil_provisioning, import_resolved, anvil_blocked, ... as Anvil returns it. */
  status: string;
  valid: boolean | null;
  data: Record<string, unknown>;
  requestId: string | null;
}
export interface AnvilFailure {
  /** auth: 401/403. unavailable: 404/503 or a disabled contract. transport: 400/413/415/428 or network/timeout.
   * conflict: generic 409 (idempotency key reused with other content). internal: 5xx or an unreadable response. */
  kind: 'auth' | 'unavailable' | 'transport' | 'conflict' | 'internal';
  httpStatus: number | null;
  code: string;
  message: string;
  requestId: string | null;
  retryable: boolean;
}
export type AnvilResult = AnvilBusiness | AnvilFailure;

const MAX_UPLOAD = 1_048_576;

export class AnvilExportClient {
  constructor(
    private readonly baseUrl: string,
    /** A static token, or (keyless, the default) a provider of this service's Google identity token. */
    private readonly auth: string | (() => Promise<string>),
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 30_000,
  ) {
    if (!baseUrl || !auth) throw new Error('Anvil export client needs ANVIL_EXPORT_BASE_URL and a token or identity provider');
  }

  contracts() {
    return this.call('GET', '/contracts');
  }
  validate(zip: Uint8Array) {
    return this.call('POST', '/validate', zip);
  }
  resolve(zip: Uint8Array, idempotencyKey: string) {
    if (!/^.{1,200}$/.test(idempotencyKey)) throw new Error('Idempotency-Key must be 1-200 characters');
    return this.call('POST', '/resolve', zip, { 'Idempotency-Key': idempotencyKey });
  }

  private async call(method: 'GET' | 'POST', path: string, body?: Uint8Array, extra: Record<string, string> = {}): Promise<AnvilResult> {
    if (body && body.byteLength > MAX_UPLOAD) return { kind: 'transport', httpStatus: null, code: 'PACKAGE_TOO_LARGE', message: `The package is ${body.byteLength} bytes; Anvil accepts at most ${MAX_UPLOAD}. Split the export.`, requestId: null, retryable: false };
    let token: string;
    try {
      token = typeof this.auth === 'string' ? this.auth : await this.auth();
    } catch {
      return { kind: 'transport', httpStatus: null, code: 'IDENTITY_UNAVAILABLE', message: 'Praxis could not get its Google identity token to call Anvil.', requestId: null, retryable: true };
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra };
    if (body) headers['Content-Type'] = 'application/zip';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers, ...(body ? { body } : {}), signal: ctrl.signal });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return { kind: 'transport', httpStatus: null, code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? `Anvil did not answer within ${this.timeoutMs / 1000} s.` : 'Anvil could not be reached.', requestId: null, retryable: true };
    } finally {
      clearTimeout(timer);
    }
    let json: { data?: Record<string, unknown>; error?: { code?: string; message?: string; request_id?: string; retryable?: boolean }; meta?: { request_id?: string } } | null = null;
    try {
      json = JSON.parse(await res.text());
    } catch {
      json = null;
    }
    const requestId = json?.meta?.request_id ?? json?.error?.request_id ?? res.headers.get('x-request-id');
    if (json?.data && typeof json.data === 'object') {
      return { kind: 'business', httpStatus: res.status, status: String(json.data.status ?? (res.status === 200 ? 'ok' : 'unknown')), valid: typeof json.data.valid === 'boolean' ? json.data.valid : null, data: json.data, requestId: requestId ?? null };
    }
    const e = json?.error ?? {};
    const kind: AnvilFailure['kind'] = res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 || res.status === 503 ? 'unavailable' : res.status === 409 ? 'conflict' : res.status >= 500 || res.status < 400 ? 'internal' : 'transport';
    return { kind, httpStatus: res.status, code: e.code ?? `HTTP_${res.status}`, message: e.message ?? `Anvil answered ${res.status} without a readable body.`, requestId: requestId ?? null, retryable: e.retryable ?? (res.status >= 500 || res.status === 429) };
  }
}
