import { TIER_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess } from '@/components/no-access';
import { NewPartnerForm } from '@/components/supply/partner-forms';
import type { PartnerRow } from '@/components/supply/types';
import { Empty, StatePill, SupplyOff, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Partners' };

/** Staffing partners who supply candidates (docs/SME-SUPPLY.md section 5). Admins onboard them. */
export default async function PartnersPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'PM')) return <NoAccess need="Admins and PMs" />;
  const isAdmin = user.roles.includes('ADMIN');
  const { status, data } = await apiGet<{ items: PartnerRow[] }>('/partners');
  if (status === 404) return <SupplyOff title="Partners" />;
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Partners</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        Staffing partners put candidates forward through the Partner API or the partner portal. Every candidate still goes through sign-in, identity, selection and certification in Praxis.
      </p>
      {items.length === 0 ? (
        <Empty>No partners yet.{isAdmin ? ' Add the first one below.' : ' An Admin onboards partners.'}</Empty>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className={TH}>Partner</th>
                <th className={TH}>Status</th>
                <th className={TH}>Business check</th>
                <th className={TH}>Domains and tiers</th>
                <th className={TH}>Users · API clients</th>
                <th className={TH}>Submissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className={TD}>
                    {isAdmin ? (
                      <Link href={`/partners/${p.id}`} className="font-medium text-link hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                    <span className="block text-xs text-fg-muted">Fee terms: {p.feeTermsVersion ?? 'not agreed'}</span>
                  </td>
                  <td className={TD}><StatePill state={p.status} /></td>
                  <td className={TD}><StatePill state={p.businessVerification} /></td>
                  <td className={TD}>
                    {p.allowedDomains.join(', ') || 'Any domain'}
                    <span className="block text-xs text-fg-muted">{p.allowedTiers.map((t) => TIER_LABELS[t]).join(', ') || 'Any tier'}</span>
                  </td>
                  <td className={`${TD} tabular-nums`}>{p.users ?? 0} · {p.clients ?? 0}</td>
                  <td className={`${TD} tabular-nums`}>{p.submissions ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && <NewPartnerForm />}
    </div>
  );
}
