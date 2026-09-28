import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmtDate, StatePill } from '@/components/partner/labels';
import { partnerGet, type PartnerCandidate, type PartnerRequisition } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Requisition' };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-fg-muted uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export default async function PartnerRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: r }, { data: cands }] = await Promise.all([
    partnerGet<PartnerRequisition>(`/requisitions/${id}`),
    partnerGet<{ items: PartnerCandidate[] }>(`/candidates?requisitionId=${encodeURIComponent(id)}`),
  ]);
  if (!r) notFound();
  const mine = cands?.items ?? [];
  const req = r.minimumRequirements;
  const deadlinePassed = !!r.submissionDeadline && new Date(r.submissionDeadline) < new Date();
  const limitReached = !!r.maxPerPartner && mine.filter((c) => c.states.submission !== 'DUPLICATE').length >= r.maxPerPartner;
  const canSubmit = r.state === 'OPEN' && !deadlinePassed && !limitReached;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/partner/requisitions" className="text-sm text-link">
          ← Requisitions
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{r.title}</h1>
          <StatePill state={r.state} label={r.state.charAt(0) + r.state.slice(1).toLowerCase()} />
        </div>
        {r.summary && <p className="mt-2 max-w-3xl text-sm whitespace-pre-line text-fg-muted">{r.summary}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canSubmit ? (
          <Link href={`/partner/requisitions/${r.id}/submit`} className="btn btn-primary">
            Submit a candidate
          </Link>
        ) : (
          <p className="text-sm text-fg-muted">
            {r.state !== 'OPEN'
              ? 'This requisition is not accepting candidates right now.'
              : deadlinePassed
                ? 'The submission deadline has passed.'
                : `You have submitted the maximum of ${r.maxPerPartner} candidates for this requisition.`}
          </p>
        )}
        <Link href={`/partner/candidates?requisitionId=${r.id}`} className="btn btn-secondary">
          Your candidates ({mine.length})
        </Link>
      </div>

      <section aria-labelledby="role-h" className="card p-5">
        <h2 id="role-h" className="font-semibold">
          The role
        </h2>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
          <Fact label="Tier">{r.tierLabel}</Fact>
          <Fact label="Domain">
            <span className="capitalize">{r.domain}</span>
          </Fact>
          <Fact label="Headcount">{r.headcount}</Fact>
          <Fact label="Start date">{fmtDate(r.startDate)}</Fact>
          <Fact label="Duration">{r.durationWeeks ? `${r.durationWeeks} weeks` : '—'}</Fact>
          <Fact label="Hours per week">{r.hoursPerWeek ?? '—'}</Fact>
          <Fact label="Location">{r.location ?? 'Remote'}</Fact>
          <Fact label="Jurisdictions">{r.jurisdictions.length ? r.jurisdictions.join(', ') : '—'}</Fact>
          <Fact label="Languages">{r.languages.length ? r.languages.join(', ') : '—'}</Fact>
          <Fact label="Submission deadline">{fmtDate(r.submissionDeadline)}</Fact>
          <Fact label="Limit per partner">{r.maxPerPartner ?? 'No limit'}</Fact>
          <Fact label="Who pays the expert">{r.payRoute === 'VIA_PARTNER' ? 'You pay your people' : 'ADI Praxis pays the expert directly'}</Fact>
        </dl>
      </section>

      <section aria-labelledby="min-h" className="card p-5">
        <h2 id="min-h" className="font-semibold">
          Minimum requirements
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>{req.minYears > 0 ? `${req.minYears}+ years of relevant experience` : 'No minimum years of experience'}</li>
          {req.qualifications.map((q) => (
            <li key={q}>{q}</li>
          ))}
          {req.licenceRequired && <li>A professional licence is required. A Validator checks it before Expert certification.</li>}
        </ul>
        {req.notes && <p className="mt-3 text-sm whitespace-pre-line text-fg-muted">{req.notes}</p>}
        <p className="mt-3 text-xs text-fg-muted">
          Every submitted candidate is invited. The requirement screen is a recommendation only; a Validator decides whether a candidate does not meet the requirements.
        </p>
      </section>

      <section aria-labelledby="guide-h" className="card p-5">
        <h2 id="guide-h" className="font-semibold">
          Guidelines summary
        </h2>
        {r.guidelinesSummary ? (
          <>
            <p className="mt-1 text-sm text-fg-muted">
              {r.guidelinesSummary.name} · {r.guidelinesSummary.taskFamily} · version {r.guidelinesSummary.version}
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {r.guidelinesSummary.sections.map((s, i) => (
                <li key={`${i}-${s}`}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-fg-muted">Train your candidates on these topics before you submit them. You attest to this on the submit form.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">The guidelines summary is not published for this requisition yet.</p>
        )}
      </section>

      <section aria-labelledby="course-h" className="card p-5">
        <h2 id="course-h" className="font-semibold">
          Course outline
        </h2>
        {r.courseOutline ? (
          <>
            <p className="mt-1 text-sm text-fg-muted">
              {r.courseOutline.title} · {r.courseOutline.tierLabel} certification
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {r.courseOutline.modules.map((m) => (
                <li key={m.position}>{m.title}</li>
              ))}
            </ol>
            {r.courseOutline.test && (
              <p className="mt-3 text-sm">
                Certification test: {r.courseOutline.test.questions} questions in {r.courseOutline.test.timeLimitMinutes} minutes
                {r.courseOutline.test.authoringTask ? ', including one authoring task' : ''}.
              </p>
            )}
            <p className="mt-3 text-xs text-fg-muted">Test questions, answers and scoring rules are never shared with partners.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">The course outline is not published for this requisition yet.</p>
        )}
      </section>
    </div>
  );
}
