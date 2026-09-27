import 'server-only';
import type { CandidateMeDto } from '@praxis/shared';
import { cookies } from 'next/headers';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** Server-side call to the API forwarding the candidate's cookie. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(init.method && init.method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: init.method && init.method !== 'GET' ? JSON.stringify(init.body ?? {}) : undefined,
    cache: 'no-store',
  });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

export async function getMe(): Promise<CandidateMeDto | null> {
  return (await api<CandidateMeDto>('/me')).data;
}
