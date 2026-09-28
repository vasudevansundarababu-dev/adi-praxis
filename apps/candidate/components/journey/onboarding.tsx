'use client';

import { canonicalTimeZone, CEFR_LEVELS, IANA_TIME_ZONES, ISO_COUNTRIES, ISO_LANGUAGES } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { call } from '@/lib/client';
import type { OnboardingItem, OnboardingView } from '@/lib/journey-types';
import { CERT_STATE, type CertState, type PayeeView } from '@/lib/supply-types';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';

export function Onboarding({ initial }: { initial: OnboardingView }) {
  const [view, setView] = useState(initial);
  const [open, setOpen] = useState<string | null>(initial.items.find((i) => !i.done)?.key ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const done = view.items.filter((i) => i.done).length;

  // Automatic items (certification, payment set-up) complete elsewhere; this re-reads the checklist.
  async function refresh() {
    setPending(true);
    setError(null);
    const r = await call<OnboardingView>('GET', `/me/onboarding?enrollmentId=${view.enrollmentId}`);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setView(r.data!);
  }

  async function acknowledge(item: OnboardingItem, data?: unknown) {
    setPending(true);
    setError(null);
    const r = await call<OnboardingView>('POST', '/me/onboarding/acknowledgements', { enrollmentId: view.enrollmentId, itemKey: item.key, ...(item.terms ? { termsHash: item.terms.sha256 } : {}), ...(data !== undefined ? { data } : {}) });
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      if (r.code === 'TERMS_CHANGED' || r.code === 'TERMS_PLACEHOLDER') {
        const fresh = await call<OnboardingView>('GET', `/me/onboarding?enrollmentId=${view.enrollmentId}`);
        if (fresh.data) setView(fresh.data);
      }
      return;
    }
    setView(r.data!);
    setOpen(r.data!.items.find((i) => !i.done)?.key ?? null);
  }

  return (
    <div>
      <Link href={`/enrollments/${view.enrollmentId}/status`} className="text-sm text-link hover:underline">
        ← Application status
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Onboarding</h1>
      <p className="mt-1 text-fg-muted">
        {done} of {view.items.length} done. You can stop and come back at any time.
      </p>
      <div className="mt-3 h-2 rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={view.items.length} aria-valuenow={done} aria-label="Onboarding progress">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${(done / view.items.length) * 100}%` }} />
      </div>
      {view.status === 'BLOCKED' && (
        <p role="status" className="mt-4 rounded-md border border-warning p-3 text-sm">
          {view.blockReason ?? 'Onboarding is paused.'} We’ll let you know when you can continue.
        </p>
      )}
      {view.status === 'COMPLETE' && (
        <p role="status" className="mt-4 rounded-md border border-success p-3 text-sm">
          You’re all set. When there’s suitable work we’ll send you a proposal, and it will appear on your{' '}
          <Link href="/home" className="text-link underline">
            home page
          </Link>
          . We can’t promise when that will be.
        </p>
      )}
      <ol className="mt-6 space-y-3">
        {view.items.map((item, n) => (
          <li key={item.key} className="rounded-lg border border-line">
            <button type="button" onClick={() => setOpen(open === item.key ? null : item.key)} aria-expanded={open === item.key} className="flex w-full items-center gap-3 p-4 text-left">
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${item.done ? 'bg-success text-on-primary' : 'border border-line'}`}>
                {item.done ? '✓' : n + 1}
              </span>
              <span className="font-medium">{item.title}</span>
              <span className="ml-auto text-sm text-fg-muted">{item.done ? 'Done' : item.kind === 'certification' || item.kind === 'payee' ? 'Completes automatically' : 'To do'}</span>
            </button>
            {open === item.key && (
              <div className="border-t border-line p-4 text-sm">
                <p className="text-fg-muted">{item.description}</p>
                <ItemBody item={item} scope={view.scope} pending={pending} onDone={(data) => acknowledge(item, data)} onRefresh={refresh} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}
    </div>
  );
}

function ItemBody({ item, scope, pending, onDone, onRefresh }: { item: OnboardingItem; scope: OnboardingView['scope']; pending: boolean; onDone: (data?: unknown) => void; onRefresh: () => void }) {
  switch (item.kind) {
    case 'certification':
      return <CertificationItem item={item} pending={pending} onRefresh={onRefresh} />;
    case 'payee':
      return <PayeeItem item={item} pending={pending} onRefresh={onRefresh} />;
    case 'confirm':
      return (
        <>
          {scope && (
            <dl className="mt-3 grid gap-1 sm:grid-cols-[9rem_1fr]">
              <dt className="text-fg-muted">Domain</dt>
              <dd>{[scope.domain, scope.specialty].filter(Boolean).join(' · ')}</dd>
              <dt className="text-fg-muted">Jurisdictions</dt>
              <dd>{scope.jurisdictions.join(', ') || '—'}</dd>
              <dt className="text-fg-muted">Languages</dt>
              <dd>{scope.languages.join(', ') || '—'}</dd>
              <dt className="text-fg-muted">Task roles</dt>
              <dd>{scope.contributionRoles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ')}</dd>
              {scope.expiresAt && (
                <>
                  <dt className="text-fg-muted">Review by</dt>
                  <dd>{new Date(scope.expiresAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}</dd>
                </>
              )}
            </dl>
          )}
          <Confirm pending={pending} label="This is correct" onClick={() => onDone()} />
        </>
      );
    case 'terms':
      return item.terms ? (
        <>
          <p className="mt-3 text-xs text-fg-muted">Version {item.terms.version}</p>
          <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-line p-3" tabIndex={0} aria-label={`${item.terms.title} text`}>
            {item.terms.body}
          </div>
          <Confirm pending={pending} label="I have read and accept these terms" onClick={() => onDone()} />
        </>
      ) : (
        <p className="mt-3">These terms are not available yet. Please check back later.</p>
      );
    case 'guidance':
      return (
        <>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>Each task describes a realistic workflow: its states and actions, what depends on what, and how things fail and recover.</li>
            <li>You write the rubric and the evidence a Validator needs to check your work.</li>
            <li>Use synthetic data only. Never include real customers, colleagues or employer information.</li>
            <li>Another expert reviews every task. You never approve your own.</li>
          </ul>
          <Confirm pending={pending} label="I understand" onClick={() => onDone()} />
        </>
      );
    case 'conflicts':
      return <ConflictsForm pending={pending} initial={item.data as { hasConflicts: boolean; details?: string } | null} onDone={onDone} />;
    case 'preferences':
      return <PreferencesForm pending={pending} initial={item.data as Prefs | null} onDone={onDone} />;
  }
}

/** M10: completes by itself when the certification is passed. The candidate follows the link; there is nothing to tick. */
function CertificationItem({ item, pending, onRefresh }: { item: OnboardingItem; pending: boolean; onRefresh: () => void }) {
  const data = item.data as { certificationId: string; state: CertState } | null;
  const state = data?.state;
  const [label, tone] = state ? CERT_STATE[state] : ['Opens when you start', ''];
  const href = !data ? '/certifications' : state === 'NOT_STARTED' || state === 'IN_TRAINING' ? `/certifications/${data.certificationId}` : `/certifications/${data.certificationId}/test`;
  const cta = item.done ? 'View certification' : !data || state === 'NOT_STARTED' ? 'Start the course' : state === 'IN_TRAINING' ? 'Continue the course' : state === 'TEST_READY' || state === 'RETAKE_AVAILABLE' ? 'Go to the test' : state === 'IN_TEST' ? 'Continue the test' : 'See where it stands';
  return (
    <>
      <p className="mt-3 flex flex-wrap items-center gap-2">
        Status: <span className={`pill ${tone}`}>{label}</span>
      </p>
      <p className="mt-2 text-fg-muted">This step ticks itself when you pass. You don’t need to confirm anything here.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href={href} className="btn btn-primary">
          {cta} →
        </Link>
        <button type="button" disabled={pending} onClick={onRefresh} className="text-link underline disabled:opacity-60">
          Check again
        </button>
      </div>
    </>
  );
}

const PAYEE_LABEL: Record<PayeeView['status'], [string, string]> = {
  NOT_REQUIRED: ['Not needed', ''],
  NOT_STARTED: ['Not started', ''],
  PENDING: ['Being checked by the payout provider', 'pill-info'],
  READY: ['Ready', 'pill-success'],
  BLOCKED: ['Blocked: contact support', 'pill-error'],
};

/** M10: completes by itself when the payout provider marks the account ready. */
function PayeeItem({ item, pending, onRefresh }: { item: OnboardingItem; pending: boolean; onRefresh: () => void }) {
  const status = ((item.data as { status?: PayeeView['status'] } | null)?.status ?? 'NOT_STARTED') as PayeeView['status'];
  const [label, tone] = PAYEE_LABEL[status] ?? [status, ''];
  return (
    <>
      <p className="mt-3 flex flex-wrap items-center gap-2">
        Status: <span className={`pill ${tone}`}>{label}</span>
      </p>
      <p className="mt-2 text-fg-muted">This step ticks itself when your payment account is ready. You don’t need to confirm anything here.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/payments" className="btn btn-primary">
          {item.done ? 'View payments' : status === 'NOT_STARTED' ? 'Set up payments' : 'Open payment set-up'} →
        </Link>
        <button type="button" disabled={pending} onClick={onRefresh} className="text-link underline disabled:opacity-60">
          Check again
        </button>
      </div>
    </>
  );
}

function Confirm({ pending, label, onClick }: { pending: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" disabled={pending} onClick={onClick} className="mt-4 btn btn-primary disabled:opacity-60">
      {label}
    </button>
  );
}

function ConflictsForm({ pending, initial, onDone }: { pending: boolean; initial: { hasConflicts: boolean; details?: string } | null; onDone: (d: unknown) => void }) {
  const [has, setHas] = useState<boolean | null>(initial?.hasConflicts ?? null);
  const [details, setDetails] = useState(initial?.details ?? '');
  const [authorized, setAuthorized] = useState(false);
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onDone({ hasConflicts: has, ...(has ? { details } : {}), authorizedToContribute: true });
      }}
    >
      <RequiredNote />
      <fieldset>
        <legend>
          Do you have a relevant employer or customer conflict for this work?
          <Req />
        </legend>
        <label className="mt-1 flex items-center gap-2">
          <input type="radio" name="has" required checked={has === false} onChange={() => setHas(false)} /> No
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="has" required checked={has === true} onChange={() => setHas(true)} /> Yes
        </label>
      </fieldset>
      {has && (
        <label className="block">
          Briefly describe it (no confidential details). Someone will review it before you are proposed for work.
          <Req />
          <textarea required value={details} onChange={(e) => setDetails(e.target.value)} rows={3} className={input} />
        </label>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" required checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-1" />
        <span>
          I will contribute only original material or material I am permitted to share, and no confidential employer or customer information.
          <Req />
        </span>
      </label>
      <button type="submit" disabled={pending || has === null || !authorized || (has && !details.trim())} className="btn btn-primary disabled:opacity-60">
        Save
      </button>
    </form>
  );
}

type Prefs = { country: string; languages: { language: string; level: string }[]; timezone: string; hoursPerWeek: number; emailNotifications: boolean };

function PreferencesForm({ pending, initial, onDone }: { pending: boolean; initial: Prefs | null; onDone: (d: unknown) => void }) {
  const [p, setP] = useState<Prefs>(
    initial
      ? { ...initial, timezone: canonicalTimeZone(initial.timezone) }
      : { country: '', languages: [{ language: 'en', level: 'C2' }], timezone: IANA_TIME_ZONES.includes(canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)) ? canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) : '', hoursPerWeek: 10, emailNotifications: true },
  );
  const setLang = (i: number, v: Partial<Prefs['languages'][number]>) => setP({ ...p, languages: p.languages.map((l, j) => (j === i ? { ...l, ...v } : l)) });
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(p);
      }}
    >
      <RequiredNote />
      <label className="block">
        Country you work from
        <Req />
        <select required value={p.country} onChange={(e) => setP({ ...p, country: e.target.value })} className={input}>
          <option value="">Choose…</option>
          {ISO_COUNTRIES.map(([c, name]) => (
            <option key={c} value={c}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend>
          Languages you can work in
          <Req />
        </legend>
        {p.languages.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Language {i + 1}</span>
              <select required value={l.language} onChange={(e) => setLang(i, { language: e.target.value })} className={input}>
                {ISO_LANGUAGES.map(([c, name]) => (
                  <option key={c} value={c}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Level for language {i + 1}</span>
              <select required value={l.level} onChange={(e) => setLang(i, { level: e.target.value })} className={input}>
                {CEFR_LEVELS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            {p.languages.length > 1 && (
              <button type="button" onClick={() => setP({ ...p, languages: p.languages.filter((_, j) => j !== i) })} className="pb-2 text-link">
                Remove
              </button>
            )}
          </div>
        ))}
        {p.languages.length < 10 && (
          <button type="button" onClick={() => setP({ ...p, languages: [...p.languages, { language: 'en', level: 'B2' }] })} className="text-link">
            Add a language
          </button>
        )}
      </fieldset>
      <label className="block">
        Time zone
        <Req />
        <select required value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} className={input}>
          <option value="">Choose…</option>
          {IANA_TIME_ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Hours a week you could give
        <Req />
        <input type="number" min={1} max={60} required value={p.hoursPerWeek} onChange={(e) => setP({ ...p, hoursPerWeek: Number(e.target.value) })} className={input} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={p.emailNotifications} onChange={(e) => setP({ ...p, emailNotifications: e.target.checked })} />
        Email me when there is a proposal for me
      </label>
      <p className="text-xs text-fg-muted">Used only to match you with suitable tasks.</p>
      <button type="submit" disabled={pending || !p.country || !p.timezone} className="btn btn-primary disabled:opacity-60">
        Save
      </button>
    </form>
  );
}
