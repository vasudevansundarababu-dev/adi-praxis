import type { Metadata } from 'next';
import { NoAccess } from '@/components/no-access';
import { ProposalReview, type ProposalRow } from '@/components/policy/proposal-review';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Policy proposals' };

/** Wave 3 (handover chapter 07): SME-proposed policy documents waiting for an Expert, PM or Admin decision. */
export default async function PolicyProposalQueue() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN' || r === 'PM')) return <NoAccess need="Validators, PMs and Admins" />;
  const { data } = await apiGet<{ items: ProposalRow[] }>('/review/policy-proposals');
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Policy proposals</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        Documents SMEs have proposed for your projects. Check that each is a real, relevant policy and contains no real customer data. Accepting adds it to the project’s documents; nothing becomes a rule until its rules are extracted, reviewed and published by the PM.
      </p>
      {items.length === 0 ? <p className="mt-6 text-fg-muted">No policy proposals are waiting.</p> : <div className="mt-6 space-y-4">{items.map((p) => <ProposalReview key={p.id} p={p} />)}</div>}
    </div>
  );
}
