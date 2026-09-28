import { REQUISITION_STATES } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess } from '@/components/no-access';
import type { RequisitionDto } from '@/components/supply/types';
import { Empty, FilterLinks, fmtDate, humanize, StatePill, SupplyOff, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Requisitions' };

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'PM' || r === 'REVIEWER')) return <NoAccess need="Admins, PMs and Validators" />;
  const canPlan = user.roles.some((r) => r === 'ADMIN' || r === 'PM');
  const { state } = await searchParams;
  const filter = (REQUISITION_STATES as readonly string[]).includes(state ?? '') ? state! : '';
  const { status, data } = await apiGet<{ items: RequisitionDto[] }>(`/requisitions${filter ? `?state=${filter}` : ''}`);
  if (status === 404) return <SupplyOff title="Requisitions" />;
  const items = data?.items ?? [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Requisitions</h1>
        {canPlan && (
          <Link href="/requisitions/new" className="btn btn-primary ml-auto">
            New requisition
          </Link>
        )}
      </div>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        What a project needs from partners and the careers page: tier, headcount, minimum requirements, guidelines and pay. Validators confirm any “requirements not met” recommendation.
      </p>
      <FilterLinks
        label="Filter requisitions"
        current={filter}
        items={[{ key: '', href: '/requisitions', label: 'All' }, ...REQUISITION_STATES.map((s) => ({ key: s, href: `/requisitions?state=${s}`, label: humanize(s) }))]}
      />
      {items.length === 0 ? (
        <Empty>{filter ? 'No requisitions in this state.' : canPlan ? 'No requisitions yet. Switch on SME supply for a project, then create one.' : 'No requisitions yet.'}</Empty>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className={TH}>Requisition</th>
                <th className={TH}>Tier</th>
                <th className={TH}>Headcount</th>
                <th className={TH}>State</th>
                <th className={TH}>Pay route</th>
                <th className={TH}>Submissions</th>
                <th className={TH}>Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className={TD}>
                    <Link href={`/requisitions/${r.id}`} className="font-medium text-link hover:underline">
                      {r.title}
                    </Link>
                    <span className="block text-xs text-fg-muted">
                      {r.projectName} · {r.domain}
                    </span>
                  </td>
                  <td className={TD}>{r.tierLabel}</td>
                  <td className={`${TD} tabular-nums`}>{r.headcount}</td>
                  <td className={TD}><StatePill state={r.state} /></td>
                  <td className={TD}>{r.payRoute === 'DIRECT' ? 'Direct' : 'Via partner'}</td>
                  <td className={`${TD} tabular-nums`}>{r.submissions ?? 0}</td>
                  <td className={TD}>{fmtDate(r.submissionDeadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
