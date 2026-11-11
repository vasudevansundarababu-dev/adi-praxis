'use client';

import { CATEGORY_LABELS, QUALIFICATION_LABELS, POLICY_QUALIFICATIONS } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export interface ProposalRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  category: keyof typeof CATEGORY_LABELS;
  issuer: string | null;
  versionLabel: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  jurisdiction: string | null;
  reason: string;
  proposer: string | null;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  readable: boolean;
  flags: Array<{ code: string; message: string }>;
  status: string;
  createdAt: string;
}

const DECISIONS = [
  { value: 'ACCEPT', label: 'Accept', help: 'Adds it as a project document. Its rules still need extraction, rule review and PM publication.' },
  { value: 'RETURN', label: 'Return to the SME', help: 'The SME can upload a corrected copy (for example a synthetic or readable one).' },
  { value: 'REJECT', label: 'Reject', help: 'Not a policy this project should use.' },
] as const;

/**
 * Wave 3 (handover chapter 07): an Expert, the PM or an Admin decides an SME's proposed policy document. The flags are
 * Praxis's advice only; the decision and its reason are the reviewer's.
 */
export function ProposalReview({ p }: { p: ProposalRow }) {
  const router = useRouter();
  const [decision, setDecision] = useState<(typeof DECISIONS)[number]['value']>('ACCEPT');
  const [qualification, setQualification] = useState<(typeof POLICY_QUALIFICATIONS)[number]>('POLICY_CANDIDATE');
  const [reason, setReason] = useState('');
  const [text, setText] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const base = `/projects/${p.projectId}/policy/proposals/${p.id}`;
  const sensitive = p.flags.some((f) => f.code === 'SENSITIVE_DATA_SUSPECTED');
  const acceptBlocked = decision === 'ACCEPT' && (!p.readable || sensitive);

  async function showText() {
    const res = await fetch(`/api/v1${base}/text`);
    if (res.ok) setText(((await res.json()) as { pages: string[] }).pages);
    else setError('Praxis could not read text from this file. Open the original.');
  }
  async function decide(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await mutate(`POST`, `${base}/decision`, { decision, qualification, reason });
    setPending(false);
    if (!r.ok) setError(r.error ?? `Could not record the decision (${r.status}).`);
    else router.refresh();
  }

  const id = (k: string) => `${p.id}-${k}`;
  return (
    <article className="rounded-md border border-line p-4" aria-labelledby={id('title')}>
      <h2 id={id('title')} className="text-lg font-semibold">
        {p.title}
      </h2>
      <p className="text-sm text-fg-muted">
        {p.projectName} · {CATEGORY_LABELS[p.category]} · proposed by {p.proposer ?? 'an SME'} on {new Date(p.createdAt).toLocaleDateString()}
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline font-medium">Issuer: </dt><dd className="inline">{p.issuer ?? 'Not stated'}</dd></div>
        <div><dt className="inline font-medium">Version: </dt><dd className="inline">{p.versionLabel ?? 'Not stated'}</dd></div>
        <div><dt className="inline font-medium">In force: </dt><dd className="inline">{p.effectiveFrom ?? 'not stated'} to {p.effectiveTo ?? 'no end date'}</dd></div>
        <div><dt className="inline font-medium">Jurisdiction: </dt><dd className="inline">{p.jurisdiction ?? 'Not stated'}</dd></div>
        <div className="sm:col-span-2"><dt className="inline font-medium">Why the SME needs it: </dt><dd className="inline">{p.reason}</dd></div>
        <div className="sm:col-span-2 break-all text-xs text-fg-muted"><dt className="inline">File: </dt><dd className="inline">{p.fileName}, {Math.ceil(p.sizeBytes / 1024)} KB{p.pageCount ? `, ${p.pageCount} page(s)` : ''}, sha256 {p.sha256}</dd></div>
      </dl>
      {p.flags.length > 0 && (
        <div className="mt-3 rounded border border-warning p-3 text-sm" role="note">
          <p className="font-medium">Check before deciding (Praxis’s advice, not a decision)</p>
          <ul className="mt-1 list-disc pl-5">
            {p.flags.map((f) => (
              <li key={f.code}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <a className="text-link hover:underline" href={`/api/v1${base}/file`}>Download the original</a>
        {p.readable && (
          <button type="button" className="text-link hover:underline" onClick={() => void showText()}>
            Show Praxis’s reading{sensitive ? ' (redacted)' : ''}
          </button>
        )}
      </div>
      {text && (
        <ol className="mt-2 max-h-80 overflow-auto rounded border border-line p-3 text-xs">
          {text.map((page, i) => (
            <li key={i} className="mb-2">
              <p className="font-medium">Page {i + 1}</p>
              <pre className="whitespace-pre-wrap break-words">{page}</pre>
            </li>
          ))}
        </ol>
      )}
      <form className="mt-4 space-y-3 border-t border-line pt-3" onSubmit={(e) => void decide(e)}>
        <fieldset>
          <legend className="text-sm font-medium">Decision</legend>
          {DECISIONS.map((d) => (
            <label key={d.value} className="mt-1 flex items-start gap-2 text-sm">
              <input type="radio" name={id('decision')} value={d.value} checked={decision === d.value} onChange={() => setDecision(d.value)} />
              <span>
                {d.label} <span className="text-fg-muted">{d.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block text-sm">
          <span className="font-medium">What is this document?</span>
          <select className="mt-1 block rounded border border-line bg-surface p-1" value={qualification} onChange={(e) => setQualification(e.target.value as typeof qualification)}>
            {POLICY_QUALIFICATIONS.map((q) => (
              <option key={q} value={q}>
                {QUALIFICATION_LABELS[q]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Reason (the SME sees this)</span>
          <textarea className="mt-1 block w-full rounded border border-line bg-surface p-2" rows={2} required minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {acceptBlocked && <p className="text-sm text-warning">{p.readable ? 'Possible real data was found: return it so the SME can upload a synthetic copy.' : 'Praxis could not read this file: return it so the SME can upload a readable copy.'}</p>}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending || acceptBlocked || reason.trim().length < 5} className="rounded bg-primary px-3 py-1.5 text-sm text-on-primary disabled:opacity-50">
          {pending ? 'Recording…' : 'Record decision'}
        </button>
      </form>
    </article>
  );
}
