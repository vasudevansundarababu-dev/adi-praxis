import type { Metadata } from 'next';
import { NoAccess } from '@/components/no-access';
import { RequisitionForm } from '@/components/supply/requisition-form';
import type { PartnerRow, RequisitionDto } from '@/components/supply/types';
import { BackLink, NotFoundCard } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Edit requisition' };

export default async function EditRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'PM')) return <NoAccess need="Admins and PMs" />;
  const { id } = await params;
  const [r, partners] = await Promise.all([apiGet<RequisitionDto>(`/requisitions/${id}`), apiGet<{ items: PartnerRow[] }>('/partners')]);
  if (!r.data) return <NotFoundCard what="requisition" back="/requisitions" backLabel="Back to requisitions" />;
  return (
    <div className="max-w-3xl">
      <BackLink href={`/requisitions/${id}`}>{r.data.title}</BackLink>
      <h1 className="mt-2 text-2xl font-semibold">Edit requisition</h1>
      {r.data.state === 'OPEN' && <p className="mt-1 text-sm text-fg-muted">This requisition is open: saving tells every allowed partner about the change.</p>}
      <RequisitionForm projects={[{ id: r.data.projectId, name: r.data.projectName ?? 'This project' }]} partners={partners.data?.items ?? []} existing={r.data} />
    </div>
  );
}
