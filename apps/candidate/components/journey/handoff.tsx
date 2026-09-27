'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';

/** Redeems the single-use handoff token, then opens the project's task list (FLOW 3). */
export function Handoff() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) {
      setState({ ok: false, message: 'This link is incomplete. Open the workbench again from your home page.' });
      return;
    }
    // Remove the token from the address bar and history before redeeming it.
    window.history.replaceState(null, '', '/workbench/handoff');
    void call<{ assignmentId: string; projectId: string }>('POST', '/workbench/handoff', { token }).then((r) => {
      if (r.ok) router.replace(`/projects/${r.data!.projectId}`);
      else setState({ ok: false, message: r.error ?? 'This link has expired.' });
    });
  }, [token, router]);

  if (!state) return <p aria-live="polite">Opening your workbench…</p>;
  return (
    <div aria-live="polite">
      <h1 className="text-2xl font-semibold">{state.ok ? 'Workbench' : 'Link expired'}</h1>
      <p className="mt-3">{state.message}</p>
      <Link href="/home" className="mt-6 inline-block text-link underline">
        Back to home
      </Link>
    </div>
  );
}
