import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RequisitionApply } from '@/components/supply/requisition-apply';
import { api, getMe } from '@/lib/api';
import type { RequisitionView } from '@/lib/supply-types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { data } = await api<RequisitionView>(`/careers/requisitions/${(await params).id}`);
  return { title: { absolute: pageTitle(data?.title ?? 'Role') } };
}

/** M10a careers page: an open role that accepts direct applications. Readable before sign-in. */
export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: r } = await api<RequisitionView>(`/careers/requisitions/${id}`);
  if (!r) notFound();
  const me = await getMe();
  const req = r.minimumRequirements ?? {};
  const facts: [string, string][] = [
    ['Domain', r.domain],
    ['Level', r.tierLabel],
    ...(r.hoursPerWeek ? ([['Hours a week', String(r.hoursPerWeek)]] as [string, string][]) : []),
    ...(r.durationWeeks ? ([['Duration', `${r.durationWeeks} week${r.durationWeeks === 1 ? '' : 's'}`]] as [string, string][]) : []),
    ...(r.startDate ? ([['Starts', new Date(`${r.startDate}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })]] as [string, string][]) : []),
    ...(r.languages.length ? ([['Languages', r.languages.join(', ')]] as [string, string][]) : []),
    ...(r.jurisdictions.length ? ([['Jurisdictions', r.jurisdictions.join(', ')]] as [string, string][]) : []),
  ];
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <div className="flex flex-wrap gap-2">
          <span className="pill">{r.domain}</span>
          <span className="pill">{r.tierLabel}</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{r.title}</h1>
        {r.summary && <p className="muted mt-3 whitespace-pre-wrap">{r.summary}</p>}
        <p className="muted mt-4 text-xs">Applying does not guarantee selection; a person makes every decision.</p>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">About the role</h2>
        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {(req.minYears || req.qualifications?.length || req.licenceRequired || req.notes) && (
        <section className="card p-5">
          <h2 className="font-semibold">What you’ll need</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {!!req.minYears && <li>At least {req.minYears} year{req.minYears === 1 ? '' : 's'} of relevant experience</li>}
            {req.qualifications?.map((q) => <li key={q}>{q}</li>)}
            {req.licenceRequired && <li>A current professional licence (you upload it later, and a person checks it)</li>}
            {req.notes && <li className="whitespace-pre-wrap text-fg-muted">{req.notes}</li>}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">What happens next</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-fg-muted">
          <li>Tell us briefly about your experience.</li>
          <li>Verify your identity and build your SME profile.</li>
          <li>A person reviews your application.</li>
          <li>If you are selected, you take a short course on the guidelines and a certification test.</li>
        </ol>
      </section>

      {me ? (
        <RequisitionApply requisitionId={r.id} />
      ) : (
        <section className="card p-5">
          <h2 className="font-semibold">Apply for this role</h2>
          <p className="mt-1 text-sm text-fg-muted">Sign in with Google to apply. You come straight back here.</p>
          <Link href={`/sign-in?returnTo=${encodeURIComponent(`/careers/requisitions/${r.id}`)}`} className="mt-4 inline-block btn btn-primary">
            Sign in to apply →
          </Link>
        </section>
      )}
    </main>
  );
}
