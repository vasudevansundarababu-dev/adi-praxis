'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { call } from '@/lib/client';
import { CANDIDATE_PASSWORD_MIN } from '@praxis/shared';
import { FORGOT_SENT, newPasswordProblem } from '@/lib/forge';

const INPUT = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';

/** MVP1 step 6: choose a password from the one-time link (set on assignment, or reset). Does not sign in. */
export function SetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirm);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const res = await call<{ ok: true }>('POST', '/auth/password/set', { token, password });
    setPending(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  if (done) {
    return (
      <div className="mt-6 space-y-4" role="status">
        <p className="text-sm">Your password is set. Sign in with your email address and your new password.</p>
        <Link href="/sign-in" className="btn btn-primary inline-block">Sign in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
      <RequiredNote />
      <div>
        <label htmlFor="new-password" className="block text-sm">
          New password
          <Req />
        </label>
        <input id="new-password" type="password" autoComplete="new-password" required aria-describedby="new-password-hint" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        <p id="new-password-hint" className="mt-1 text-xs text-fg-muted">At least {CANDIDATE_PASSWORD_MIN} characters. Do not use your email address.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm">
          Confirm new password
          <Req />
        </label>
        <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full btn btn-primary disabled:opacity-60">
        {pending ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}

/** Forgot password: the answer is the same whether or not the email has an account. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email address.');
    setPending(true);
    setError(null);
    const res = await call<{ ok: true }>('POST', '/auth/password/forgot', { email });
    setPending(false);
    if (res.ok || res.status === 202) setSent(true);
    else setError(res.error);
  }

  if (sent) {
    return (
      <div className="mt-6 space-y-4" role="status">
        <p className="text-sm">{FORGOT_SENT} The link expires in 1 hour.</p>
        <Link href="/sign-in" className="text-link underline">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
      <div>
        <label htmlFor="forgot-email" className="block text-sm">
          Email
          <Req />
        </label>
        <input id="forgot-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full btn btn-primary disabled:opacity-60">
        {pending ? 'Sending…' : 'Send me a link'}
      </button>
      <p className="text-sm">
        <Link href="/sign-in" className="text-link underline">Back to sign in</Link>
      </p>
    </form>
  );
}
