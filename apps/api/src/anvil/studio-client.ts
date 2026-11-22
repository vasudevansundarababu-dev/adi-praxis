import type { FetchLike } from './rlgym-client';

/**
 * Server-side client for Studio's next-version inbox (AUTHORING-SPEC 1.5; AUTHORING-SNAPSHOT 3.3). Authoring sends
 * `more_data` and `new_case_kind` items and reads their state back (Studio's status webhook is not built yet).
 *
 * Authentication: `STUDIO_INBOX_KEY` as a bearer key when set (the production key is not decided). Locally Studio
 * trusts service headers instead (`X-Tenant-Id`, `X-Actor-Id`, `X-Actor-Kind: service`), so those are sent when
 * `STUDIO_TENANT_ID` and `STUDIO_ACTOR_ID` are set. The key is never logged or stored.
 */
export interface StudioSettings {
  apiUrl: string;
  key: string;
  tenantId: string;
  actorId: string;
  actorRoles: string;
}

export const studioConnected = (s: Partial<StudioSettings> | null | undefined): s is StudioSettings => !!(s?.apiUrl && (s.key || (s.tenantId && s.actorId)));

export type StudioResult = { ok: true; httpStatus: number; data: Record<string, unknown> } | { ok: false; kind: 'rejected' | 'unavailable'; httpStatus: number | null; code: string; message: string };

/** Only these fields are sent: Studio refuses unknown fields. */
export interface InboxItemBody {
  kind: 'more_data' | 'new_case_kind';
  source: 'adi-forge';
  template_id: string;
  version: number;
  project_id: string;
  summary: string;
  evidence: Record<string, unknown>[];
  needed_by?: string;
}

export class StudioClient {
  constructor(
    private readonly settings: StudioSettings,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 30_000,
  ) {}

  sendInboxItem(body: InboxItemBody, idempotencyKey: string) {
    return this.call('POST', '/api/v1/inbox-items', body as unknown as Record<string, unknown>, idempotencyKey);
  }

  readInboxItem(id: string) {
    return this.call('GET', `/api/v1/inbox-items/${encodeURIComponent(id)}`);
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.settings.key) h.Authorization = `Bearer ${this.settings.key}`;
    if (this.settings.tenantId && this.settings.actorId) Object.assign(h, { 'X-Tenant-Id': this.settings.tenantId, 'X-Actor-Id': this.settings.actorId, 'X-Actor-Kind': 'service', 'X-Actor-Roles': this.settings.actorRoles || 'service' });
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
    return h;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<StudioResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.settings.apiUrl.replace(/\/$/, '')}${path}`, { method, headers: { ...this.headers(idempotencyKey), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return { ok: false, kind: 'unavailable', httpStatus: null, code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? 'Studio did not answer in time.' : 'Studio could not be reached.' };
    } finally {
      clearTimeout(timer);
    }
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(await res.text()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    // Studio answers plain objects; accept a {data} envelope too.
    const data = json && typeof json.data === 'object' && json.data && !Array.isArray(json.data) ? (json.data as Record<string, unknown>) : json;
    if (res.status >= 200 && res.status < 300 && data) return { ok: true, httpStatus: res.status, data };
    const err = (json?.error ?? json?.detail ?? null) as { code?: unknown; message?: unknown } | null;
    const code = typeof err?.code === 'string' ? err.code : `HTTP_${res.status}`;
    const message = typeof err?.message === 'string' ? err.message : `Studio answered ${res.status}.`;
    return { ok: false, kind: res.status >= 500 || res.status === 404 ? 'unavailable' : 'rejected', httpStatus: res.status, code, message };
  }
}
