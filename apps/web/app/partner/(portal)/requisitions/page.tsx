import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtDate, StatePill } from '@/components/partner/labels';
import { partnerGet, type PartnerRequisition } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Requisitions' };

export default async function PartnerRequisitionsPage() {
  const { data, status } = await partnerGet<{ items: PartnerRequisition[] }>('/requisitions');
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Requisitions</h1>
      <p className="mt-1 text-sm text-fg-muted">Roles ADI Praxis has opened to you. Open a requisition to read its requirements and submit a candidate.</p>
      {status !== 200 && (
        <p role="alert" className="mt-4 text-sm text-error">
          Could not load requisitions. Refresh the page; if it keeps failing, contact your partner manager.
        </p>
      )}
      {status === 200 && items.length === 0 && <p className="mt-6 card p-5 text-sm text-fg-muted">No requisitions are open to you right now. You will see them here as soon as they open.</p>}
      {items.length > 0 && (
        <div className="mt-6 card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-fg-muted">
              <tr className="border-b border-hairline">
                <th className="px-4 py-2 font-medium">Requisition</th>
                <th className="px-4 py-2 font-medium">Tier</th>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Headcount</th>
                <th className="px-4 py-2 font-medium">You submitted</th>
                <th className="px-4 py-2 font-medium">Deadline</th>
                <th className="px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/partner/requisitions/${r.id}`} className="font-medium text-link">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.tierLabel}</td>
                  <td className="px-4 py-2 capitalize">{r.domain}</td>
                  <td className="px-4 py-2 tabular-nums">{r.headcount}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.submitted ?? 0}
                    {r.maxPerPartner ? ` of ${r.maxPerPartner}` : ''}
                  </td>
                  <td className="px-4 py-2">{fmtDate(r.submissionDeadline)}</td>
                  <td className="px-4 py-2">
                    <StatePill state={r.state} label={r.state === 'OPEN' ? 'Open' : r.state === 'PAUSED' ? 'Paused' : 'Filled'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
