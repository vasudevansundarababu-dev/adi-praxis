'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export function CancelProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function cancel() {
    setPending(true);
    const res = await mutate('POST', `/projects/${projectId}/cancel`);
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="mt-6">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Cancelling is final. Cancel this project?</span>
          <button type="button" disabled={pending} onClick={cancel} className="rounded-md border border-error px-3 py-1.5 text-sm text-error disabled:opacity-60">
            Yes, cancel project
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-line px-3 py-1.5 text-sm">
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="rounded-md border border-line px-3 py-1.5 text-sm">
          Cancel project
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
