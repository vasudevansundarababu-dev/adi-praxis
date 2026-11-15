import 'server-only';
import type { InternalUserDto } from '@praxis/shared';
import { cookies } from 'next/headers';
import type { ForgeSettingsView } from './forge-console';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** Server-side API call that forwards the signed-in user's session cookie. */
export async function apiGet<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

export async function getCurrentUser(): Promise<InternalUserDto | null> {
  const { data } = await apiGet<{ user: InternalUserDto }>('/auth/me');
  return data?.user ?? null;
}

/** MVP1 settings (GET /admin/forge-settings), or null when the caller may not read them (Reviewers, Finance: 403). */
export async function getForgeSettings(): Promise<ForgeSettingsView | null> {
  const { data } = await apiGet<ForgeSettingsView>('/admin/forge-settings');
  return data;
}

/** The new flow switch, read on the server; anything but a readable "on" is off, so pages render as before. */
export async function newFlowOn(): Promise<boolean> {
  return (await getForgeSettings())?.newFlow === true;
}
