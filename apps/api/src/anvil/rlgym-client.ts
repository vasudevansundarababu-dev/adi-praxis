/**
 * Server-side client for the new RL Gym's ADI Forge API (AUTHORING-SNAPSHOT §3.2; docs/design/FORGE-RLGYM-V2-DESIGN.md).
 * Base `{RLGYM_API_URL}/api/v1/workspaces/{RLGYM_WORKSPACE}`, `Authorization: Bearer <RL Gym's ADI Forge client key>`,
 * `Idempotency-Key` on every POST. Replies are `{data, meta: {request_id}}`; errors are
 * `{error: {code, message, details, request_id}}`. The key is never logged, echoed or stored.
 */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export type RlGymResult =
  | { ok: true; httpStatus: number; data: Record<string, unknown>; requestId: string | null }
  | { ok: false; kind: 'rejected' | 'unavailable'; httpStatus: number | null; code: string; message: string; requestId: string | null };

export interface RlGymSettings {
  apiUrl: string;
  workspace: string;
  key: string;
}

/** Connected only when the address, workspace and key are all set (QA today: none of them). */
export const rlGymConnected = (s: Partial<RlGymSettings> | null | undefined): s is RlGymSettings => !!(s?.apiUrl && s.workspace && s.key);

export class RlGymClient {
  constructor(
    private readonly settings: RlGymSettings,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 120_000,
  ) {}

  /** POST /projects/{project_id}/exports with `Idempotency-Key` = the export's own hash. */
  exportProject(projectId: string, body: Record<string, unknown>, idempotencyKey: string) {
    return this.post(`/projects/${encodeURIComponent(projectId)}/exports`, body, idempotencyKey);
  }

  private async post(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<RlGymResult> {
    const url = `${this.settings.apiUrl.replace(/\/$/, '')}/api/v1/workspaces/${encodeURIComponent(this.settings.workspace)}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.settings.key}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return { ok: false, kind: 'unavailable', httpStatus: null, code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? `RL Gym did not answer within ${this.timeoutMs / 1000} s.` : 'RL Gym could not be reached.', requestId: null };
    } finally {
      clearTimeout(timer);
    }
    let json: { data?: unknown; meta?: { request_id?: unknown }; error?: { code?: unknown; message?: unknown; request_id?: unknown } } | null = null;
    try {
      json = JSON.parse(await res.text());
    } catch {
      json = null;
    }
    const requestId = typeof json?.meta?.request_id === 'string' ? json.meta.request_id : typeof json?.error?.request_id === 'string' ? json.error.request_id : null;
    if (res.status >= 200 && res.status < 300 && json?.data && typeof json.data === 'object') return { ok: true, httpStatus: res.status, data: json.data as Record<string, unknown>, requestId };
    const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${res.status}`;
    const message = typeof json?.error?.message === 'string' ? json.error.message : `RL Gym answered ${res.status}.`;
    return { ok: false, kind: res.status >= 500 || res.status === 404 ? 'unavailable' : 'rejected', httpStatus: res.status, code, message, requestId };
  }
}
