'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';

/** "Build my SME profile". The opportunity (and campaign) survive sign-in and verification via returnTo (CF-03). */
export function StartProfileButton({ opportunityId, campaignId, signedIn, autoStart }: { opportunityId: string; campaignId?: string; signedIn: boolean; autoStart: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  async function start() {
    const here = `/opportunities/${opportunityId}?${new URLSearchParams({ ...(campaignId ? { campaign: campaignId } : {}), start: '1' })}`;
    if (!signedIn) return router.push(`/sign-in?returnTo=${encodeURIComponent(here)}`);
    setPending(true);
    const r = await call<{ id: string }>('POST', '/me/enrollments', { opportunityId, campaignId });
    setPending(false);
    if (!r.ok) return setError(r.error);
    router.push(`/enrollments/${r.data!.id}`);
  }

  // Coming back from sign-in / verification with start=1 continues automatically.
  useEffect(() => {
    if (autoStart && signedIn && !started.current) {
      started.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, signedIn]);

  return (
    <div className="mt-6">
      <button type="button" disabled={pending} onClick={start} className="rounded-md bg-primary px-5 py-2.5 font-medium text-on-primary disabled:opacity-60">
        {pending ? 'Starting…' : 'Build my SME profile'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
