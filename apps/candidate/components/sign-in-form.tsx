'use client';

import type { CandidateMeDto } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { call } from '@/lib/client';

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
  }
}

/** After sign-in: identity first (FLOW2), then back to where the candidate was going. */
function destination(me: CandidateMeDto, returnTo: string) {
  if (me.nextStep === 'VERIFY_IDENTITY') return `/verify${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  return returnTo || '/home';
}

export function SignInForm({ returnTo, googleClientId, demo = false }: { returnTo: string; googleClientId: string; demo?: boolean }) {
  const router = useRouter();
  const [adult, setAdult] = useState(false);
  const [needsAdult, setNeedsAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const adultRef = useRef(adult);
  adultRef.current = adult;

  const finish = useCallback(
    async (credential: string) => {
      setPending(true);
      setError(null);
      const res = await call<CandidateMeDto>('POST', '/auth/google', { credential, adultAttested: adultRef.current });
      setPending(false);
      if (res.ok) {
        router.replace(destination(res.data!, returnTo));
        router.refresh();
      } else if (res.code === 'ADULT_ATTESTATION_REQUIRED') {
        setNeedsAdult(true);
        setError('Please confirm you are 18 or over, then continue again.');
      } else {
        setError(res.error);
      }
    },
    [returnTo, router],
  );

  // Real Google Identity Services button (only when a client id is configured).
  const buttonRef = useRef<HTMLDivElement>(null);
  const initGoogle = useCallback(() => {
    if (!googleClientId || !window.google || !buttonRef.current) return;
    window.google.accounts.id.initialize({ client_id: googleClientId, callback: (r: { credential: string }) => void finish(r.credential) });
    window.google.accounts.id.renderButton(buttonRef.current, { theme: 'filled_black', size: 'large', text: 'continue_with', width: 320 });
  }, [googleClientId, finish]);
  useEffect(() => {
    initGoogle();
  }, [initGoogle]);

  // Local dev only: mock Google.
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  async function devSignIn(e: React.FormEvent) {
    e.preventDefault();
    const t = await call<{ credential: string }>('POST', '/auth/dev/google-token', { email, name });
    if (!t.ok) return setError(t.error);
    await finish(t.data!.credential);
  }

  return (
    <div className="mt-6 space-y-4">
      <RequiredNote />
      <label className={`flex items-start gap-2 text-sm ${needsAdult ? 'rounded-md border border-warning p-2' : ''}`}>
        <input type="checkbox" aria-required="true" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1" />
        <span>
          I confirm I am 18 or over.
          <Req /> (Needed the first time you sign in.)
        </span>
      </label>

      {!googleClientId && process.env.NODE_ENV === 'production' && !demo ? (
        <p role="alert" className="text-sm text-error">Sign-in is not configured yet. Please try again later.</p>
      ) : googleClientId ? (
        <>
          <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={initGoogle} />
          <div ref={buttonRef} aria-label="Continue with Google" />
        </>
      ) : (
        <form onSubmit={devSignIn} className="space-y-3 rounded-md border border-warning p-4">
          <p className="text-sm font-medium text-warning">{demo ? 'Demo sign-in (simulated Google) — demo environment, synthetic data only' : 'Dev sign-in (mock Google) — local development only'}</p>
          <div>
            <label htmlFor="dev-email" className="block text-sm">
              Email
              <Req />
            </label>
            <input id="dev-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2" />
          </div>
          <div>
            <label htmlFor="dev-name" className="block text-sm">
              Name
              <Req />
            </label>
            <input id="dev-name" required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2" />
          </div>
          <button type="submit" disabled={pending} className="w-full btn btn-primary disabled:opacity-60">
            {pending ? 'Signing in…' : 'Continue with Google (mock)'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
