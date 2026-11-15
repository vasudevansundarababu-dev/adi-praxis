'use client';

import type { ForgeTermsDoc } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { call } from '@/lib/client';
import { welcomeProblem } from '@/lib/forge';

/** Before you start (first sign-in, once): the contributor terms and the synthetic-data-only confirmation. */
export function WelcomeForm({ terms, initialError = null }: { terms: (ForgeTermsDoc | null)[]; initialError?: string | null }) {
  const router = useRouter();
  const [contributor, setContributor] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const published = terms.filter((t): t is ForgeTermsDoc => !!t);
  const missing = published.length !== terms.length;

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    const problem = welcomeProblem(contributor, synthetic);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const res = await call('POST', '/me/forge/terms', { hashes: Object.fromEntries(published.map((t) => [t.key, t.sha256])), syntheticOnly: true });
    setPending(false);
    if (!res.ok) return setError(res.code === 'TERMS_CHANGED' ? 'The terms have changed. Reload the page to read the current version.' : res.error);
    router.replace('/home');
    router.refresh();
  }

  if (missing) {
    return (
      <p role="alert" className="card mt-6 p-4 text-sm">
        The contributor terms have not been published yet, so you can&apos;t start. Please check back later.
      </p>
    );
  }

  return (
    <form onSubmit={accept} noValidate className="mt-6 space-y-4">
      <RequiredNote />
      <div className="card space-y-3 p-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-required="true" checked={contributor} onChange={(e) => setContributor(e.target.checked)} className="mt-1" />
          <span>
            <strong>Contributor terms</strong>
            <Req /> Confidentiality, intellectual property and data use. I have read and accept them.
          </span>
        </label>
        <ul className="space-y-2 pl-6">
          {published.map((t) => (
            <li key={t.key}>
              <details className="text-sm">
                <summary className="cursor-pointer text-link">
                  {t.title} (version {t.version})
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-fg-muted">{t.body}</p>
              </details>
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-required="true" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} className="mt-1" />
          <span>
            <strong>Synthetic data only</strong>
            <Req /> Everything I write is made up. I won&apos;t use real customer, employer or account information.
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary disabled:opacity-60">
        {pending ? 'Saving…' : 'Accept and continue'}
      </button>
      <p className="text-xs text-fg-muted">Your acceptance and the terms version are recorded.</p>
    </form>
  );
}
