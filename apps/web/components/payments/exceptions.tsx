'use client';

import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, inputInline, useAction } from '@/components/supply/action';
import { humanize, StatePill, TD, TH } from '@/components/supply/ui';
import type { PayoutExceptionDto } from './types';

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** Run reconciliation for one UTC day on demand (the daily job does the previous day automatically). */
export function ReconcileForm() {
  const a = useAction();
  const [date, setDate] = useState(yesterday());
  const [result, setResult] = useState<{ day: string; lines: number; mismatches: { kind: string; paymentRef: string }[]; created?: number } | null>(null);
  return (
    <form
      className="card flex flex-wrap items-end gap-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setResult(null);
        const res = await a.run<NonNullable<typeof result>>('POST', '/payout-reconciliation', { date });
        if (res.ok) setResult(res.data);
      }}
    >
      <RequiredNote className="w-full" />
      <label className="block">
        Reconcile the day (UTC)<Req />
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputInline} />
      </label>
      <button type="submit" disabled={a.pending} className="btn btn-primary">
        {a.pending ? 'Reconciling…' : 'Run reconciliation'}
      </button>
      {result && (
        <div role="status" className="w-full">
          <p>
            {result.day}: {result.lines} line{result.lines === 1 ? '' : 's'} in the provider’s report, {result.mismatches.length} mismatch{result.mismatches.length === 1 ? '' : 'es'}
            {result.created !== undefined ? `, ${result.created} new exception${result.created === 1 ? '' : 's'}` : ''}.
          </p>
          {result.mismatches.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-fg-muted">
              {result.mismatches.map((m) => (
                <li key={`${m.kind}${m.paymentRef}`}>
                  {humanize(m.kind)} · <span className="font-mono">{m.paymentRef}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="w-full">
        <ActionMessages error={a.error} />
      </div>
    </form>
  );
}

function Resolve({ id }: { id: string }) {
  const a = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="space-y-1">
      <input aria-label="Resolution note" aria-required="true" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you found and did" className={input} />
      <button type="button" disabled={a.pending || note.trim().length < 5} onClick={() => a.run('POST', `/payout-exceptions/${id}/resolve`, { note: note.trim() })} className="btn btn-secondary">
        Resolve
      </button>
      <ActionMessages error={a.error} />
    </div>
  );
}

export function ExceptionsTable({ items }: { items: PayoutExceptionDto[] }) {
  if (!items.length) return <p className="card p-4 text-sm text-fg-muted">No exceptions here.</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-fg-muted">
          <tr>
            <th className={TH}>Report date</th>
            <th className={TH}>Kind</th>
            <th className={TH}>Payment</th>
            <th className={TH}>Detail</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((x) => (
            <tr key={x.id}>
              <td className={TD}>{x.reportDate}</td>
              <td className={TD}>{humanize(x.kind)}</td>
              <td className={`${TD} font-mono text-xs`}>{x.paymentRef ?? '—'}</td>
              <td className={TD}>
                <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs text-fg-muted">{x.detail ? JSON.stringify(x.detail, null, 1) : '—'}</pre>
              </td>
              <td className={`${TD} min-w-56`}>
                <StatePill state={x.status} />
                {x.status === 'OPEN' ? <div className="mt-2"><Resolve id={x.id} /></div> : x.note && <p className="mt-1 text-xs text-fg-muted">{x.note}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
