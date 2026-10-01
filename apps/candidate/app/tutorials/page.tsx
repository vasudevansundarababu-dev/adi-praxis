import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';

export const metadata: Metadata = { title: { absolute: pageTitle('Tutorials') } };

/**
 * Tutorials for experts (docs/user-guide/VIDEOS.md): the captioned expert video and the expert guide. Public, so people
 * can see how the work goes before they apply. Files are in public/tutorials (built by e2e/demo-videos/package.mjs).
 */
export default function TutorialsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">ADI Praxis for subject-matter experts</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Tutorials</h1>
        <p className="muted mt-2 max-w-xl">See the whole journey in one short video, then keep the expert guide open while you work.</p>
      </section>
      <article className="card overflow-hidden">
        <video controls preload="metadata" src="/tutorials/07-expert-sme.mp4" aria-label="How experts work on ADI Praxis video" className="block aspect-[16/10] w-full bg-black" />
        <div className="space-y-1 p-5">
          <p className="muted font-mono text-xs">8:33 · captions, no sound</p>
          <h2 className="text-lg font-semibold">How experts work on ADI Praxis</h2>
          <p className="muted text-sm">
            Opening an invite, the identity check, the profile chat, onboarding, writing a KYC task with the AI interview, the course and certification test, and payment
            set-up.
          </p>
        </div>
      </article>
      <section aria-labelledby="guide-h" className="card flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 id="guide-h" className="text-lg font-semibold">
            Expert guide (PDF)
          </h2>
          <p className="muted mt-1 text-sm">Every step of the expert journey, with the exact labels you see on screen, and what to do if something does not work.</p>
        </div>
        <a href="/tutorials/ADI-Praxis-Expert-Guide.pdf" target="_blank" rel="noopener" className="btn btn-primary">
          Open the guide
        </a>
      </section>
      <p className="muted text-xs">The video uses synthetic data. In the test environment, sign-in, the identity and selfie checks and payouts are simulated.</p>
    </main>
  );
}
