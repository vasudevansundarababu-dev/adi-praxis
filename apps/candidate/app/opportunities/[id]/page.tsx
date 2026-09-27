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
    <section className="mt-6">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-1 whitespace-pre-wrap text-sm">{children}</div>
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/opportunities" className="text-sm text-link hover:underline">
        ← Opportunities
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{b.title}</h1>
      <p className="mt-1 text-fg-muted">
        {b.domain} · {b.specialty}
        {b.jurisdictions.length ? ` · ${b.jurisdictions.join(', ')}` : ''}
        {b.languages.length ? ` · ${b.languages.join(', ')}` : ''}
      </p>
      <p className="mt-2 text-sm">Contribution role: {b.contributionRoles.map((r) => CONTRIBUTION_ROLE_LABELS[r]).join(', ')}</p>

      <Section title="About this work">{b.summary}</Section>
      <Section title="Example outputs">{b.exampleOutputs}</Section>
      <Section title="Why these tasks matter">{b.whyLongHorizon}</Section>

      <section className="mt-6">
        <h2 className="font-semibold">Requirements</h2>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {required.map((c) => (
            <li key={c.id}>
              <span className="font-medium">Required:</span> {c.text}
              {c.evidence && <span className="text-fg-muted"> — evidence: {c.evidence}</span>}
              {c.equivalence && <span className="text-fg-muted"> (or: {c.equivalence})</span>}
            </li>
          ))}
          {preferred.map((c) => (
            <li key={c.id}>
              <span className="font-medium">Preferred:</span> {c.text}
            </li>
          ))}
        </ul>
      </section>

      <Section title="Time commitment">{b.timeCommitment}</Section>
      <Section title="Complexity">{b.complexity}</Section>
      {b.compensation && <Section title="Compensation">{b.compensation}</Section>}
      <Section title="Confidentiality and conflicts">{b.confidentiality}</Section>
      <Section title="Onboarding">{b.onboardingSteps}</Section>
      <Section title="What we will ask">{b.whatWeWillAsk}</Section>
      <section className="mt-6 rounded-md border border-warning p-4">
        <h2 className="font-semibold">What not to share</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">{b.doNotDisclose}</p>
      </section>
      <Section title="Full description">{b.fullDescription}</Section>

      <p className="mt-6 text-sm text-fg-muted">Applying does not guarantee selection or work. Selection is confirmed by a person, not by software.</p>

      {o.status === 'PUBLISHED' ? (
        <StartProfileButton opportunityId={o.id} campaignId={campaignId} signedIn={!!me} autoStart={start === '1'} />
      ) : (
        <p className="mt-6 rounded-md border border-line p-3 text-sm">This opportunity is closed to new applications.</p>
      )}
    </main>
  );
}
