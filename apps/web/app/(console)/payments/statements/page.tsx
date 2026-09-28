import type { Metadata } from 'next';
import { BuildStatementsForm } from '@/components/payments/statements';
import { type StatementDto, totalsText } from '@/components/payments/types';
import { NoAccess } from '@/components/no-access';
import type { PartnerRow } from '@/components/supply/types';
import { Empty, fmtDate, shortId, StatePill, SupplyOff, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Partner statements' };

/** Monthly certified-candidate fee statements per partner. Invoices are paid outside Praxis. */
export default async function StatementsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'FINANCE')) return <NoAccess need="Finance and Admins" />;
  const [{ status, data }, partners] = await Promise.all([
    apiGet<{ items: StatementDto[] }>('/partner-statements'),
    user.roles.includes('ADMIN') ? apiGet<{ items: PartnerRow[] }>('/partners') : Promise.resolve({ status: 0, data: null }),
  ]);
  if (status === 404) return <SupplyOff title="Partner statements" />;
  const name = new Map((partners.data?.items ?? []).map((p) => [p.id, p.name]));
  const items = data?.items ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Partner statements</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Each certified candidate creates one fee entry for the partner who supplied them. Statements are built monthly and shown in the partner portal with the partner’s own candidate ids. Entries at zero with “NO_FEE_TERMS” mean the partner has no agreed fee yet.
        </p>
      </div>
      <BuildStatementsForm />
      {items.length === 0 ? (
        <Empty>No statements yet.</Empty>
      ) : (
        <ul className="space-y-4">
          {items.map((s) => (
            <li key={s.id} className="card p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-semibold">{name.get(s.partnerId) ?? `Partner ${shortId(s.partnerId)}`}</h2>
                <span className="text-fg-muted">{s.period}</span>
                <StatePill state={s.status} />
                <span className="ml-auto tabular-nums font-medium">{totalsText(s.totals)}</span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-link">
                  {s.lines.length} line{s.lines.length === 1 ? '' : 's'} · issued {fmtDate(s.issuedAt)}
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-line text-fg-muted">
                      <tr>
                        <th className={TH}>Candidate</th>
                        <th className={TH}>Partner ref</th>
                        <th className={TH}>Amount</th>
                        <th className={TH}>Terms</th>
                        <th className={TH}>Note</th>
                        <th className={TH}>Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {s.lines.map((l, i) => (
                        <tr key={i}>
                          <td className={`${TD} font-mono text-xs`}>{shortId(l.candidateId)}</td>
                          <td className={TD}>{l.partnerRef ?? '—'}</td>
                          <td className={`${TD} tabular-nums`}>
                            {l.currency} {l.amount}
                          </td>
                          <td className={TD}>{l.feeTermsVersion ?? '—'}</td>
                          <td className={TD}>{l.note ?? (l.reverses ? 'Reversal' : '—')}</td>
                          <td className={TD}>{fmtDate(l.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
