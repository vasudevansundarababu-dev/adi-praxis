import 'server-only';
import type { SmeAuthoredTaskDto } from '@praxis/shared';
import { api, getMe } from '@/lib/api';
import { handleStudioMock } from './mock-backend';
import { STUDIO_API_MODE } from './mode';
import type { StudioConfig } from './types';

/** Server reads for the studio page. The only place (with browser.ts) that knows about the mock. */

async function get<T>(path: string): Promise<{ status: number; data: T | null }> {
  if (STUDIO_API_MODE === 'live') return api<T>(path);
  const me = await getMe();
  const r = handleStudioMock('GET', path, undefined, { smeUserId: me?.id ?? null });
  return { status: r.status, data: r.status < 300 ? (r.body as T) : null };
}

const base = (key: string) => `/candidate/studio/${encodeURIComponent(key)}`;

export const studioServer = {
  config: (key: string) => get<StudioConfig>(base(key)),
  tasks: (key: string) => get<{ items: SmeAuthoredTaskDto[] }>(`${base(key)}/tasks`),
};
