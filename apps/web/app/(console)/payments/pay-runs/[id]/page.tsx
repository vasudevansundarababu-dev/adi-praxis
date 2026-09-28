import type { Metadata } from 'next';
import { PayRunActions } from '@/components/payments/pay-run-actions';
import { type PayRunDto, type ReportLine, totalsText } from '@/components/payments/types';
import { BackLink, Facts, fmtDate, fmtDateTime, NotFoundCard, shortId, StatePill, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Pay run' };

function ReportTable({ rows, empty }: { rows: ReportLine[]; empty: string }) {
  if (!rows.length) return <p className="card mt-3 p-4 text-sm text-fg-muted">{empty}</p>;
  return (
    <div className="card mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-fg-muted">
          <tr>
            <th className={TH}>SME</th>
            <th className={TH}>Amount</th>
            <th className={TH}>Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={`${r.smeUserId}${r.currency}`}>
              <td className={`${TD} font-mono`}>{shortId(r.smeUserId)}</td>
              <td className={`${TD} tabular-nums`}>
                {r.currency} {r.amount}
              </td>
              <td className={TD}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PayRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  const { id } = await params;
  const { data: r } = await apiGet<PayRunDto>(`/pay-runs/${id}`);
  if (!r) return <NotFoundCard what="pay run" back="/payments/pay-runs" backLabel="Back to pay runs" />;
  const who = (uid: string | null) => (!uid ? '—' : uid === user.id ? 'you' : `user ${shortId(uid)}`);
  const approvals = r.approvals ?? [];
  const items = r.items ?? [];
  const payable = items.filter((i) => i.status !== 'HELD');
  const heldItems = items.filter((i) => i.status === 'HELD');
  const lastDay = new Date(new Date(r.periodEnd).getTime() - 86_400_000).toISOString();

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/payments/pay-runs">Pay runs</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            Week of {fmtDate(r.periodStart)} – {fmtDate(lastDay)}
          </h1>
          <StatePill state={r.status} />
        </div>
      </div>

      <Facts
        rows={[
          ['To pay', totalsText(r.totals)],
          ['Confirmed by (PM)', who(r.confirmedBy)],
          [
            'Finance approvals',
            approvals.length ? (
              <ul className="space-y-1">
                {approvals.map((a) => (
                  <li key={a.userId} className="flex flex-wrap items-center gap-2">
                    {who(a.userId)} · {fmtDateTime(a.at)}
                    {a.singleApprover && <span className="pill pill-warning">Single approver</span>}
                    {a.userId === r.confirmedBy && <span className="pill pill-warning">Same person as confirmer</span>}
                  </li>
                ))}
              </ul>
            ) : (
              'None yet'
            ),
          ],
          ['Submitted', r.submittedAt ? `${fmtDateTime(r.submittedAt)}${r.providerBatchRef ? ` · batch ${r.providerBatchRef}` : ''}` : '—'],
        ]}
      />
      {approvals.some((a) => a.singleApprover) && (
        <p className="text-sm text-fg-muted">A single Finance approval was enough for this run because no second-approver threshold is set. The audit log records it as a single-approver action.</p>
      )}

      <PayRunActions run={r} roles={user.roles} userId={user.id} />

      <section>
        <h2 className="text-lg font-semibold">Payments ({payable.length})</h2>
        {payable.length === 0 ? (
          <p className="card mt-3 p-4 text-sm text-fg-muted">Nobody is due a payment in this run.</p>
        ) : (
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-fg-muted">
                <tr>
                  <th className={TH}>SME</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Entries</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Provider reference</th>
                  <th className={TH}>Paid out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payable.map((i) => (
                  <tr key={i.id}>
                    <td className={`${TD} font-mono`}>{shortId(i.smeUserId)}</td>
                    <td className={`${TD} tabular-nums`}>
                      {i.currency} {i.amount}
                    </td>
                    <td className={`${TD} tabular-nums`}>{i.entries}</td>
                    <td className={TD}>
                      <StatePill state={i.status} />
                      {i.failureReason && <span className="mt-1 block text-xs text-error">{i.failureReason}</span>}
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{i.providerPaymentRef ?? '—'}</td>
                    <td className={`${TD} tabular-nums`}>{i.fx?.amount ? `${i.fx.currency ?? ''} ${i.fx.amount}${i.fx.rate ? ` @ ${i.fx.rate}` : ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Held ({heldItems.length})</h2>
        <p className="mt-1 text-sm text-fg-muted">Not submitted. Held amounts carry into the next run once the reason is cleared.</p>
        <ReportTable rows={heldItems.map((i) => ({ smeUserId: i.smeUserId, currency: i.currency, amount: i.amount, reason: i.holdReason ?? 'Held' }))} empty="Nothing is held in this run." />
      </section>

      <section>
        <h2 className="text-lg font-semibold">Carried forward ({r.report?.carried?.length ?? 0})</h2>
        <p className="mt-1 text-sm text-fg-muted">Balances under USD 10 or INR 500, or with nothing to pay, wait for the next run.</p>
        <ReportTable rows={r.report?.carried ?? []} empty="Nothing was carried forward." />
      </section>
    </div>
  );
}
