import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OpportunityEditor, type OwnerView } from '@/components/opportunity/editor';
import { ReviewerApplicants, type ReviewerApplicant } from '@/components/opportunity/reviewer-applicants';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Opportunity page' };

/** Author post by default; SME -> Expert -> PM projects also have a reviewer post (owner, 12 Nov 2026). */
export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ role?: string }> }) {
  const { id } = await params;
  const role = (await searchParams).role === 'REVIEWER' ? 'REVIEWER' : 'AUTHOR';
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();
  const hasReviewerPost = project.reviewRoute === 'SME_EXPERT_PM' && !!project.reviewerJdSnapshot;
  if (role === 'REVIEWER' && !hasReviewerPost) notFound();
  const { data } = await apiGet<OwnerView>(`/projects/${id}/opportunity${role === 'REVIEWER' ? '?role=REVIEWER' : ''}`);
  if (!data) notFound();
  const applicants = role === 'REVIEWER' ? ((await apiGet<{ items: ReviewerApplicant[] }>(`/projects/${id}/reviewer-applicants`)).data?.items ?? []) : [];
  const candidateAppUrl = process.env.CANDIDATE_APP_URL ?? process.env.NEXT_PUBLIC_CANDIDATE_APP_URL ?? 'http://localhost:3101';
  return (
    <>
      {hasReviewerPost && (
        <nav aria-label="Job posts" className="mb-4 flex gap-2 text-sm">
          <Link href={`/projects/${id}/opportunity`} aria-current={role === 'AUTHOR' ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${role === 'AUTHOR' ? 'border-brand-blue font-medium' : 'border-line'}`}>
            Task authors
          </Link>
          <Link href={`/projects/${id}/opportunity?role=REVIEWER`} aria-current={role === 'REVIEWER' ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${role === 'REVIEWER' ? 'border-brand-blue font-medium' : 'border-line'}`}>
            Expert reviewers
          </Link>
        </nav>
      )}
      <OpportunityEditor key={role} initial={data} candidateAppUrl={candidateAppUrl} />
      {role === 'REVIEWER' && <ReviewerApplicants projectId={id} initial={applicants} />}
    </>
  );
}
