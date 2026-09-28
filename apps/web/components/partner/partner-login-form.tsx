'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';

/** Partner portal sign-in (email + password). The API sets the `praxis_partner` cookie on this same origin. */
export function PartnerLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!email || !password) return setError('Enter your email and password.');
    setPending(true);
    try {
      const res = await fetch('/api/v1/partner-portal/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace('/partner');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.status === 429) setError('Too many attempts. Wait a minute and try again.');
      else if (res.status === 404) setError('The partner portal is not switched on here. Contact your ADI Praxis partner manager.');
      else if (res.status === 400) setError('Enter a valid email address and your password.');
      else setError(body?.message ?? 'Sign-in failed. Try again.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <RequiredNote />
      <div>
        <label htmlFor="partner-email" className="block text-sm font-medium">
          Work email
          <Req />
        </label>
        <input id="partner-email" name="email" type="email" autoComplete="username" required className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-fg" />
      </div>
      <div>
        <label htmlFor="partner-password" className="block text-sm font-medium">
          Password
          <Req />
        </label>
        <input id="partner-password" name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-fg" />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-error px-3 py-2 text-sm text-fg">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full btn btn-primary disabled:opacity-60">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export function PartnerSignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch('/api/v1/partner-portal/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/partner/login');
    router.refresh();
  }
  return (
    <button type="button" onClick={signOut} className="rounded-lg border border-white/30 px-3 py-1 text-sm text-white hover:bg-white/10">
      Sign out
    </button>
  );
}
