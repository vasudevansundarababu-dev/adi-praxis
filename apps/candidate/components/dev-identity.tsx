'use client';

import { useState } from 'react';
import { call } from '@/lib/client';

const OUTCOMES = [
  { label: 'Verified (18 or over)', body: { status: 'verified', adult: true } },
  { label: 'Verified but under 18', body: { status: 'verified', adult: false } },
  { label: 'Needs more input (document expired)', body: { status: 'requires_input', errorCode: 'document_expired' } },
  { label: 'Processing', body: { status: 'processing' } },
  { label: 'Canceled', body: { status: 'canceled' } },
];

export function DevIdentitySimulator({ sessionId, returnUrl }: { sessionId: string; returnUrl: string }) {
  const [error, setError] = useState<string | null>(null);
  async function simulate(body: object) {
    const r = await call('POST', `/dev/identity/${sessionId}/simulate`, body);
    if (!r.ok) return setError(r.error);
    // Only same-origin paths; the API builds this URL from CANDIDATE_APP_URL.
    const u = new URL(returnUrl, window.location.origin);
    window.location.href = u.origin === window.location.origin ? u.pathname + u.search : '/verify';
  }
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <p className="rounded-md border border-warning p-3 text-sm font-medium text-warning">
        Development only — simulated identity provider. No document is checked.
      </p>
      <h1 className="mt-6 text-xl font-semibold">Simulate the Stripe Identity result</h1>
      <p className="mt-1 text-sm text-fg-muted">Session {sessionId}</p>
      <div className="mt-6 grid gap-2">
        {OUTCOMES.map((o) => (
          <button key={o.label} type="button" onClick={() => simulate(o.body)} className="btn btn-secondary text-left text-sm hover:bg-surface">
            {o.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
    </main>
  );
}
