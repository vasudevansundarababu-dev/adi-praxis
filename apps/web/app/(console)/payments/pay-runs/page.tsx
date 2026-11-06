import type { Metadata } from 'next';
import Link from 'next/link';
import { BuildPayRunForm } from '@/components/payments/pay-run-actions';
import { type PayRunDto, totalsText } from '@/components/payments/types';
import { Empty, fmtDate, StatePill, SupplyOff, TD, TH } from '@/components/supply/ui';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Pay runs' };

const NEXT_STEP: Record<string, string> = {
  DRAFT: 'Admin releases',
  CONFIRMED: 'Admin releases',
  APPROVED: 'Ready to submit',
  SUBMITTED: 'Waiting for the provider',
  COMPLETED: 'Done',
  CANCELLED: '—',
};

/** Weekly pay runs (Monday to Monday): build → PM confirm → Finance approve → submit → provider → reconcile. */
export default async function PayRunsPage() {
  const { status, data } = await apiGet<{ items: PayRunDto[] }>('/pay-runs');
  if (status === 404) return <SupplyOff title="Pay runs" />;
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Pay runs</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        One run per week, built on Mondays for the previous Monday to Sunday. Admin releases it and submits it. Release sends no payment; submission is a separate action. Held and small balances carry into the next run.
      </p>
      <BuildPayRunForm />
      {items.length === 0 ? (
        <Empty>No pay runs yet.</Empty>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className={TH}>Week</th>
                <th className={TH}>Status</th>
                <th className={TH}>To pay</th>
                <th className={TH}>Held · carried</th>
                <th className={TH}>Next step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className={TD}>
                    <Link href={`/payments/pay-runs/${r.id}`} className="font-medium text-link hover:underline">
                      {fmtDate(r.periodStart)} – {fmtDate(new Date(new Date(r.periodEnd).getTime() - 86_400_000).toISOString())}
                    </Link>
                  </td>
                  <td className={TD}><StatePill state={r.status} /></td>
                  <td className={`${TD} tabular-nums`}>{totalsText(r.totals)}</td>
                  <td className={`${TD} tabular-nums`}>
                    {r.report?.held?.length ?? 0} · {r.report?.carried?.length ?? 0}
                  </td>
                  <td className={TD}>{NEXT_STEP[r.status] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
