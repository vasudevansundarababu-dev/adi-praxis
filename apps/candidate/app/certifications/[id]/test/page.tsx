import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TestFlow } from '@/components/cert/test-flow';
import { api, getMe } from '@/lib/api';
import type { CertificationCard, TestView } from '@/lib/supply-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Certification test') } };

/**
 * M10b test: a selfie re-check, then a timed test with autosave, then the result (pass or fail and a band per section,
 * never questions, answers or keys). The selfie provider sends the candidate back here with ?selfie=<ref>.
 */
export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ selfie?: string }> }) {
  const { id } = await params;
  const { selfie } = await searchParams;
  const here = `/certifications/${id}/test${selfie ? `?selfie=${encodeURIComponent(selfie)}` : ''}`;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(here)}`);
  const [list, test] = await Promise.all([api<{ items: CertificationCard[] }>('/me/certifications'), api<TestView>(`/me/certifications/${id}/test`)]);
  const cert = list.data?.items.find((c) => c.id === id);
  if (list.status === 404 || test.status === 404 || (list.data && !cert)) notFound();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/certifications" className="text-sm text-link hover:underline">
        ← Certifications
      </Link>
      {cert && test.data ? (
        <TestFlow cert={cert} initial={test.data} selfieParam={selfie && /^[\w-]{5,200}$/.test(selfie) ? selfie : null} />
      ) : (
        <p role="alert" className="card mt-3 p-5 text-sm text-error">We couldn’t load your test. Refresh the page to try again.</p>
      )}
    </main>
  );
}
