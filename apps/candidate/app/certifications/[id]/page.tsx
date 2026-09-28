import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CoursePlayer } from '@/components/cert/course-player';
import { api, getMe } from '@/lib/api';
import type { CourseView } from '@/lib/supply-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Course') } };

/** M10b course player: modules open in order; each ends with a short quiz. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/certifications/${id}`)}`);
  const { status, data } = await api<CourseView>(`/me/certifications/${id}/course`);
  if (status === 404) notFound();
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/certifications" className="text-sm text-link hover:underline">
        ← Certifications
      </Link>
      {data ? (
        <CoursePlayer initial={data} />
      ) : (
        <section role="status" className="card mt-3 p-5">
          <h1 className="text-xl font-semibold">The course isn’t ready yet</h1>
          <p className="mt-2 text-sm text-fg-muted">{status === 409 ? 'The course for this certification is still being prepared. We’ll email you when it opens; you can also check back here later.' : 'We couldn’t load the course. Refresh the page to try again.'}</p>
        </section>
      )}
    </main>
  );
}
