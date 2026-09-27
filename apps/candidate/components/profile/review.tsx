'use client';

import Link from 'next/link';
import { useState } from 'react';
import { correct, loadState, submitProfile } from '@/lib/profile-client';
import type { ConversationState } from '@/lib/profile-types';
import { ProfilePanel } from './profile-panel';

/** C05 — review profile and evidence, then an explicit submit. Saving never submits (CF-18). */
export function Review({ initial, identityLabel, identityEligible }: { initial: ConversationState; identityLabel: string; identityEligible: boolean }) {
  const [state, setState] = useState(initial);
  const [accuracy, setAccuracy] = useState(false);
  const [permission, setPermission] = useState(false);
  const [future, setFuture] = useState(false);
  const [error, setError] = useState<{ text: string; items?: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadPermission, setUploadPermission] = useState(false);
  const r = state.readiness;
  const submitted = !state.editable;

  async function upload(file: File) {
    const form = new FormData();
    form.append('permission', String(uploadPermission));
    form.append('file', file);
    setPending(true);
    const res = await fetch('/api/v1/me/evidence', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: form });
    setPending(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError({ text: body?.message ?? 'Upload failed' });
    const fresh = await loadState(state.enrollment.id);
    if (fresh.ok) setState(fresh.data);
  }
  async function removeEvidence(id: string) {
    const res = await fetch(`/api/v1/me/evidence/${id}`, { method: 'DELETE', headers: { 'idempotency-key': crypto.randomUUID() } });
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError({ text: body?.message ?? 'Could not remove the file' });
    const fresh = await loadState(state.enrollment.id);
    if (fresh.ok) setState(fresh.data);
  }
  async function attach(claimId: string, evidenceId: string) {
    const claim = state.profile.claims.find((c) => c.id === claimId)!;
    const res = await correct(state.enrollment.id, state.session!.revision, { claims: [{ action: 'EDIT', id: claimId, claim: { evidenceIds: [...new Set([...claim.evidenceIds, evidenceId])] } }] });
    if (res.ok) setState(res.data);
    else setError({ text: res.message });
  }
  async function submit() {
    setPending(true);
    setError(null);
    const res = await submitProfile(state.enrollment.id, { expectedRevision: state.session!.revision, confirmAccuracy: true, evidencePermission: true, futureOpportunities: future });
    setPending(false);
    if (res.ok) return setState(res.data);
    const d = res.details as { unconfirmed?: string[]; unanswered?: string[]; problems?: string[] } | undefined;
    setError({ text: res.message, items: [...(d?.unconfirmed ?? []).map((x) => `Confirm: ${x}`), ...(d?.problems ?? []), ...(d?.unanswered ?? []).map((x) => `Answer: ${x}`)] });
  }

  if (submitted) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Profile submitted</h1>
        <p className="mt-3">Thank you. Your profile for <strong>{state.enrollment.title}</strong> was submitted{state.enrollment.submittedAt ? ` on ${new Date(state.enrollment.submittedAt).toLocaleDateString()}` : ''}.</p>
        <p className="mt-2 text-fg-muted">A person reviews every application; software does not make the decision. We’ll let you know the outcome, and if we need more information we’ll ask a specific question.</p>
        <Link href="/home" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary">Back to home</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div>
        <Link href={`/enrollments/${state.enrollment.id}`} className="text-sm text-link hover:underline">← Back to the conversation</Link>
        <h1 className="mt-2 text-2xl font-semibold">Review your profile</h1>
        <p className="mt-1 text-sm text-fg-muted">For {state.enrollment.title} (requirements version {state.enrollment.version}). Your answers are saved as you go; nothing is sent for review until you submit.</p>

        <section className="mt-6 rounded-lg border border-line p-4">
          <h2 className="font-semibold">Before you submit</h2>
          {r.unconfirmed.length === 0 && r.unanswered.length === 0 && r.problems.length === 0 ? (
            <p className="mt-1 text-sm text-success">Everything is confirmed.</p>
          ) : (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {r.unconfirmed.map((x) => <li key={x}>Confirm or correct: {x}</li>)}
              {r.problems.map((x) => <li key={x}>{x}</li>)}
              {r.unanswered.map((x) => <li key={x}>Not answered yet: {x}</li>)}
            </ul>
          )}
          {r.requiredGaps.length > 0 && (
            <p className="mt-3 text-sm">
              You marked some requirements as not known or not disclosed: {r.requiredGaps.join('; ')}. You can still submit. The reviewer may ask for more information; this is not a rejection.
            </p>
          )}
          <p className="mt-3 text-sm">Identity: <strong>{identityLabel}</strong>{identityEligible ? '' : ' (finish verification before submitting; your profile stays saved)'}</p>
        </section>

        <section className="mt-6">
          <h2 className="font-semibold">Supporting evidence</h2>
          <p className="text-sm text-fg-muted">Only what supports your key claims: a redacted role letter, a public credential listing, and similar. Never share customer data, full payslips, ID documents or passwords. PDF, Word, PNG or JPG, up to 10 MB.</p>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={uploadPermission} onChange={(e) => setUploadPermission(e.target.checked)} className="mt-1" />
            I have permission to share these files for qualification review.
          </label>
          <input type="file" aria-label="Evidence file" disabled={!uploadPermission || pending} accept=".pdf,.docx,.png,.jpg,.jpeg" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="mt-2 text-sm" />
          <ul className="mt-3 space-y-2">
            {state.evidence.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-2 text-sm">
                <span>{x.filename}</span>
                <span className="text-xs text-fg-muted">{Math.ceil(x.sizeBytes / 1024)} KB · {x.scanStatus === 'CLEAN' ? 'checked' : x.scanStatus.toLowerCase()}</span>
                {state.profile.claims.length > 0 && (
                  <select aria-label={`Attach ${x.filename} to a credential`} defaultValue="" onChange={(e) => e.target.value && attach(e.target.value, x.id)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs">
                    <option value="">Attach to a credential…</option>
                    {state.profile.claims.map((c) => <option key={c.id} value={c.id}>{c.value}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => removeEvidence(x.id)} className="ml-auto text-xs text-link underline">Remove</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 space-y-2 rounded-lg border border-line p-4">
          <h2 className="font-semibold">Confirm and submit</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={accuracy} onChange={(e) => setAccuracy(e.target.checked)} className="mt-1" />
            The information in my profile is accurate to the best of my knowledge.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} className="mt-1" />
            ADI Praxis may use my answers and uploaded files to review my qualification for this opportunity.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={future} onChange={(e) => setFuture(e.target.checked)} className="mt-1" />
            Optional: you may consider my profile for future opportunities.
          </label>
          {error && (
            <div role="alert" className="rounded-md border border-error p-2 text-sm">
              <p className="text-error">{error.text}</p>
              {error.items && error.items.length > 0 && <ul className="mt-1 list-disc pl-5">{error.items.map((x) => <li key={x}>{x}</li>)}</ul>}
            </div>
          )}
          <button type="button" disabled={pending || !accuracy || !permission || !r.canSubmit || !identityEligible} onClick={submit} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">
            {pending ? 'Submitting…' : 'Confirm and submit'}
          </button>
        </section>
      </div>
      <aside aria-label="Your SME profile">
        <h2 className="mb-2 font-semibold">Your SME profile</h2>
        <ProfilePanel state={state} onChange={setState} />
      </aside>
    </div>
  );
}
