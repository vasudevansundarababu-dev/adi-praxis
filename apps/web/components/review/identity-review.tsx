'use client';

import { useState } from 'react';
import { mutate } from '@/lib/client-api';

type Item = { smeUserId: string; displayName: string | null; reason: string | null; requestedAt: string };

export function IdentityReviewList({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, outcome: 'ALTERNATIVE_VERIFIED' | 'NOT_VERIFIED') {
    const res = await mutate('POST', `/review/identity/${id}/decision`, { outcome, method, notes: notes || undefined });
    if (!res.ok) return setError(res.error);
    setItems(items.filter((i) => i.smeUserId !== id));
    setOpen(null);
    setMethod('');
    setNotes('');
  }

  if (items.length === 0) return <p className="mt-6 text-fg-muted">Nobody is waiting for an identity review.</p>;
  return (
    <ul className="mt-6 space-y-3">
      {items.map((i) => (
        <li key={i.smeUserId} className="rounded-md border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{i.displayName ?? 'Unnamed candidate'}</span>
            <span className="text-fg-muted">{i.reason?.replace(/_/g, ' ').toLowerCase()} · {new Date(i.requestedAt).toLocaleString()}</span>
            <button type="button" onClick={() => setOpen(open === i.smeUserId ? null : i.smeUserId)} className="ml-auto text-link">
              Record decision
            </button>
          </div>
          {open === i.smeUserId && (
            <div className="mt-3 space-y-2">
              <label className="block">
                Alternative method used (required)
                <input value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
              </label>
              <label className="block">
                Notes (no ID numbers)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
              </label>
              <div className="flex gap-2">
                <button type="button" disabled={!method.trim()} onClick={() => decide(i.smeUserId, 'ALTERNATIVE_VERIFIED')} className="btn btn-primary disabled:opacity-50">
                  Verified by alternative process
                </button>
                <button type="button" disabled={!method.trim()} onClick={() => decide(i.smeUserId, 'NOT_VERIFIED')} className="btn btn-secondary disabled:opacity-50">
                  Not verified
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
      {error && <p role="alert" className="text-error">{error}</p>}
    </ul>
  );
}
