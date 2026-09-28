import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtDate, fmtMoney, fmtPeriod, StatePill } from '@/components/partner/labels';
import { partnerGet, type PartnerStatement } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Statements' };

export default async function PartnerStatementsPage() {
  const { data, status } = await partnerGet<{ items: PartnerStatement[] }>('/statements');
  const items = data?.items ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Statements</h1>
        <p className="mt-1 text-sm text-fg-muted">
          One statement per month, listing a fee for each of your candidates certified that month under your fee terms. A correction appears as a separate negative line. Payment
          is arranged outside the portal.
        </p>
      </div>
      {status !== 200 && (
        <p role="alert" className="text-sm text-error">
          Could not load statements. Refresh the page; if it keeps failing, contact your partner manager.
        </p>
      )}
      {status === 200 && items.length === 0 && <p className="card p-5 text-sm text-fg-muted">No statements yet. The first one is issued after the month in which one of your candidates is certified.</p>}
      {items.map((s) => {
        const totals = Object.entries(s.totals ?? {});
        return (
          <section key={s.id} aria-labelledby={`st-${s.id}`} className="card overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-3">
              <h2 id={`st-${s.id}`} className="font-semibold">
                {fmtPeriod(s.period)}
              </h2>
              <StatePill state={s.status} />
              <span className="text-sm text-fg-muted">Issued {fmtDate(s.issuedAt)}</span>
              <span className="ml-auto text-sm font-semibold tabular-nums">
                {totals.length ? totals.map(([cur, amt]) => fmtMoney(amt, cur)).join(' + ') : '—'}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-fg-muted">
                  <tr className="border-b border-hairline">
                    <th className="px-5 py-2 font-medium">Candidate ID</th>
                    <th className="px-5 py-2 font-medium">Your ref</th>
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="px-5 py-2 font-medium">Fee terms</th>
                    <th className="px-5 py-2 font-medium">Note</th>
                    <th className="px-5 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l, i) => (
                    <tr key={`${s.id}-${i}`} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-2 font-mono text-xs">
                        {l.candidateId ? (
                          <Link href={`/partner/candidates/${l.candidateId}`} className="text-link">
                            {l.candidateId}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-2">{l.partnerRef ?? '—'}</td>
                      <td className="px-5 py-2 whitespace-nowrap">{fmtDate(l.at)}</td>
                      <td className="px-5 py-2">{l.feeTermsVersion ?? '—'}</td>
                      <td className="px-5 py-2 text-fg-muted">{l.reverses ? `Correction${l.note ? `: ${l.note}` : ''}` : (l.note ?? '')}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{fmtMoney(l.amount, l.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                {totals.length > 0 && (
                  <tfoot>
                    {totals.map(([cur, amt]) => (
                      <tr key={cur} className="border-t border-hairline font-semibold">
                        <td className="px-5 py-2" colSpan={5}>
                          Total ({cur})
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">{fmtMoney(amt, cur)}</td>
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
