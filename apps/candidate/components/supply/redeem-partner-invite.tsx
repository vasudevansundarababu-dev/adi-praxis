'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';

/** Redeems a partner invitation once, then opens the application it started. */
export function RedeemPartnerInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void call<{ enrollmentId: string; opportunityId: string }>('POST', '/me/partner-invites/redeem', { token }).then((r) => {
      if (r.ok) return router.replace(`/enrollments/${r.data!.enrollmentId}`);
      if (r.code === 'ALREADY_REGISTERED') return setError({ title: 'You’re already registered', body: r.error ?? 'Continue from your home page.' });
      if (r.status === 404 || r.status === 400) return setError({ title: 'This link can’t be used', body: 'We couldn’t find this invitation. Check that you opened the full link from the email, or ask the person who put you forward to send it again.' });
      setError({ title: 'This link can’t be used', body: r.error ?? 'Something went wrong. Try the link again in a minute.' });
    });
  }, [token, router]);
  if (!error) return <p aria-live="polite">Opening your application…</p>;
  return (
    <div role="alert" className="card p-6">
      <h1 className="text-2xl font-semibold">{error.title}</h1>
      <p className="mt-3">{error.body}</p>
      <Link href="/home" className="mt-6 inline-block btn btn-primary">
        Go to your home page
      </Link>
    </div>
  );
}
