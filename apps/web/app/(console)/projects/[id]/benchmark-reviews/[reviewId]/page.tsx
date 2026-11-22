import type { BatchDetailDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BenchmarkReviewer } from '@/components/forge/benchmark-review';
import { apiGet } from '@/lib/api';
import { tabHref } from '@/lib/forge-console';

export const metadata: Metadata = { title: 'Benchmark review' };

/** New RL Gym part 3: one SME review batch, decided item by item (the project's Reviewers, its PM and Admins). */
export default async function BenchmarkReviewPage({ params }: { params: Promise<{ id: string; reviewId: string }> }) {
  const { id, reviewId } = await params;
  const res = await apiGet<BatchDetailDto>(`/projects/${id}/benchmark-reviews/${reviewId}`);
  if (!res.data) notFound();
  return (
    <div>
      <Link href={tabHref(id, 'benchmark')} className="text-sm text-link hover:underline">
        ← Benchmark review
      </Link>
      <h1 className="mt-2 mb-3 text-xl font-semibold">Review batch {res.data.batchId}</h1>
      <BenchmarkReviewer projectId={id} batch={res.data} />
    </div>
  );
}
