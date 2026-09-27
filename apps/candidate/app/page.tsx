import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Welcome') } };

export default async function LandingPage() {
  if (await getMe()) redirect('/home');
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
      <FullLogo />
      <div className="mt-10 max-w-md">
        <h1 className="text-xl font-semibold">Write the tasks that train tomorrow’s AI</h1>
        <p className="mt-3 text-fg-muted">
          ADI Praxis invites verified subject-matter experts to author realistic, synthetic tasks from real-world workflows.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/opportunities" className="btn btn-secondary">
            See opportunities
          </Link>
          <Link href="/sign-in" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </div>
      <div className="mt-12 h-1 w-40 rounded-full bg-brand-gradient" aria-hidden />
    </main>
  );
}
