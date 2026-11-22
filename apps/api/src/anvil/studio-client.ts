/**
 * Server-side client for Studio's next-version inbox (AUTHORING-SNAPSHOT §3.3; docs/design/FORGE-RLGYM-V2-DESIGN.md
 * part 4). `POST {STUDIO_API_URL}/api/v1/inbox-items` answers `202 {id}`. Studio refuses unknown fields. The production
 * key is not decided: a Bearer key is sent when STUDIO_INBOX_KEY is set; locally Studio accepts a service principal by
 * its trusted headers. The key is never logged, echoed or stored. Item status is not read: Studio's `GET` needs a
 * Studio designer or admin, and its status webhook to ADI Forge has no sender yet.
 */
import type { FetchLike } from './rlgym-client';

export interface StudioSettings {
  apiUrl: string;
  key: string;
  tenantId: string;
  serviceActorId: string;
}

export type StudioResult = { ok: true; httpStatus: number; itemId: string } | { ok: false; kind: 'rejected' | 'unavailable'; httpStatus: number | null; code: string; message: string };

/** Connected when the address is set and there is a way to authenticate (a key, or the local service principal). */
export const studioConnected = (s: Partial<StudioSettings> | null | undefined): s is StudioSettings => !!(s?.apiUrl && (s.key || (s.tenantId && s.serviceActorId)));

export class StudioClient {
  constructor(
    private readonly settings: StudioSettings,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 30_000,
  ) {}

  async sendInboxItem(body: Record<string, unknown>, idempotencyKey: string): Promise<StudioResult> {
    const s = this.settings;
    const auth: Record<string, string> = s.key ? { Authorization: `Bearer ${s.key}` } : { 'X-Tenant-Id': s.tenantId, 'X-Actor-Id': s.serviceActorId, 'X-Actor-Kind': 'service', 'X-Actor-Roles': 'service' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${s.apiUrl.replace(/\/$/, '')}/api/v1/inbox-items`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return { ok: false, kind: 'unavailable', httpStatus: null, code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? `Studio did not answer within ${this.timeoutMs / 1000} s.` : 'Studio could not be reached.' };
    } finally {
      clearTimeout(timer);
    }
    let json: { id?: unknown; data?: { id?: unknown }; error?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown; detail?: unknown } | null = null;
    try {
      json = JSON.parse(await res.text());
    } catch {
      json = null;
    }
    const id = typeof json?.id === 'string' ? json.id : typeof json?.data?.id === 'string' ? json.data.id : null;
    if (res.status >= 200 && res.status < 300 && id) return { ok: true, httpStatus: res.status, itemId: id };
    const code = typeof json?.error?.code === 'string' ? json.error.code : typeof json?.code === 'string' ? json.code : `HTTP_${res.status}`;
    const message = typeof json?.error?.message === 'string' ? json.error.message : typeof json?.message === 'string' ? json.message : `Studio answered ${res.status}.`;
    return { ok: false, kind: res.status >= 500 || res.status === 404 ? 'unavailable' : 'rejected', httpStatus: res.status, code, message };
  }
}
