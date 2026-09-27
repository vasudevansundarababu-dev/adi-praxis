'use client';

export interface MutationResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/**
 * State-changing API call from the browser. Every call carries a fresh Idempotency-Key, so a double-click or
 * network retry of the same call is applied once (the API replays the first response).
 */
export async function mutate<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<MutationResult<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? json : null,
      error: res.ok ? null : (json?.message ?? `Request failed (${res.status})`),
    };
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server. Check your connection and try again.' };
  }
}
