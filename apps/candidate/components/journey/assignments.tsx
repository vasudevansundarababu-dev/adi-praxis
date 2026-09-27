'use client';

import { useState } from 'react';
import { call } from '@/lib/client';
import type { AssignmentCard } from '@/lib/journey-types';

const STATUS: Record<AssignmentCard['status'], string> = {
  PROPOSED: 'Waiting for your reply',
  ACCEPTED: 'Accepted',
  HANDED_OFF: 'In progress',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CANCELED: 'Cancelled',
};

/** C08: proposals the expert accepts or declines. Declining is never held against anyone. */
export function Assignments({ initial, onboarded }: { initial: AssignmentCard[]; onboarded: boolean }) {
  const [items, setItems] = useState(initial);
  const open = items.filter((i) => ['PROPOSED', 'ACCEPTED', 'HANDED_OFF'].includes(i.status));
  const past = items.filter((i) => !open.includes(i));
  return (
    <section className="mt-8" aria-labelledby="assignments-h">
      <h2 id="assignments-h" className="font-semibold">Assignments</h2>
      {open.length === 0 && (
        <p className="mt-2 text-sm text-fg-muted">
          {onboarded
            ? 'No assignments right now. Once your onboarding is complete, we’ll send you a proposal when a project needs your expertise. We can’t promise when that will be.'
            : 'Assignments appear here once you are selected for a pool and have finished onboarding.'}
        </p>
      )}
      <ul className="mt-2 space-y-3">
        {open.map((a) => (
          <Card key={a.id} a={a} onChange={(n) => setItems(items.map((x) => (x.id === n.id ? n : x)))} />
        ))}
      </ul>
      {past.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-fg-muted">Past proposals ({past.length})</summary>
          <ul className="mt-2 space-y-1">
            {past.map((a) => (
              <li key={a.id}>
                {a.title} · <span className="text-fg-muted">{STATUS[a.status]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Card({ a, onChange }: { a: AssignmentCard; onChange: (a: AssignmentCard) => void }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const r = await call<AssignmentCard & { url?: string }>('POST', path, body);
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    return r.data!;
  }

  return (
    <li className="card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{a.title}</h3>
        <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-xs">{STATUS[a.status]}</span>
      </div>
      <dl className="mt-3 grid gap-1 sm:grid-cols-[9rem_1fr]">
        <dt className="text-fg-muted">Domain</dt>
        <dd>{[a.domain, a.specialty].filter(Boolean).join(' · ')}</dd>
        <dt className="text-fg-muted">Your role</dt>
        <dd>{a.contributionRoles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ') || '—'}</dd>
        {a.jurisdictions.length > 0 && (
          <>
            <dt className="text-fg-muted">Jurisdictions</dt>
            <dd>{a.jurisdictions.join(', ')}</dd>
          </>
        )}
        {a.expectedOutput && (
          <>
            <dt className="text-fg-muted">What you’ll produce</dt>
            <dd className="whitespace-pre-wrap">{a.expectedOutput}</dd>
          </>
        )}
        {a.effort && (
          <>
            <dt className="text-fg-muted">Effort</dt>
            <dd>{a.effort}</dd>
          </>
        )}
        {a.deadline && (
          <>
            <dt className="text-fg-muted">Deadline</dt>
            <dd>{new Date(a.deadline).toLocaleDateString(undefined, { timeZone: 'UTC' })}</dd>
          </>
        )}
        {a.compensation && (
          <>
            <dt className="text-fg-muted">Compensation</dt>
            <dd>{a.compensation}</dd>
          </>
        )}
        {a.confidentiality && (
          <>
            <dt className="text-fg-muted">Confidentiality</dt>
            <dd className="whitespace-pre-wrap">{a.confidentiality}</dd>
          </>
        )}
      </dl>
      {a.status === 'PROPOSED' && a.expiresAt && <p className="mt-3 text-xs text-fg-muted">Please reply by {new Date(a.expiresAt).toLocaleDateString()}.</p>}

      {a.status === 'PROPOSED' && !declining && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              const n = await post(`/me/assignments/${a.id}/accept`, { expectedRevision: a.revision });
              if (n) onChange(n);
            }}
            className="btn btn-primary disabled:opacity-60"
          >
            Accept
          </button>
          <button type="button" disabled={pending} onClick={() => setDeclining(true)} className="btn btn-secondary disabled:opacity-60">
            Decline
          </button>
        </div>
      )}
      {declining && (
        <form
          className="mt-4 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = await post(`/me/assignments/${a.id}/decline`, { reason: reason.trim() || undefined });
            if (n) onChange(n);
          }}
        >
          <label className="block">
            Reason (optional; it won’t count against you)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn btn-secondary disabled:opacity-60">
              Decline proposal
            </button>
            <button type="button" onClick={() => setDeclining(false)} className="text-link">
              Cancel
            </button>
          </div>
        </form>
      )}
      {(a.status === 'ACCEPTED' || a.status === 'HANDED_OFF') && (
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            const n = await post(`/me/assignments/${a.id}/open-workbench`, {});
            if (n?.url) window.location.assign(n.url);
          }}
          className="mt-4 btn btn-primary disabled:opacity-60"
        >
          Open workbench
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-error">{error}</p>}
    </li>
  );
}
