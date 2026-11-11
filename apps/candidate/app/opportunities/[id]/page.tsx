import { CONTRIBUTION_ROLE_LABELS, type PublicOpportunityDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StartProfileButton } from '@/components/start-profile';
import { api, getMe } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { data } = await api<PublicOpportunityDto>(`/opportunities/${(await params).id}`);
  return { title: { absolute: pageTitle(data?.brief.title ?? 'Opportunity') } };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children || (typeof children === 'string' && !children.trim())) return null;
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

/** C03 — SME opportunity. Readable before sign-in; requirements are shown before any commitment. */
export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ campaign?: string; start?: string }> }) {
  const { id } = await params;
  const { campaign, start } = await searchParams;
  const { data: o } = await api<PublicOpportunityDto>(`/opportunities/${id}`);
  if (!o) notFound();
  const me = await getMe();
  const b = o.brief;
  const required = o.criteria.filter((c) => c.kind === 'REQUIRED');
  const preferred = o.criteria.filter((c) => c.kind === 'PREFERRED');
  const campaignId = campaign && /^[0-9a-f-]{36}$/i.test(campaign) ? campaign : undefined;

  const apply =
    me?.applicationBlockReason ? <p role="status" className="mt-4 rounded-md border border-line p-3 text-sm">{me.applicationBlockReason}</p> : o.status === 'PUBLISHED' ? (
      <StartProfileButton opportunityId={o.id} campaignId={campaignId} signedIn={!!me} autoStart={start === '1'} />
    ) : (
      <p className="mt-4 rounded-md border border-line p-3 text-sm">This opportunity is closed to new applications.</p>
    );

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <Link href="/opportunities" className="text-sm text-link hover:underline">
        ← Opportunities
      </Link>
      <section className="hero p-6 sm:p-8">
        <div className="flex flex-wrap gap-2">
          <span className="pill">{b.domain}</span>
          {b.specialty && <span className="pill">{b.specialty}</span>}
          {b.jurisdictions.map((j) => <span key={j} className="pill">{j}</span>)}
          {b.languages.map((l) => <span key={l} className="pill">{l}</span>)}
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{b.title}</h1>
        <p className="muted mt-2">Contribution role: {b.contributionRoles.map((r) => CONTRIBUTION_ROLE_LABELS[r]).join(', ')}</p>
        {o.role === 'REVIEWER' && (
          <p className="mt-2 text-sm">
            This is an Expert reviewer role: you review tasks written by other experts before the project manager approves them. If you are selected, you get a reviewer
            account for the review console.
          </p>
        )}
        {b.compensation && <p className="mt-3 text-lg font-semibold">{b.compensation}</p>}
        {apply}
        <p className="muted mt-3 text-xs">A few short questions, most answered with a tap. Applying does not guarantee selection; a person makes every decision.</p>
      </section>

      <Section title="About this work">{b.summary}</Section>

      <section className="card p-5">
        <h2 className="font-semibold">What you’ll need</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          {required.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="pill pill-info shrink-0">Required</span>
              <span>
                {c.text}
                {c.evidence && <span className="text-fg-muted"> · evidence: {c.evidence}</span>}
                {c.equivalence && <span className="text-fg-muted"> (or: {c.equivalence})</span>}
              </span>
            </li>
          ))}
          {preferred.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="pill shrink-0">Preferred</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="Example outputs">{b.exampleOutputs}</Section>
        <Section title="Why these tasks matter">{b.whyLongHorizon}</Section>
        <Section title="Time commitment">{b.timeCommitment}</Section>
        <Section title="Complexity">{b.complexity}</Section>
        <Section title="Confidentiality and conflicts">{b.confidentiality}</Section>
        <Section title="Onboarding">{b.onboardingSteps}</Section>
      </div>
      <Section title="What we will ask">{b.whatWeWillAsk}</Section>
      <section className="card border-warning p-5">
        <h2 className="font-semibold text-warning">What not to share</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{b.doNotDisclose}</p>
      </section>
      <Section title="Full description">{b.fullDescription}</Section>
    </main>
  );
}
