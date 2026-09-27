import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RlReview, type RlReviewData } from '@/components/rl/rl-review';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'RL review' };

export default async function RlReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { data } = await apiGet<RlReviewData>(`/review/rl/${(await params).id}`);
  if (!data) notFound();
  return <RlReview data={data} />;
}
