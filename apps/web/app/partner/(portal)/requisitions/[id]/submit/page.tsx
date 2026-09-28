import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitCandidateForm } from '@/components/partner/submit-candidate-form';
import { partnerGet, type PartnerRequisition } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Submit a candidate' };

export default async function SubmitCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: r } = await partnerGet<PartnerRequisition>(`/requisitions/${id}`);
  if (!r) notFound();
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/partner/requisitions/${r.id}`} className="text-sm text-link">
          ← {r.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Submit a candidate</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {r.tierLabel} · <span className="capitalize">{r.domain}</span>
          {r.minimumRequirements.minYears > 0 ? ` · ${r.minimumRequirements.minYears}+ years` : ''}. Put forward only people who agreed to it and whom you trained on the guidelines
          summary.
        </p>
      </div>
      {r.state === 'OPEN' ? (
        <SubmitCandidateForm requisitionId={r.id} requisitionTitle={r.title} />
      ) : (
        <p className="card p-5 text-sm">This requisition is not accepting candidates right now. Go back to Requisitions to see what is open.</p>
      )}
    </div>
  );
}
