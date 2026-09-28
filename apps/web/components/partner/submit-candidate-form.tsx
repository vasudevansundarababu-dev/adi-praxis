'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatePill } from './labels';
import { partnerMutate } from './partner-mutate';

type Job = { employer: string; title: string; start: string; end: string };
type Result = { candidateId: string; state: string; screen: string; screenReasons: string[]; inviteExpiresAt: string | null };
type Duplicate = { message: string; candidateId?: string };

const input = 'mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-fg';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const splitList = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);

/** Submit a candidate for one requisition (docs/SME-SUPPLY.md section 5). Portal submissions are always live. */
export function SubmitCandidateForm({ requisitionId, requisitionTitle }: { requisitionId: string; requisitionTitle: string }) {
  const router = useRouter();
  const [f, setF] = useState({ partnerRef: '', name: '', email: '', phone: '', country: '', experienceYears: '', experienceSummary: '', qualifications: '', languages: '' });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [attest, setAttest] = useState(false);
  const [consent, setConsent] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  function validate(): string[] {
    const p: string[] = [];
    if (!f.name.trim()) p.push("Enter the candidate's full name.");
    if (!EMAIL.test(f.email.trim())) p.push("Enter the candidate's email address, for example name@example.com.");
    if (!/^[A-Za-z]{2}$/.test(f.country.trim())) p.push('Enter the country as a two-letter code, for example IN, US or GB.');
    const years = Number(f.experienceYears);
    if (f.experienceYears.trim() === '' || Number.isNaN(years) || years < 0 || years > 60) p.push('Enter years of experience as a number from 0 to 60.');
    if (f.experienceSummary.trim().length < 10) p.push('Describe the candidate’s experience in at least 10 characters.');
    jobs.forEach((j, i) => {
      if (!j.employer.trim() || !j.title.trim()) p.push(`Employment ${i + 1}: enter the employer and job title, or remove the row.`);
      if (!MONTH.test(j.start)) p.push(`Employment ${i + 1}: choose a start month.`);
      if (j.end && !MONTH.test(j.end)) p.push(`Employment ${i + 1}: choose an end month, or leave it empty for a current role.`);
      if (j.end && MONTH.test(j.start) && j.end < j.start) p.push(`Employment ${i + 1}: the end month is before the start month.`);
    });
    if (splitList(f.languages, /[,\n]/).some((l) => l.length < 2)) p.push('Enter languages as codes or names of at least two letters, for example en, hi.');
    if (!attest) p.push('Confirm that you trained the candidate on the guidelines summary.');
    if (!consent) p.push('Confirm that the candidate agreed to be put forward and contacted.');
    return p;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    const p = validate();
    setProblems(p);
    if (p.length) return;
    setPending(true);
    const body = {
      ...(f.partnerRef.trim() ? { partnerRef: f.partnerRef.trim() } : {}),
      name: f.name.trim(),
      email: f.email.trim(),
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      country: f.country.trim().toUpperCase(),
      experienceSummary: f.experienceSummary.trim(),
      experienceYears: Number(f.experienceYears),
      employmentHistory: jobs.map((j) => ({ employer: j.employer.trim(), title: j.title.trim(), start: j.start, end: j.end || null })),
      qualifications: splitList(f.qualifications, /\n/),
      languages: splitList(f.languages, /[,\n]/),
      partnerTrainingAttestation: true,
      candidateConsent: true,
    };
    const res = await partnerMutate<Result>(`/requisitions/${requisitionId}/candidates`, body);
    setPending(false);
    if (res.ok && res.data) {
      setResult(res.data);
      router.refresh();
      return;
    }
    if (res.code === 'DUPLICATE_CANDIDATE') {
      // The API records the duplicate and says why, without naming the partner that owns the candidate.
      const id = typeof res.body?.candidateId === 'string' ? res.body.candidateId : undefined;
      setDuplicate({ message: res.error ?? 'This candidate is already put forward through another channel.', candidateId: id });
      return;
    }
    if (res.code === 'PARTNER_REF_IN_USE') setError('You already used this reference for another candidate. Enter a different reference, or leave it empty.');
    else if (res.status === 400) setError('Some details were not accepted. Check each field and try again.');
    else if (res.status === 404) setError('This requisition is no longer open to you. Go back to Requisitions to see what is open.');
    else setError(res.error);
  }

  if (result) {
    return (
      <div className="card p-5" role="status">
        <h2 className="text-lg font-semibold">Candidate submitted</h2>
        <p className="mt-1 text-sm">
          {f.name} is submitted for {requisitionTitle}. ADI Praxis has emailed them an invite
          {result.inviteExpiresAt ? `, valid until ${new Date(result.inviteExpiresAt).toLocaleDateString()}` : ''}. They must accept it to continue.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">Requirement screen:</span>
          <StatePill state={result.screen} />
        </div>
        {result.screenReasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-fg-muted">
            {result.screenReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-fg-muted">The screen is a recommendation. Only a Validator can decide that a candidate does not meet the requirements.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/partner/candidates/${result.candidateId}`} className="btn btn-primary">
            Track this candidate
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setResult(null);
              setF({ partnerRef: '', name: '', email: '', phone: '', country: f.country, experienceYears: '', experienceSummary: '', qualifications: '', languages: '' });
              setJobs([]);
              setAttest(false);
              setConsent(false);
            }}
          >
            Submit another candidate
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6 text-sm">
      <p className="rounded-md border border-line bg-surface px-3 py-2">
        This is a <strong>live</strong> submission: ADI Praxis emails the candidate an invite straight away. Use a sandbox API client to test without contacting anyone.
      </p>

      <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
        <legend className="sr-only">Candidate</legend>
        <label className="block">
          Full name
          <input className={input} value={f.name} onChange={set('name')} autoComplete="off" required />
        </label>
        <label className="block">
          Your reference (optional)
          <input className={input} value={f.partnerRef} onChange={set('partnerRef')} maxLength={100} />
          <span className="mt-1 block text-xs text-fg-muted">Your own ID for this candidate. It appears on webhooks and statements.</span>
        </label>
        <label className="block">
          Email
          <input className={input} type="email" value={f.email} onChange={set('email')} autoComplete="off" required />
          <span className="mt-1 block text-xs text-fg-muted">The invite goes to this address.</span>
        </label>
        <label className="block">
          Phone (optional)
          <input className={input} type="tel" value={f.phone} onChange={set('phone')} maxLength={40} />
        </label>
        <label className="block">
          Country
          <input className={input} value={f.country} onChange={set('country')} maxLength={2} placeholder="IN" />
          <span className="mt-1 block text-xs text-fg-muted">Two-letter code, for example IN, US or GB.</span>
        </label>
        <label className="block">
          Years of relevant experience
          <input className={input} type="number" min={0} max={60} step="0.5" value={f.experienceYears} onChange={set('experienceYears')} />
        </label>
        <label className="block sm:col-span-2">
          Experience summary
          <textarea className={input} rows={4} value={f.experienceSummary} onChange={set('experienceSummary')} maxLength={4000} />
          <span className="mt-1 block text-xs text-fg-muted">What the candidate has done in this domain. Do not include ID numbers or customer data.</span>
        </label>
        <label className="block">
          Qualifications (one per line)
          <textarea className={input} rows={3} value={f.qualifications} onChange={set('qualifications')} />
        </label>
        <label className="block">
          Languages (comma-separated)
          <input className={input} value={f.languages} onChange={set('languages')} placeholder="en, hi" />
        </label>
      </fieldset>

      <fieldset className="card p-5">
        <legend className="sr-only">Employment history</legend>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Employment history (optional)</h2>
          <button type="button" className="btn btn-secondary" onClick={() => setJobs([...jobs, { employer: '', title: '', start: '', end: '' }])} disabled={jobs.length >= 30}>
            Add a role
          </button>
        </div>
        {jobs.length === 0 && <p className="mt-2 text-fg-muted">No roles added.</p>}
        <ul className="mt-3 space-y-3">
          {jobs.map((j, i) => {
            const upd = (k: keyof Job) => (e: React.ChangeEvent<HTMLInputElement>) => setJobs(jobs.map((x, n) => (n === i ? { ...x, [k]: e.target.value } : x)));
            return (
              <li key={i} className="grid gap-3 rounded-md border border-hairline p-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
                <label className="block">
                  Employer
                  <input className={input} value={j.employer} onChange={upd('employer')} maxLength={200} />
                </label>
                <label className="block">
                  Job title
                  <input className={input} value={j.title} onChange={upd('title')} maxLength={200} />
                </label>
                <label className="block">
                  Start
                  <input className={input} type="month" value={j.start} onChange={upd('start')} />
                </label>
                <label className="block">
                  End (empty if current)
                  <input className={input} type="month" value={j.end} onChange={upd('end')} />
                </label>
                <button type="button" className="text-link sm:pb-2" onClick={() => setJobs(jobs.filter((_, n) => n !== i))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="card space-y-3 p-5">
        <legend className="sr-only">Confirmations</legend>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
          <span>I confirm that we trained this candidate on the requisition’s guidelines summary.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>The candidate agreed to be put forward for this requisition and to be contacted by ADI Praxis.</span>
        </label>
      </fieldset>

      {problems.length > 0 && (
        <div role="alert" className="rounded-md border border-error px-3 py-2">
          <p className="font-medium">Fix these before you submit:</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {duplicate && (
        <div role="alert" className="rounded-md border border-error px-3 py-2">
          <p className="font-medium">This candidate was not accepted.</p>
          <p className="mt-1">{duplicate.message}</p>
          <p className="mt-1 text-fg-muted">Check the details, or put forward someone else. The attempt is recorded on your candidate list.</p>
          {duplicate.candidateId && (
            <Link href={`/partner/candidates/${duplicate.candidateId}`} className="mt-1 inline-block text-link">
              View the recorded submission
            </Link>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-error px-3 py-2">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit candidate'}
      </button>
    </form>
  );
}
