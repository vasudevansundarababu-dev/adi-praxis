'use client';

import { ISO_COUNTRIES, ISO_LANGUAGES } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { call } from '@/lib/client';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';
const languageName = new Map(ISO_LANGUAGES.map(([c, n]) => [c, n]));

/** Direct application on a careers page; it then continues into the usual FLOW 2 profile. */
export function RequisitionApply({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState('');
  const [years, setYears] = useState('');
  const [quals, setQuals] = useState('');
  const [languages, setLanguages] = useState<string[]>(['en']);
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; home?: boolean } | null>(null);

  const valid = summary.trim().length >= 10 && years !== '' && Number(years) >= 0 && Number(years) <= 60 && country && consent;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setPending(true);
    setError(null);
    const r = await call<{ enrollmentId: string }>('POST', `/me/requisitions/${requisitionId}/apply`, {
      experienceSummary: summary.trim(),
      experienceYears: Number(years),
      qualifications: quals.split('\n').map((q) => q.trim()).filter(Boolean),
      languages,
      country,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      consent: true,
    });
    setPending(false);
    if (r.ok) return router.push(`/enrollments/${r.data!.enrollmentId}`);
    setError({ message: r.status === 400 ? 'Some answers need another look. Check each field and try again.' : (r.error ?? 'Something went wrong. Try again.'), home: r.code === 'ALREADY_REGISTERED' });
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5 text-sm">
      <div>
        <h2 className="text-base font-semibold">Apply for this role</h2>
        <p className="mt-1 text-fg-muted">A few details to get started. Don’t include confidential employer or customer information.</p>
        <RequiredNote className="mt-1" />
      </div>
      <label className="block">
        Your relevant experience, in a few sentences
        <Req />
        <textarea required minLength={10} maxLength={4000} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} className={input} />
      </label>
      <label className="block">
        Years of relevant experience
        <Req />
        <input type="number" required min={0} max={60} step={0.5} value={years} onChange={(e) => setYears(e.target.value)} className={`${input} sm:max-w-40`} />
      </label>
      <label className="block">
        Qualifications or certificates (optional, one per line)
        <textarea rows={3} maxLength={6000} value={quals} onChange={(e) => setQuals(e.target.value)} className={input} />
      </label>
      <fieldset>
        <legend>Languages you can work in</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {languages.map((l) => (
            <button key={l} type="button" className="chip" aria-pressed="true" aria-label={`Remove ${languageName.get(l) ?? l}`} onClick={() => setLanguages(languages.filter((x) => x !== l))}>
              {languageName.get(l) ?? l} ✕
            </button>
          ))}
        </div>
        {languages.length < 20 && (
          <label className="mt-2 block">
            <span className="sr-only">Add a language</span>
            <select value="" onChange={(e) => e.target.value && setLanguages([...languages, e.target.value])} className={`${input} sm:max-w-xs`}>
              <option value="">Add a language…</option>
              {ISO_LANGUAGES.filter(([c]) => !languages.includes(c)).map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <label className="block">
        Country you work from
        <Req />
        <select required value={country} onChange={(e) => setCountry(e.target.value)} className={`${input} sm:max-w-xs`}>
          <option value="">Choose…</option>
          {ISO_COUNTRIES.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Phone (optional)
        <input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${input} sm:max-w-xs`} />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>
          I agree that ADI Praxis may use these details to consider me for this role.
          <Req />
        </span>
      </label>
      <button type="submit" disabled={pending || !valid} className="btn btn-primary">
        {pending ? 'Sending…' : 'Apply and continue →'}
      </button>
      {error && (
        <p role="alert" className="text-error">
          {error.message}{' '}
          {error.home && (
            <Link href="/home" className="text-link underline">
              Go to your home page
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
