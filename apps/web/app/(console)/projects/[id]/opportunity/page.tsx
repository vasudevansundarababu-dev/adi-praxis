import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OpportunityEditor, type OwnerView } from '@/components/opportunity/editor';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Opportunity page' };

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await apiGet<OwnerView>(`/projects/${id}/opportunity`);
  if (!data) notFound();
  return <OpportunityEditor initial={data} candidateAppUrl={process.env.NEXT_PUBLIC_CANDIDATE_APP_URL ?? 'http://localhost:3101'} />;
}
