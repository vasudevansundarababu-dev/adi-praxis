'use client';

export interface PartnerMutation<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** API error code, e.g. DUPLICATE_CANDIDATE or PARTNER_REF_IN_USE. */
  code: string | null;
  error: string | null;
  /** The raw error body (a duplicate carries the recorded candidateId). */
  body: Record<string, unknown> | null;
}

/**
 * State-changing call to `/api/v1/partner-portal/*` from the browser, like `mutate` in lib/client-api.ts: a fresh
 * Idempotency-Key per call (the API replays the first response on a retry) and the `praxis_partner` cookie sent
 * same-origin through the Next rewrite. It also returns the API error code so screens can react to it.
 */
export async function partnerMutate<T>(path: string, body?: unknown): Promise<PartnerMutation<T>> {
  try {
    const res = await fetch(`/api/v1/partner-portal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, status: res.status, data: json as T, code: null, error: null, body: null };
    const message = typeof json?.message === 'string' ? json.message : null;
    const code = typeof json?.error === 'string' ? json.error : typeof json?.code === 'string' ? json.code : null;
    let error = message ?? `Request failed (${res.status}). Try again.`;
    if (res.status === 401) error = 'Your session has ended. Sign in again to continue.';
    if (res.status === 429) error = 'Too many requests. Wait a minute and try again.';
    return { ok: false, status: res.status, data: null, code, error, body: json };
  } catch {
    return { ok: false, status: 0, data: null, code: null, error: 'Could not reach the server. Check your connection and try again.', body: null };
  }
}
