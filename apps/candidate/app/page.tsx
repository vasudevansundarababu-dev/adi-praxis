import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { FullLogo } from '@/components/brand';

// The root layout's title template doesn't apply to a page in the same segment, so set it in full.
export const metadata: Metadata = { title: { absolute: pageTitle('Welcome') } };

/**
 * Candidate landing (placeholder until M4). Google sign-in (C01), identity verification and the SME profile
 * arrive in M4; no sign-in button is shown until it works (FLOW2-SME CF-02).
 */
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <FullLogo />
      <div className="mt-10 max-w-md">
        <h1 className="text-xl font-semibold">Write the tasks that train tomorrow’s AI</h1>
        <p className="mt-3 text-fg-muted">
          ADI Praxis invites verified subject-matter experts to author realistic, synthetic tasks from real-world
          workflows.
        </p>
        <p className="mt-6 rounded-md border border-line px-4 py-3 text-sm text-fg-muted">
          Expert sign-in is not open yet. If you were sent an invitation, please check back soon.
        </p>
      </div>
      <div className="mt-12 h-1 w-40 rounded-full bg-brand-gradient" aria-hidden />
    </main>
  );
}
