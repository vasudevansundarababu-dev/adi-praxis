'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';

export function RedeemInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void call<{ projectId: string }>('POST', '/me/invites/redeem', { token }).then((r) => {
      if (r.ok) router.replace(`/projects/${r.data!.projectId}`);
      else setError(r.error);
    });
  }, [token, router]);
  if (!error) return <p aria-live="polite">Opening your tasks…</p>;
  return (
    <div role="alert">
      <h1 className="text-2xl font-semibold">This link can’t be used</h1>
      <p className="mt-3">{error}</p>
      <Link href="/home" className="mt-6 inline-block text-link underline">
        Go to your home page
      </Link>
    </div>
  );
}
