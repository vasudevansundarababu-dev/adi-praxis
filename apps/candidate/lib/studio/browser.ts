'use client';

import type { StudioAnswers } from '@praxis/shared';
import { STUDIO_BROWSER_BASE } from './mode';

export type CommitResult = { status: 'SUBMITTED'; version: number; authoredTaskId: string; externalTaskId: string; bundleSha256: string; taskJson: unknown };
export type StudioCallResult<T> = { ok: boolean; status: number; data: T | null; error: string | null; code: string | null; problems: Record<string, string[]> | null };

const path = (key: string) => `${STUDIO_BROWSER_BASE}/candidate/studio/${encodeURIComponent(key)}`;

/** Browser calls for the studio. Autosave goes through use-autosave.ts with `draftTarget`. */
export const studioBrowser = {
  draftTarget: (key: string) => ({
    url: `${path(key)}/draft`,
    body: (answers: StudioAnswers, expectedRevision: number) => ({ answers, expectedRevision }),
  }),
  /** The caller keeps `idempotencyKey` for retries of the same commit, so a repeat click never duplicates (S4-10). */
  async commit(key: string, expectedRevision: number, idempotencyKey: string): Promise<StudioCallResult<CommitResult>> {
    try {
      const res = await fetch(`${path(key)}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ expectedRevision, dataClassification: 'SYNTHETIC' }),
      });
      const json = await res.json().catch(() => null);
      return {
        ok: res.ok,
        status: res.status,
        data: res.ok ? json : null,
        error: res.ok ? null : (json?.message ?? `Commit failed (${res.status})`),
        code: res.ok ? null : (json?.error ?? null),
        problems: json?.problems ?? null,
      };
    } catch {
      return { ok: false, status: 0, data: null, error: 'Could not reach the server. Your work is saved; try again.', code: null, problems: null };
    }
  },
};
