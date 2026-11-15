import type { RecruiterPackDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecruiterPackPreview } from '@/components/projects/recruiter-pack';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Export to Recruiter' };

export default async function RecruiterPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: pack } = await apiGet<RecruiterPackDto>(`/projects/${id}/recruiter-pack`);
  if (!pack) notFound();
  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-link hover:underline">
        ← {pack.projectName}
      </Link>
      <RecruiterPackPreview pack={pack} />
    </div>
  );
}
