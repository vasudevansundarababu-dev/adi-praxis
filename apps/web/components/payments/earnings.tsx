'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import { fmtDate, humanize, shortId, TD, TH } from '@/components/supply/ui';
import type { EarningDto } from './types';

export function SmeLookup({ initial, invalid }: { initial: string; invalid: boolean }) {
  const router = useRouter();
  const [sme, setSme] = useState(initial);
  return (
    <form
      className="card flex flex-wrap items-end gap-3 p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(sme.trim() ? `/payments/earnings?sme=${encodeURIComponent(sme.trim())}` : '/payments/earnings');
      }}
    >
      <label className="block min-w-72 flex-1">
        SME id
        <input value={sme} onChange={(e) => setSme(e.target.value)} placeholder="The SME’s id, from a pay run or the candidate record" className={input} />
      </label>
      <button type="submit" className="btn btn-primary">
        Look up
      </button>
      {initial && (
        <button type="button" onClick={() => (setSme(''), router.push('/payments/earnings'))} className="btn btn-secondary">
          Show all
        </button>
      )}
      {invalid && (
        <p role="alert" className="w-full text-error">
          That is not a valid SME id. Copy the full id (36 characters) and try again.
        </p>
      )}
    </form>
  );
}

function ReverseButton({ e, reversed }: { e: EarningDto; reversed: boolean }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (e.kind === 'REVERSAL') return <span className="text-xs text-fg-muted">Reverses {shortId(e.reversesId)}</span>;
  if (reversed) return <span className="text-xs text-fg-muted">Reversed</span>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-link">
        Reverse…
      </button>
    );
  return (
    <div className="space-y-1">
      <input aria-label="Reason for reversal" aria-required="true" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Why (5+ characters)" className={input} />
      <div className="flex gap-2">
        <button type="button" disabled={a.pending || reason.trim().length < 5} onClick={() => a.run('POST', `/earnings/${e.id}/reverse`, { reason: reason.trim() })} className="btn btn-primary">
          Reverse
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
      <ActionMessages error={a.error} />
    </div>
  );
}

export function EarningsTable({ items }: { items: EarningDto[] }) {
  const reversed = new Set(items.filter((e) => e.reversesId).map((e) => e.reversesId!));
  if (!items.length) return <p className="card mt-3 p-4 text-sm text-fg-muted">No earnings found.</p>;
  return (
    <div className="card mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-fg-muted">
          <tr>
            <th className={TH}>Earned</th>
            <th className={TH}>SME</th>
            <th className={TH}>Kind</th>
            <th className={TH}>Amount</th>
            <th className={TH}>Source</th>
            <th className={TH}>Rate card</th>
            <th className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((e) => (
            <tr key={e.id}>
              <td className={TD}>{fmtDate(e.earnedAt)}</td>
              <td className={`${TD} font-mono text-xs`} title={e.smeUserId}>
                {shortId(e.smeUserId)}
              </td>
              <td className={TD}>{humanize(e.kind)}</td>
              <td className={`${TD} tabular-nums ${e.amount.startsWith('-') ? 'text-error' : ''}`}>
                {e.currency} {e.amount}
              </td>
              <td className={TD}>
                {e.sourceType ? `${e.sourceType === 'TaskInstance' ? 'Task' : e.sourceType} ${shortId(e.sourceId)}` : '—'}
                {e.reason && <span className="block text-xs text-fg-muted">{e.reason}</span>}
              </td>
              <td className={TD}>{e.rateCardVersion ? `v${e.rateCardVersion}` : '—'}</td>
              <td className={TD}>
                <ReverseButton e={e} reversed={reversed.has(e.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Place a dispute or fraud hold on an SME, or release one by its id. */
export function HoldForms({ smeUserId }: { smeUserId: string }) {
  const place = useAction();
  const release = useAction();
  const [sme, setSme] = useState(smeUserId);
  const [kind, setKind] = useState<'DISPUTE' | 'FRAUD'>('DISPUTE');
  const [reason, setReason] = useState('');
  const [holdId, setHoldId] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="card space-y-3 p-4 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await place.run<{ id: string }>('POST', '/pay-holds', { smeUserId: sme.trim(), kind, reason: reason.trim() });
          if (res.ok) {
            place.setNotice(`Hold placed. Its id is ${res.data!.id}; keep it to release the hold later.`);
            setReason('');
          }
        }}
      >
        <h2 className="font-semibold">Place a pay hold</h2>
        <RequiredNote />
        <label className="block">
          SME id<Req />
          <input required value={sme} onChange={(e) => setSme(e.target.value)} className={input} />
        </label>
        <label className="block">
          Kind<Req />
          <select required value={kind} onChange={(e) => setKind(e.target.value as 'DISPUTE' | 'FRAUD')} className={input}>
            <option value="DISPUTE">Dispute</option>
            <option value="FRAUD">Fraud flag</option>
          </select>
        </label>
        <label className="block">
          Reason<Req />
          <input required value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
        </label>
        <button type="submit" disabled={place.pending || reason.trim().length < 5 || !sme.trim()} className="btn btn-primary">
          Place hold
        </button>
        <ActionMessages error={place.error} notice={place.notice} />
      </form>
      <form
        className="card space-y-3 p-4 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await release.run('POST', `/pay-holds/${holdId.trim()}/release`, { note: note.trim() }, { success: 'Hold released. The SME’s balance goes into the next pay run.' });
          if (res.ok) {
            setHoldId('');
            setNote('');
          }
        }}
      >
        <h2 className="font-semibold">Release a pay hold</h2>
        <RequiredNote />
        <label className="block">
          Hold id<Req />
          <input required value={holdId} onChange={(e) => setHoldId(e.target.value)} className={input} />
        </label>
        <label className="block">
          Note (what was resolved)<Req />
          <input required value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </label>
        <button type="submit" disabled={release.pending || note.trim().length < 3 || !holdId.trim()} className="btn btn-primary">
          Release hold
        </button>
        <p className="text-xs text-fg-muted">Held pay runs show the reason for each hold in the “Held” list.</p>
        <ActionMessages error={release.error} notice={release.notice} />
      </form>
    </div>
  );
}
