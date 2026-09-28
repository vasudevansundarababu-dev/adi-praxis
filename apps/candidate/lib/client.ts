'use client';

/** Browser call to the API (same origin via the Next rewrite). Mutations always carry an Idempotency-Key. */
export async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null; error: string | null; code: string | null }> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method,
      headers: method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() } : {},
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data: res.ok ? json : null, error: res.ok ? null : (json?.message ?? `Request failed (${res.status})`), code: json?.error ?? null };
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server. Check your connection and try again.', code: null };
  }
}

/** Multipart upload (a file plus fields). The browser sets the boundary; mutations still carry an Idempotency-Key. */
export async function upload<T>(path: string, form: FormData): Promise<{ ok: boolean; status: number; data: T | null; error: string | null; code: string | null }> {
  try {
    const res = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: form });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data: res.ok ? json : null, error: res.ok ? null : (json?.message ?? `Upload failed (${res.status})`), code: json?.error ?? null };
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server. Check your connection and try again.', code: null };
  }
}
