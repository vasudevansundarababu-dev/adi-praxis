import type { EarningsView } from '@/lib/supply-types';
import { fmtDate } from '@/lib/supply-types';

const money = (amount: string, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
};

const KIND: Record<EarningsView['entries'][number]['kind'], string> = { TASK: 'Accepted task', RL_REVIEW: 'RL review', HOURS: 'Hours', REVERSAL: 'Correction' };
const ENTRY_STATUS: Record<EarningsView['entries'][number]['status'], [string, string]> = { PAID: ['Paid', 'pill-success'], IN_PAYMENT: ['In payment', 'pill-info'], UNPAID: ['Not paid yet', ''] };
const PAYOUT_STATUS: Record<EarningsView['payouts'][number]['status'], [string, string]> = {
  PENDING: ['Scheduled', 'pill-info'],
  HELD: ['On hold', 'pill-warning'],
  SUBMITTED: ['Sent to the provider', 'pill-info'],
  PAID: ['Paid', 'pill-success'],
  FAILED: ['Failed: carried forward', 'pill-error'],
  RETURNED: ['Returned: carried forward', 'pill-error'],
};

/** Balances per currency, weekly payouts (with hold reasons and currency conversion) and the earning entries. */
export function Earnings({ data }: { data: EarningsView }) {
  const currencies = Object.entries(data.balance);
  return (
    <>
      <section aria-labelledby="bal-h">
        <h2 id="bal-h" className="text-lg font-semibold">
          Your earnings
        </h2>
        {currencies.length === 0 ? (
          <p className="card mt-3 p-4 text-sm text-fg-muted">No earnings yet. You earn for each task a person accepts; it appears here the same day.</p>
        ) : (
          <div className="mt-3 grid gap-4">
            {currencies.map(([cur, b]) => (
              <div key={cur} className="card p-5">
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {(
                    [
                      ['Earned', b.earned],
                      ['Paid', b.paid],
                      ['In payment', b.inPayment],
                      ['Not paid yet', b.unpaid],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-fg-muted">{k}</dt>
                      <dd className="mt-1 text-lg font-semibold">{money(v, cur)}</dd>
                    </div>
                  ))}
                </dl>
                {data.minimumPayout[cur] && (
                  <p className="mt-3 text-xs text-fg-muted">
                    We pay out once your unpaid balance reaches {money(data.minimumPayout[cur]!, cur)}; smaller amounts carry forward to the next week.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.payouts.length > 0 && (
        <section aria-labelledby="po-h">
          <h2 id="po-h" className="text-lg font-semibold">
            Payouts
          </h2>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th className="p-3 font-medium">Week of</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.payouts.map((p) => (
                  <tr key={p.id} className="border-t border-hairline align-top">
                    <td className="p-3">{fmtDate(`${p.week}T00:00:00Z`)}</td>
                    <td className="p-3 font-medium">{money(p.amount, p.currency)}</td>
                    <td className="p-3">
                      <span className={`pill ${PAYOUT_STATUS[p.status]?.[1] ?? ''}`}>{PAYOUT_STATUS[p.status]?.[0] ?? p.status}</span>
                    </td>
                    <td className="p-3 text-fg-muted">
                      {p.holdReason && <p>{p.holdReason}</p>}
                      {p.fx && p.fx.payoutCurrency !== p.currency && (
                        <p>
                          Paid as {money(p.fx.payoutAmount, p.fx.payoutCurrency)} (rate {p.fx.rate})
                        </p>
                      )}
                      {!p.holdReason && !(p.fx && p.fx.payoutCurrency !== p.currency) && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.entries.length > 0 && (
        <section aria-labelledby="en-h">
          <h2 id="en-h" className="text-lg font-semibold">
            Earning history
          </h2>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">For</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-hairline align-top">
                    <td className="p-3">{fmtDate(e.earnedAt)}</td>
                    <td className="p-3">
                      {KIND[e.kind] ?? e.kind}
                      {e.reason && <p className="text-xs text-fg-muted">{e.reason}</p>}
                    </td>
                    <td className="p-3 font-medium">{money(e.amount, e.currency)}</td>
                    <td className="p-3">
                      <span className={`pill ${ENTRY_STATUS[e.status][1]}`}>{ENTRY_STATUS[e.status][0]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
