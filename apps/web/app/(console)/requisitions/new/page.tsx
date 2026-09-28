import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { NoAccess } from '@/components/no-access';
import { RequisitionForm } from '@/components/supply/requisition-form';
import type { PartnerRow } from '@/components/supply/types';
import { BackLink, SupplyOff } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'New requisition' };

export default async function NewRequisitionPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'PM')) return <NoAccess need="Admins and PMs" />;
  const { projectId } = await searchParams;
  const [partners, projects] = await Promise.all([apiGet<{ items: PartnerRow[] }>('/partners'), apiGet<{ items: ProjectDto[] }>('/projects')]);
  if (partners.status === 404) return <SupplyOff title="New requisition" />;
  const open = (projects.data?.items ?? []).filter((p) => p.status !== 'CANCELLED' && p.status !== 'COMPLETED');
  return (
    <div className="max-w-3xl">
      <BackLink href="/requisitions">Requisitions</BackLink>
      <h1 className="mt-2 text-2xl font-semibold">New requisition</h1>
      <p className="mt-1 text-sm text-fg-muted">
        A requisition starts as a draft. Link its guidelines and rate card, then open it to the partners you allow and, if you like, the careers page.
      </p>
      <RequisitionForm projects={open.map((p) => ({ id: p.id, name: p.name }))} partners={partners.data?.items ?? []} initialProjectId={projectId} />
    </div>
  );
}
