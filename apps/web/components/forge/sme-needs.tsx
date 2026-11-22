'use client';

import { NEED_KIND_LABEL, NEED_KINDS, type NeedDto, type NeedKind } from '@praxis/shared';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

const STATE: Record<NeedDto['state'], { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'pill-warning' },
  sent: { label: 'Sent to Studio', tone: 'pill-info' },
  rejected: { label: 'Rejected', tone: '' },
  resolved: { label: 'Resolved', tone: 'pill-success' },
};
const BY: Record<NeedDto['raisedBy'], string> = { AUTHOR: 'Author', REVIEWER: 'Reviewer', PM: 'PM' };
const Mono = ({ children }: { children: string }) => <code className="font-mono text-xs">{children}</code>;

/** Reject an open need, or mark a need resolved (lifts its export hold), with a reason. */
function CloseNeed({ projectId, need, onDone }: { projectId: string; need: NeedDto; onDone: (n: NeedDto) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (how: 'reject' | 'resolve') => {
    setError(null);
    const r = await mutate<NeedDto>('POST', `/projects/${projectId}/needs/${need.id}/${how}`, { reason });
    if (!r.ok) return setError(r.error);
    onDone(r.data!);
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <label className="text-xs">
        <span className="sr-only">Reason for {need.id}</span>
        <input className="rounded-md border border-line bg-surface px-2 py-1 text-sm" placeholder="Reason" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
      </label>
      {need.state === 'open' && (
        <button type="button" className="btn btn-secondary btn-sm disabled:opacity-60" disabled={!reason.trim()} onClick={() => void act('reject')}>
          Reject
        </button>
      )}
      <button type="button" className="btn btn-secondary btn-sm disabled:opacity-60" disabled={!reason.trim()} onClick={() => void act('resolve')}>
        Mark resolved
      </button>
      {error && (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The project's SME needs (new RL Gym part 4). Authors, Reviewers and the PM raise them; the PM ticks open needs of one
 * kind and sends them to Studio's next-version inbox as one item, or rejects them, or marks them resolved. A task with
 * an open or sent "New edge case" need is held back from export until it is resolved or rejected.
 */
export function SmeNeedsTab({ projectId, initial, connected }: { projectId: string; initial: NeedDto[]; connected: boolean }) {
  const [needs, setNeeds] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [summary, setSummary] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = needs.filter((n) => selected.has(n.id));
  const kinds = new Set(chosen.map((n) => n.kind));
  const replace = (updated: NeedDto[]) => setNeeds((all) => all.map((n) => updated.find((u) => u.id === n.id) ?? n));

  async function send() {
    setPending(true);
    setError(null);
    const r = await mutate<{ items: NeedDto[] }>('POST', `/projects/${projectId}/needs/send`, { needIds: chosen.map((n) => n.id), summary, ...(neededBy ? { neededBy } : {}) });
    setPending(false);
    if (!r.ok) return setError(r.error);
    replace(r.data!.items);
    setSelected(new Set());
    setSummary('');
    setNeededBy('');
  }

  return (
    <section aria-label="SME needs">
      <p className="mb-4 max-w-3xl text-sm text-fg-muted">
        Needs raised by authors, Reviewers and you: more data, or a new kind of case. Send open needs of one kind to Studio as one request, reject them, or mark them resolved. A task waiting for a new kind of case
        is not exported until its need is resolved or rejected.
      </p>
      {!connected && (
        <p className="card mb-4 p-4 text-sm" data-studio-not-connected>
          Studio isn’t connected yet, so needs can be collected but not sent.
        </p>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline">
            <tr>
              <th className="w-10 px-4 py-2.5 text-xs font-semibold text-fg-muted">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">Need</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">From</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {needs.map((n) => (
              <tr key={n.id} data-need={n.id}>
                <td className="px-4 py-3 align-top">
                  {n.state === 'open' && (
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      aria-label={`Select the need: ${n.note.slice(0, 60)}`}
                      checked={selected.has(n.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(n.id);
                          else next.delete(n.id);
                          return next;
                        })
                      }
                    />
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="font-medium">{NEED_KIND_LABEL[n.kind]}</span>
                  {n.taskId && <span className="ml-2 text-xs text-fg-muted">task {n.taskId.slice(0, 8)}</span>}
                  <p className="mt-0.5">{n.note}</p>
                  {n.lastError && (
                    <p className="mt-0.5 text-xs text-error">
                      Last send failed: <Mono>{n.lastError.code}</Mono> {n.lastError.message}
                    </p>
                  )}
                  {n.closedReason && <p className="mt-0.5 text-xs text-fg-muted">{n.closedReason}</p>}
                  {(n.state === 'open' || n.state === 'sent') && <CloseNeed projectId={projectId} need={n} onDone={(u) => replace([u])} />}
                </td>
                <td className="px-4 py-3 align-top">
                  {BY[n.raisedBy]}
                  {n.raisedByName ? ` · ${n.raisedByName}` : ''}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className={`pill ${STATE[n.state].tone}`}>{STATE[n.state].label}</span>
                  {n.studioItemId && (
                    <div className="mt-1 text-xs">
                      Studio item <Mono>{n.studioItemId}</Mono>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {needs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-fg-muted">
                  No needs raised yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card mt-4 p-4 text-sm" aria-label="Send to Studio">
        <h3 className="font-semibold">Send to Studio</h3>
        <p className="mt-1 text-fg-muted">
          {chosen.length} selected{kinds.size === 1 ? ` · ${NEED_KIND_LABEL[[...kinds][0] as NeedKind]}` : ''}. Studio gets one request with each need as evidence; no names are sent.
        </p>
        {kinds.size > 1 && <p className="mt-1 text-error">Pick needs of one kind: {NEED_KINDS.map((k) => NEED_KIND_LABEL[k]).join(' and ')} go to Studio separately.</p>}
        <label className="mt-2 block">
          <span className="block font-medium">Summary for Studio</span>
          <textarea className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" rows={2} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label className="mt-2 block">
          <span className="block font-medium">Needed by (optional)</span>
          <input type="date" className="mt-1 rounded-md border border-line bg-surface px-2 py-1" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary mt-3 disabled:opacity-60" disabled={pending || !connected || chosen.length === 0 || kinds.size !== 1 || !summary.trim()} onClick={() => void send()}>
          Send to Studio
        </button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** Benchmark review: raise a need from one review item (it goes to the PM's SME needs list). */
export function RaiseNeed({ projectId, taskId, source }: { projectId: string; taskId: string | null; source: { batchId: string; itemId: string } }) {
  const [kind, setKind] = useState<NeedKind>('more_data');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p className="mt-2 text-xs text-fg-muted">Need sent to the PM’s SME needs list.</p>;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-link">Raise a need</summary>
      <form
        className="mt-2 grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const r = await mutate('POST', `/projects/${projectId}/needs`, { kind, note, source, ...(taskId ? { taskId } : {}) });
          if (!r.ok) return setError(r.error);
          setDone(true);
        }}
      >
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Kind of need</legend>
          {NEED_KINDS.map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <input type="radio" name={`need-${source.itemId}`} value={k} checked={kind === k} onChange={() => setKind(k)} />
              {NEED_KIND_LABEL[k]}
            </label>
          ))}
        </fieldset>
        <label>
          <span className="sr-only">What is needed</span>
          <textarea className="w-full rounded-md border border-line bg-surface px-2 py-1" rows={2} placeholder="What is needed" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} required />
        </label>
        <div>
          <button type="submit" className="btn btn-secondary btn-sm disabled:opacity-60" disabled={!note.trim()}>
            Send to PM
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
