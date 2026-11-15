import 'server-only';
import type { CandidateMeDto, PublicForgeSettings } from '@praxis/shared';
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

/** getMe that treats an unreachable API as signed out (the header must never fail a page). */
export async function getMeSafe(): Promise<CandidateMeDto | null> {
  try {
    return await getMe();
  } catch {
    return null;
  }
}

const FORGE_OFF: PublicForgeSettings = { newFlow: false, candidateSignIn: 'OFFLINE' };

/** MVP1: the Admin's candidate app settings (public). Falls back to the earlier journey if the API cannot be read. */
export async function getForgeSettings(): Promise<PublicForgeSettings> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/public/forge-settings`, { cache: 'no-store' });
    if (!res.ok) return FORGE_OFF;
    const body = (await res.json()) as Partial<PublicForgeSettings>;
    return { newFlow: body.newFlow === true, candidateSignIn: body.candidateSignIn === 'ONLINE' ? 'ONLINE' : 'OFFLINE' };
  } catch {
    return FORGE_OFF;
  }
}
