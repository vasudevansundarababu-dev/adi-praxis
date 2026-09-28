'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';

/** Simulated provider only: marks the payment set-up complete, as the provider's webhook would, then returns. */
export function MockPayeeFinish() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6">
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await call('POST', '/me/payee/mock-complete');
          if (!res.ok) {
            setError(res.error ?? 'Could not finish the simulated set-up. Start again from Payments.');
            setBusy(false);
            return;
          }
          router.push('/payments?returned=1');
        }}
      >
        {busy ? 'Finishing…' : 'Finish and return to ADI Praxis →'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
