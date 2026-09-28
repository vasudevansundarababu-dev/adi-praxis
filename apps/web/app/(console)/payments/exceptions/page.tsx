import type { Metadata } from 'next';
import { ExceptionsTable, ReconcileForm } from '@/components/payments/exceptions';
import type { PayoutExceptionDto } from '@/components/payments/types';
import { NoAccess } from '@/components/no-access';
import { FilterLinks, SupplyOff } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Payout exceptions' };

/** Daily reconciliation against the provider's settlement report; every mismatch is an exception for Finance. */
export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'FINANCE')) return <NoAccess need="Finance and Admins" />;
  const { status: s } = await searchParams;
  const filter = s === 'RESOLVED' || s === 'ALL' ? s : 'OPEN';
  const { status, data } = await apiGet<{ items: PayoutExceptionDto[] }>(`/payout-exceptions?status=${filter}`);
  if (status === 404) return <SupplyOff title="Payout exceptions" />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payout exceptions</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Reconciliation runs every day for the previous day. Any payment the provider reports that we do not know, any amount, currency or status that differs, and any payment we marked paid that is missing from the report becomes an exception. Resolve each with a note.
        </p>
      </div>
      <ReconcileForm />
      <FilterLinks
        label="Filter exceptions"
        current={filter}
        items={[
          { key: 'OPEN', href: '/payments/exceptions', label: 'Open' },
          { key: 'RESOLVED', href: '/payments/exceptions?status=RESOLVED', label: 'Resolved' },
          { key: 'ALL', href: '/payments/exceptions?status=ALL', label: 'All' },
        ]}
      />
      <ExceptionsTable items={data?.items ?? []} />
    </div>
  );
}
