import type { Metadata } from 'next';
import { EarningsTable, HoldForms, SmeLookup } from '@/components/payments/earnings';
import type { EarningDto } from '@/components/payments/types';
import { NoAccess } from '@/components/no-access';
import { SupplyOff } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Earnings and holds' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The append-only earnings ledger: look up an SME, reverse an entry (a new entry), place or release pay holds. */
export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ sme?: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'FINANCE')) return <NoAccess need="Finance and Admins" />;
  const { sme } = await searchParams;
  const smeUserId = sme && UUID.test(sme.trim()) ? sme.trim() : '';
  const { status, data } = await apiGet<{ items: EarningDto[] }>(`/earnings?limit=${smeUserId ? 500 : 50}${smeUserId ? `&smeUserId=${smeUserId}` : ''}`);
  if (status === 404) return <SupplyOff title="Earnings and holds" />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Earnings and holds</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Earnings are written once when a task is accepted, at the linked rate card’s price, and can never be edited. To correct one, reverse it: the reversal is a new entry. A hold keeps an SME’s payouts out of pay runs until Finance releases it.
        </p>
      </div>
      <SmeLookup initial={sme ?? ''} invalid={!!sme && !smeUserId} />
      <section>
        <h2 className="text-lg font-semibold">{smeUserId ? 'Earnings for this SME' : 'Latest earnings (all SMEs)'}</h2>
        <EarningsTable items={data?.items ?? []} />
      </section>
      <HoldForms smeUserId={smeUserId} />
    </div>
  );
}
