'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, inputInline, useAction } from '@/components/supply/action';
import type { PayRunDto } from './types';

/** Build last week's run, or the week starting on a chosen Monday. */
export function BuildPayRunForm() {
  const router = useRouter();
  const a = useAction();
  const [monday, setMonday] = useState('');
  const isMonday = !monday || new Date(`${monday}T00:00:00Z`).getUTCDay() === 1;
  return (
    <form
      className="card mt-6 flex flex-wrap items-end gap-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run<PayRunDto>('POST', '/pay-runs', monday ? { periodStart: monday } : {}, { refresh: false });
        if (res.ok && res.data) router.push(`/payments/pay-runs/${res.data.id}`);
      }}
    >
      <label className="block">
        Week starting (Monday; blank = last week)
        <input type="date" value={monday} onChange={(e) => setMonday(e.target.value)} className={inputInline} />
      </label>
      <button type="submit" disabled={a.pending || !isMonday} className="btn btn-primary">
        Build pay run
      </button>
      {!isMonday && <span className="text-xs text-warning">Pick a Monday: pay-run weeks start on Monday.</span>}
      <div className="w-full">
        <ActionMessages error={a.error} problems={a.problems} />
      </div>
    </form>
  );
}

/**
 * Next step for a run, by role: a PM (or Admin) confirms; Finance approves (not a run that pays them) and submits;
 * Finance or an Admin cancels before submission.
 */
export function PayRunActions({ run: r, roles, userId }: { run: PayRunDto; roles: string[]; userId: string }) {
  const a = useAction();
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const has = (x: string) => roles.includes(x);
  const canConfirm = (has('PM') || has('ADMIN')) && r.status === 'DRAFT';
  const alreadyApproved = (r.approvals ?? []).some((x) => x.userId === userId);
  const canApprove = has('FINANCE') && r.status === 'CONFIRMED';
  const canSubmit = has('FINANCE') && r.status === 'APPROVED';
  const canCancel = (has('FINANCE') || has('ADMIN')) && ['DRAFT', 'CONFIRMED', 'APPROVED'].includes(r.status);
  const waiting =
    r.status === 'DRAFT' && !canConfirm ? 'Waiting for a PM to confirm.' : r.status === 'CONFIRMED' && !has('FINANCE') ? 'Waiting for Finance to approve.' : r.status === 'APPROVED' && !has('FINANCE') ? 'Waiting for Finance to submit.' : null;
  if (!canConfirm && !canApprove && !canSubmit && !canCancel) return waiting ? <p className="card p-4 text-sm text-fg-muted">{waiting}</p> : null;

  return (
    <section className="card space-y-3 p-4 text-sm" aria-label="Pay run actions">
      <div className="flex flex-wrap gap-2">
        {canConfirm && (
          <button type="button" disabled={a.pending} onClick={() => a.run('POST', `/pay-runs/${r.id}/confirm`, undefined, { success: 'Confirmed. Finance can now approve it.' })} className="btn btn-primary">
            Confirm pay run
          </button>
        )}
        {canApprove && (
          <button type="button" disabled={a.pending || alreadyApproved} onClick={() => a.run('POST', `/pay-runs/${r.id}/approve`, undefined, { success: 'Approval recorded.' })} className="btn btn-primary">
            {alreadyApproved ? 'You approved — a second approver is needed' : 'Approve pay run'}
          </button>
        )}
        {canSubmit && (
          <button type="button" disabled={a.pending} onClick={() => a.run('POST', `/pay-runs/${r.id}/submit`, undefined, { success: 'Submitted to the payout provider. Statuses update as the provider reports back.' })} className="btn btn-primary">
            Submit to payout provider
          </button>
        )}
        {canCancel && !cancelling && (
          <button type="button" onClick={() => setCancelling(true)} className="btn btn-secondary">
            Cancel run…
          </button>
        )}
      </div>
      {waiting && <p className="text-fg-muted">{waiting}</p>}
      {canApprove && <p className="text-xs text-fg-muted">You cannot approve a run that pays you. Approving checks this and says so.</p>}
      {canSubmit && <p className="text-xs text-fg-muted">Payees are checked again at submission; anyone no longer ready is held. A retried submit pays nobody twice.</p>}
      {cancelling && (
        <div className="space-y-2 border-t border-line pt-3">
          <RequiredNote />
          <label className="block">
            Why cancel? (kept in the audit log)<Req />
            <input aria-required="true" value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={a.pending || reason.trim().length < 5} onClick={() => a.run('POST', `/pay-runs/${r.id}/cancel`, { reason: reason.trim() }, { success: 'Pay run cancelled. You can build the week again.' })} className="btn btn-primary">
              Yes, cancel this run
            </button>
            <button type="button" onClick={() => setCancelling(false)} className="btn btn-secondary">
              Keep it
            </button>
          </div>
        </div>
      )}
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </section>
  );
}
