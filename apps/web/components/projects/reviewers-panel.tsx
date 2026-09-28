'use client';

import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req, RequiredNote } from '@/components/required';

type Person = { userId: string; name: string; email: string };

/** Reviewers see and decide applications only for the projects they are assigned to. */
export function ReviewersPanel({ projectId, initial }: { projectId: string; initial: { items: Person[]; available: Person[] } }) {
  const [data, setData] = useState(initial);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch(`/api/v1/projects/${projectId}/reviewers`, { cache: 'no-store' });
    if (res.ok) setData(await res.json());
  }
  async function add() {
    const res = await mutate('POST', `/projects/${projectId}/reviewers`, { userId: choice });
    if (!res.ok) return setError(res.error);
    setChoice('');
    await reload();
  }
  async function remove(userId: string) {
    const res = await fetch(`/api/v1/projects/${projectId}/reviewers/${userId}`, { method: 'DELETE', headers: { 'idempotency-key': crypto.randomUUID() } });
    if (!res.ok) return setError('Could not remove the reviewer.');
    await reload();
  }

  return (
    <section aria-labelledby="reviewers-h" className="mt-8 card p-4 text-sm">
      <h2 id="reviewers-h" className="font-semibold">Validators</h2>
      <p className="mt-1 text-fg-muted">People who review candidates for this project’s pool.</p>
      {data.items.length === 0 ? (
        <p className="mt-3 text-warning">No reviewer assigned yet; only Admins can decide applications.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {data.items.map((r) => (
            <li key={r.userId} className="flex items-center gap-2">
              {r.name} <span className="text-fg-muted">{r.email}</span>
              <button type="button" onClick={() => remove(r.userId)} className="ml-auto text-link">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.available.length > 0 && (
        <>
        <RequiredNote className="mt-3" />
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <label>
            Add reviewer
            <Req />
            <select aria-required="true" value={choice} onChange={(e) => setChoice(e.target.value)} className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5">
              <option value="">Choose…</option>
              {data.available.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!choice} onClick={add} className="btn btn-secondary disabled:opacity-50">
            Add
          </button>
        </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-error">{error}</p>}
    </section>
  );
}
