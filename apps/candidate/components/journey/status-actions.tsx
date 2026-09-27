'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';

export function StatusActions({ id, canAmend, canRequestReview, canWithdraw }: { id: string; canAmend: boolean; canRequestReview: boolean; canWithdraw: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(path: string, body: unknown, then: () => void) {
    setPending(true);
    setError(null);
    const r = await call('POST', path, body);
    setPending(false);
    if (!r.ok) return setError(r.error);
    then();
  }

  return (
    <div className="mt-6 space-y-6">
      {canAmend && (
        <button type="button" disabled={pending} onClick={() => run(`/me/enrollments/${id}/amend`, {}, () => router.push(`/enrollments/${id}`))} className="rounded-md bg-primary px-4 py-2 font-medium text-on-primary disabled:opacity-60">
          Update my profile
        </button>
      )}
      {canRequestReview && (
        <form
          className="rounded-lg border border-line p-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`/me/enrollments/${id}/review-request`, { reason }, () => router.refresh());
          }}
        >
          <h2 className="font-semibold">Ask for a review</h2>
          <p className="mt-1 text-fg-muted">If something was missed or has changed, tell us. A different person can look again; the earlier decision stays on record.</p>
          <label className="mt-3 block">
            What should the reviewer know?
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <button type="submit" disabled={pending || !reason.trim()} className="mt-2 rounded-md border border-line px-3 py-1.5 disabled:opacity-60">
            Request review
          </button>
        </form>
      )}
      {canWithdraw && (
        <div className="text-sm">
          {!confirmWithdraw ? (
            <button type="button" onClick={() => setConfirmWithdraw(true)} className="text-link underline">
              Withdraw this application
            </button>
          ) : (
            <div role="group" aria-label="Confirm withdrawal" className="rounded-lg border border-warning p-4">
              <p>Withdrawing stops any pending assignments for this pool. Your history is kept. Continue?</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={pending} onClick={() => run(`/me/enrollments/${id}/withdraw`, {}, () => router.refresh())} className="rounded-md border border-error px-3 py-1.5 text-error disabled:opacity-60">
                  Yes, withdraw
                </button>
                <button type="button" onClick={() => setConfirmWithdraw(false)} className="rounded-md border border-line px-3 py-1.5">
                  Keep my application
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </div>
  );
}
