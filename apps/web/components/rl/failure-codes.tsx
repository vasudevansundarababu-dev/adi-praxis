'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req, RequiredNote } from '@/components/required';

export type Code = { id: string; code: string; label: string; active: boolean };

export function FailureCodes({ initial }: { initial: Code[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6 space-y-4 text-sm">
      <ul className="card divide-y divide-line">
        {initial.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2">
            <span className="font-mono text-xs">{c.code}</span>
            <span className={c.active ? '' : 'text-fg-muted line-through'}>{c.label}</span>
            <button
              type="button"
              onClick={async () => {
                const res = await fetch(`/api/v1/failure-reason-codes/${c.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ active: !c.active }) });
                if (!res.ok) return setError('Could not update the code.');
                router.refresh();
              }}
              className="ml-auto text-link"
            >
              {c.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await mutate('POST', '/failure-reason-codes', { code, label });
          if (!res.ok) return setError(res.error);
          setCode('');
          setLabel('');
          router.refresh();
        }}
      >
        <RequiredNote className="w-full" />
        <label>
          Code
          <Req />
          <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="E.G. WRONG_TOOL" className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <label className="flex-1">
          Label
          <Req />
          <input required value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <button type="submit" className="btn btn-primary">Add code</button>
      </form>
      {error && <p role="alert" className="text-error">{error}</p>}
    </div>
  );
}
