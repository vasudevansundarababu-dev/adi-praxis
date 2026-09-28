'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { partnerMutate } from './partner-mutate';

/** Withdraw a live submission. Two steps, because a withdrawal ends the submission and starts the 90-day cool-off. */
export function WithdrawButton({ candidateId, name }: { candidateId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setPending(true);
    setError(null);
    const res = await partnerMutate(`/candidates/${candidateId}/withdraw`);
    setPending(false);
    if (!res.ok) {
      setError(res.status === 409 ? `${res.error} Refresh the page to see the current state.` : res.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (!confirming)
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
        Withdraw candidate
      </button>
    );
  return (
    <div role="group" aria-label="Confirm withdrawal" className="card space-y-3 p-4 text-sm">
      <p>
        Withdraw {name}? Their invite stops working and this submission ends. You cannot put the same person forward again for 90 days, and no other partner can either.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={withdraw}>
          {pending ? 'Withdrawing…' : 'Yes, withdraw'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setConfirming(false)}>
          Keep the submission
        </button>
      </div>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </div>
  );
}
