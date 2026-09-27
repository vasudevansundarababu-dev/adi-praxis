'use client';

import { IDENTITY_HELP_REASONS, identityEligible, type CandidateMeDto } from '@praxis/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { call } from '@/lib/client';

const STATE_TEXT: Record<string, { title: string; body: string }> = {
  NOT_STARTED: { title: 'Not started', body: 'It takes a few minutes. Have an identity document ready.' },
  REQUIRES_INPUT: { title: 'Continue verification', body: 'Your check is not finished yet. You can continue where you left off.' },
  PROCESSING: { title: 'Processing', body: 'We are waiting for the result. This page updates by itself.' },
  VERIFIED: { title: 'Verified', body: 'Your identity is verified.' },
  ALTERNATIVE_VERIFIED: { title: 'Verified', body: 'Your identity was verified through our alternative process.' },
  CANCELED: { title: 'Canceled', body: 'The check was canceled. You can start again or ask for help.' },
  MANUAL_REVIEW_REQUIRED: { title: 'Help needed', body: 'Our team is reviewing your case and will contact you.' },
};
const HELP_LABELS: Record<(typeof IDENTITY_HELP_REASONS)[number], string> = {
  UNSUPPORTED_DOCUMENT: 'My document type is not accepted',
  UNSUPPORTED_COUNTRY: 'My country is not supported',
  CONSENT: 'I do not consent to the automated check',
  TECHNICAL: 'The check keeps failing technically',
  OTHER: 'Something else',
};

export function IdentityPanel({ initial, returnTo }: { initial: CandidateMeDto; returnTo: string }) {
  const [me, setMe] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reason, setReason] = useState<(typeof IDENTITY_HELP_REASONS)[number]>('UNSUPPORTED_DOCUMENT');
  const [note, setNote] = useState('');

  // Poll the server-confirmed status while the provider is working.
  useEffect(() => {
    if (me.identityStatus !== 'PROCESSING' && me.identityStatus !== 'REQUIRES_INPUT') return;
    const t = setInterval(async () => {
      const r = await call<CandidateMeDto>('GET', '/me');
      if (r.ok) setMe(r.data!);
    }, 5000);
    return () => clearInterval(t);
  }, [me.identityStatus]);

  async function start() {
    setPending(true);
    const r = await call<{ url: string }>('POST', '/me/identity/session', { returnTo: returnTo || undefined });
    setPending(false);
    if (!r.ok) return setError(r.error);
    window.location.href = r.data!.url;
  }

  async function askHelp(e: React.FormEvent) {
    e.preventDefault();
    const r = await call<CandidateMeDto>('POST', '/me/identity/help', { reason, note: note.trim() || undefined });
    if (!r.ok) return setError(r.error);
    setMe(r.data!);
    setHelpOpen(false);
  }

  const state = STATE_TEXT[me.identityStatus] ?? STATE_TEXT.NOT_STARTED!;
  const eligible = identityEligible(me.identityStatus);
  const canStart = ['NOT_STARTED', 'REQUIRES_INPUT', 'CANCELED'].includes(me.identityStatus);

  return (
    <section className="mt-6 card p-5" aria-live="polite">
      <p className="text-sm text-fg-muted">Status</p>
      <p className="text-lg font-semibold">{eligible ? me.identityLabel : state.title}</p>
      <p className="mt-1 text-sm">{state.body}</p>
      {me.identityProblem && <p className="mt-3 rounded-md border border-warning p-3 text-sm">{me.identityProblem}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        {eligible ? (
          <Link href={returnTo || '/home'} className="btn btn-primary">
            Continue
          </Link>
        ) : canStart ? (
          <button type="button" disabled={pending} onClick={start} className="btn btn-primary disabled:opacity-60">
            {me.identityStatus === 'NOT_STARTED' ? 'Start verification' : 'Continue verification'}
          </button>
        ) : null}
        {!eligible && me.identityStatus !== 'MANUAL_REVIEW_REQUIRED' && (
          <button type="button" onClick={() => setHelpOpen(!helpOpen)} className="btn btn-secondary">
            I need help
          </button>
        )}
      </div>

      {helpOpen && (
        <form onSubmit={askHelp} className="mt-4 space-y-3 border-t border-line pt-4">
          <fieldset>
            <legend className="text-sm font-medium">What is the problem?</legend>
            {IDENTITY_HELP_REASONS.map((r) => (
              <label key={r} className="mt-1 flex items-center gap-2 text-sm">
                <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                {HELP_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            Anything else we should know? (optional; do not include ID numbers)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2" />
          </label>
          <button type="submit" className="btn btn-secondary">
            Ask for help
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
