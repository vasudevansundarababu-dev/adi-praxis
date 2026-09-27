'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export type ApiClientRow = { id: string; name: string; kind: string; createdAt: string; revokedAt: string | null };

export function ApiClients({ initial }: { initial: ApiClientRow[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('CLIENT_API');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6 space-y-6 text-sm">
      <form
        className="flex flex-wrap items-end gap-3 card p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await mutate<{ key: string }>('POST', '/api-clients', { name, kind });
          if (!res.ok) return setError(res.error);
          setKey(res.data!.key);
          setName('');
          router.refresh();
        }}
      >
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5">
            <option value="CLIENT_API">Client system (task inputs)</option>
            <option value="RL_GYM">RL Gym</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary">
          Create key
        </button>
      </form>
      {key && (
        <div role="status" className="rounded-md border border-warning p-3">
          <p className="font-medium">Copy this key now. It will not be shown again.</p>
          <code className="mt-1 block break-all">{key}</code>
        </div>
      )}
      <ul className="card divide-y divide-line">
        {initial.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="font-medium">{c.name}</span>
            <span className="text-fg-muted">
              {c.kind === 'RL_GYM' ? 'RL Gym' : 'Client system'} · created {new Date(c.createdAt).toLocaleDateString()}
              {c.revokedAt ? ` · revoked ${new Date(c.revokedAt).toLocaleDateString()}` : ''}
            </span>
            {!c.revokedAt && (
              <button
                type="button"
                onClick={async () => {
                  const res = await mutate('POST', `/api-clients/${c.id}/revoke`);
                  if (!res.ok) return setError(res.error);
                  router.refresh();
                }}
                className="ml-auto text-link"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
        {initial.length === 0 && <li className="px-3 py-2 text-fg-muted">No keys yet.</li>}
      </ul>
      {error && <p role="alert" className="text-error">{error}</p>}
    </div>
  );
}
