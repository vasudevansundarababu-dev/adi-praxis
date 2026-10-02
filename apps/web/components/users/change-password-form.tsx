'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { mutate } from '@/lib/client-api';

const field = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';

/** Choose a new password (console or partner portal). Used for the first sign-in with a temporary password too. */
export function ChangePasswordForm({ endpoint, done }: { endpoint: string; done: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 12) return setError('Use at least 12 characters.');
    if (next !== confirm) return setError('The two new passwords do not match.');
    setPending(true);
    setError(null);
    const res = await mutate('POST', endpoint, { currentPassword: current, newPassword: next });
    setPending(false);
    if (!res.ok) return setError(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : res.error);
    router.replace(done);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      <RequiredNote />
      <label className="block text-sm">
        Current or temporary password<Req />
        <input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
      </label>
      <label className="block text-sm">
        New password<Req />
        <input type="password" required minLength={12} autoComplete="new-password" aria-describedby="pw-help" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
        <span id="pw-help" className="mt-1 block text-xs text-fg-muted">
          At least 12 characters. A few unrelated words is easy to remember and hard to guess. Don’t use your email address or a password you use elsewhere.
        </span>
      </label>
      <label className="block text-sm">
        Confirm new password<Req />
        <input type="password" required autoComplete="new-password" aria-invalid={mismatch || undefined} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
        {mismatch && <span className="mt-1 block text-xs text-error">The two new passwords do not match.</span>}
      </label>
      {error && (
        <p role="alert" className="rounded-md border border-error px-3 py-2 text-sm">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !current || !next || !confirm} className="btn btn-primary w-full">
        {pending ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
