'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate, type MutationResult } from '@/lib/client-api';

export const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';
export const inputInline = 'mt-1 block rounded-md border border-line bg-surface px-2 py-1.5';

/**
 * One state-changing call at a time, with the pending flag, the API's error and its problem list, and a page refresh
 * on success (server components re-fetch). Every call goes through `mutate`, so it carries a fresh Idempotency-Key.
 */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T = unknown>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown, opts: { refresh?: boolean; success?: string } = {}): Promise<MutationResult<T>> {
    setPending(true);
    setError(null);
    setProblems([]);
    setNotice(null);
    const res = await mutate<T>(method, path, body);
    setPending(false);
    if (!res.ok) {
      setError(res.status === 404 ? `${res.error ?? 'Not found'}. If SME supply was just switched off, this action is no longer available.` : res.error);
      setProblems(res.problems ?? []);
    } else {
      if (opts.success) setNotice(opts.success);
      if (opts.refresh !== false) router.refresh();
    }
    return res;
  }

  return { run, pending, error, problems, notice, setError, setNotice, setPending, refresh: () => router.refresh() };
}

/** The API's message, what to do next, and any listed problems. */
export function ActionMessages({ error, problems = [], notice }: { error: string | null; problems?: string[]; notice?: string | null }) {
  return (
    <>
      {error && (
        <div role="alert" className="text-sm text-error">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && !error && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
    </>
  );
}

/** Multipart upload (guidelines files). Same Idempotency-Key rule as `mutate`. */
export async function upload<T>(path: string, form: FormData): Promise<MutationResult<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: form });
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    return { ok: res.ok, status: res.status, data: res.ok ? json : null, error: res.ok ? null : (json?.message ?? `Upload failed (${res.status})`) };
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

export const splitList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
