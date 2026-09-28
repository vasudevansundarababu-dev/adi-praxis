import type { Metadata } from 'next';
import { RateCardForm } from '@/components/payments/rate-card-form';
import type { RateCardRow } from '@/components/supply/types';
import { Empty, fmtDate, SupplyOff, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Rate cards' };

const TASK = { AUTHORING: 'Authoring', ANNOTATION: 'Annotation', RL_REVIEW: 'RL review' } as const;

/** Versioned rate cards: never edited; a change is a new version of the same name. */
export default async function RateCardsPage() {
  const user = (await getCurrentUser())!;
  const canCreate = user.roles.some((r) => r === 'ADMIN' || r === 'FINANCE');
  const { status, data } = await apiGet<{ items: RateCardRow[] }>('/rate-cards');
  if (status === 404) return <SupplyOff title="Rate cards" />;
  const items = data?.items ?? [];
  const names = [...new Set(items.map((c) => c.name))];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Rate cards</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        What an SME earns per accepted task, in USD or INR. A rate card never changes: a new rate is a new version, and each earning records the version it was priced at. PMs link a version to each direct-pay requisition.
      </p>
      {items.length === 0 ? (
        <Empty>No rate cards yet.{canCreate ? ' Create the first one below.' : ' Finance creates them.'}</Empty>
      ) : (
        <div className="mt-6 space-y-4">
          {names.map((n) => (
            <section key={n} className="card overflow-x-auto">
              <h2 className="px-3 pt-3 font-semibold">{n}</h2>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="border-b border-line text-fg-muted">
                  <tr>
                    <th className={TH}>Version</th>
                    <th className={TH}>Currency</th>
                    <th className={TH}>Per task</th>
                    <th className={TH}>Hourly</th>
                    <th className={TH}>Weekly cap</th>
                    <th className={TH}>Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items
                    .filter((c) => c.name === n)
                    .map((c, i) => (
                      <tr key={c.id}>
                        <td className={TD}>
                          v{c.version} {i === 0 && <span className="pill pill-brand ml-1">Latest</span>}
                        </td>
                        <td className={TD}>{c.currency}</td>
                        <td className={`${TD} tabular-nums`}>
                          {Object.entries(c.perTask)
                            .map(([k, v]) => `${TASK[k as keyof typeof TASK] ?? k} ${v}`)
                            .join(' · ')}
                        </td>
                        <td className={`${TD} tabular-nums`}>{c.hourlyRate ?? '—'}</td>
                        <td className={`${TD} tabular-nums`}>{c.weeklyCap ?? '—'}</td>
                        <td className={TD}>{fmtDate(c.createdAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      {canCreate && <RateCardForm names={names} />}
    </div>
  );
}
