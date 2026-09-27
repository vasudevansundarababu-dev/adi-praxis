import { CONTRIBUTION_ROLE_LABELS, fieldLabel, type ContributionRole, type OpportunityCriteria, type ProfileData } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApplicationActions, ClaimReview } from '@/components/review/application-actions';
import { recommendationLabel, statusLabel } from '@/components/review/labels';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Application' };

export interface ApplicationDetail {
  id: string;
  status: string;
  candidate: { name: string | null; identityStatus: string };
  opportunity: { title: string; version: number; projectId: string; brief: { domain: string; specialty: string; jurisdictions: string[]; languages: string[]; contributionRoles: ContributionRole[] } };
  criteria: OpportunityCriteria;
  profile: ProfileData;
  durations: { domain: { years: number; months: number; approximate: boolean; overlapsMerged: boolean }; specialty: { years: number; months: number }; undated: string[] };
  profileVersion: { id: string; version: number; contentHash: string; submittedAt: string | null } | null;
  claims: { id: string; type: string; value: string; evidenceLevel: string; method: string | null; checkedAt: string | null; evidenceIds: string[] }[];
  evidence: { id: string; filename: string; mimeType: string; sizeBytes: number; scanStatus: string }[];
  assessment: { id: string; status: string; findings: { criterionId: string; result: string; citations: string[]; rationale: string }[] | null; limitations: string | null; errorCode: string | null; modelVersion: string | null; proposedScope: { contributionRoles?: string[]; unresolvedQuestions?: string[] } | null } | null;
  decisions: { outcome: string; reasons: { items: { criterionId: string | null; text: string }[]; candidateMessage: string }; decidedAt: string }[];
  reviewRequestReason: string | null;
}

const RESULT_STYLE: Record<string, string> = { MET: 'text-success', PARTIALLY_MET: 'text-warning', NOT_MET: 'text-error', UNKNOWN: 'text-fg-muted' };
const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '—'));
const years = (d: { years: number; months: number }) => (d.months ? `${d.years} years (${d.months} months)` : 'none dated');

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, data: a } = await apiGet<ApplicationDetail>(`/review/enrollments/${id}`);
  if (status === 403) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold">Application</h1>
        <p role="alert" className="mt-4 rounded-md border border-warning p-3 text-sm">You declared a conflict with this candidate. Another reviewer must decide this application.</p>
      </div>
    );
  }
  if (!a) notFound();
  const criterion = (cid: string) => a.criteria.find((c) => c.id === cid);
  const fields = Object.entries(a.profile.fields).filter(([, f]) => f.status !== 'PROPOSED');
  const findings = new Map((a.assessment?.findings ?? []).map((f) => [f.criterionId, f]));

  return (
    <div className="max-w-5xl">
      <Link href="/review/applications" className="text-sm text-link hover:underline">
        ← Applications
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{a.candidate.name ?? 'Unnamed candidate'}</h1>
        <span className="rounded-full border border-line px-2 py-0.5 text-sm">{statusLabel(a.status)}</span>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {a.opportunity.title} · requirements v{a.opportunity.version} · identity {a.candidate.identityStatus.toLowerCase().replace(/_/g, ' ')}
        {a.profileVersion && ` · profile v${a.profileVersion.version}`}
      </p>
      {a.reviewRequestReason && a.status === 'REVIEW_REQUESTED' && (
        <p className="mt-4 rounded-md border border-line p-3 text-sm">
          <span className="font-medium">Candidate’s review request: </span>
          {a.reviewRequestReason}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="criteria-h" className="card p-4">
            <h2 id="criteria-h" className="font-semibold">Criteria and assessment</h2>
            <p className="mt-1 text-xs text-fg-muted">
              Assessment: {recommendationLabel(a.assessment?.status ?? null)}
              {a.assessment?.modelVersion ? ` · ${a.assessment.modelVersion}` : ''}. A recommendation only; check the cited profile items.
            </p>
            {a.assessment?.status === 'ERROR' && (
              <p role="alert" className="mt-2 text-sm text-error">
                The assessment could not be used ({a.assessment.errorCode?.toLowerCase().replace(/_/g, ' ')}). Retry it, or review without a recommendation.
              </p>
            )}
            <ul className="mt-3 space-y-3 text-sm">
              {a.criteria.map((c) => {
                const f = findings.get(c.id);
                return (
                  <li key={c.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                    <div className="flex flex-wrap gap-2">
                      <span className="font-medium">{c.text}</span>
                      <span className="text-xs text-fg-muted">{c.kind.toLowerCase()}</span>
                      {f && <span className={`ml-auto text-xs font-semibold ${RESULT_STYLE[f.result] ?? ''}`}>{f.result.replace(/_/g, ' ').toLowerCase()}</span>}
                    </div>
                    {f && (
                      <p className="mt-1 text-fg-muted">
                        {f.rationale}
                        {f.citations.length > 0 && <span className="block text-xs">Cites: {f.citations.join(', ')}</span>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {a.assessment?.limitations && <p className="mt-3 text-xs text-fg-muted">Limitations: {a.assessment.limitations}</p>}
            {(a.assessment?.proposedScope?.unresolvedQuestions?.length ?? 0) > 0 && (
              <div className="mt-3 text-sm">
                <p className="font-medium">Suggested clarifications</p>
                <ul className="list-disc pl-5 text-fg-muted">
                  {a.assessment!.proposedScope!.unresolvedQuestions!.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="profile-h" className="card p-4">
            <h2 id="profile-h" className="font-semibold">Submitted profile</h2>
            <dl className="mt-3 divide-y divide-line text-sm">
              {fields.map(([k, f]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
                  <dt className="text-fg-muted">
                    {criterion(k.replace('criterion:', ''))?.text ?? fieldLabel(k, a.criteria)}
                    <span className="block text-xs">field:{k}</span>
                  </dt>
                  <dd>{f.status === 'CONFIRMED' ? fmt(f.value) : <span className="text-fg-muted">{f.status.toLowerCase()}</span>}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-4 text-sm font-semibold">Roles</h3>
            <p className="text-xs text-fg-muted">
              Domain experience {years(a.durations.domain)}{a.durations.domain.overlapsMerged ? ', overlaps merged' : ''}; specialty {years(a.durations.specialty)}.
              {a.durations.undated.length > 0 && ` Undated: ${a.durations.undated.join(', ')}.`}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {a.profile.roles.filter((r) => r.status === 'CONFIRMED').map((r) => (
                <li key={r.id}>
                  {r.title}
                  {r.employerType ? `, ${r.employerType}` : ''} · {r.start ?? '?'} to {r.end ?? 'now'}
                  {r.approximate ? ' (approx.)' : ''}
                  <span className="ml-2 text-xs text-fg-muted">role:{r.id}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="claims-h" className="card p-4">
            <h2 id="claims-h" className="font-semibold">Credentials and evidence</h2>
            {a.claims.length === 0 && <p className="mt-2 text-sm text-fg-muted">No credential claims.</p>}
            <ul className="mt-2 space-y-3">
              {a.claims.map((c) => (
                <ClaimReview key={c.id} enrollmentId={a.id} claim={c} />
              ))}
            </ul>
            {a.evidence.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {a.evidence.map((x) => (
                  <li key={x.id}>
                    {x.scanStatus === 'CLEAN' ? (
                      <a href={`/api/v1/review/evidence/${x.id}?enrollmentId=${a.id}`} className="text-link hover:underline">
                        {x.filename}
                      </a>
                    ) : (
                      <span>{x.filename}</span>
                    )}
                    <span className="ml-2 text-xs text-fg-muted">
                      {Math.ceil(x.sizeBytes / 1024)} KB · scan {x.scanStatus.toLowerCase()} · evidence:{x.id.slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-fg-muted">Opening a file is recorded in the audit log.</p>
          </section>

          {a.decisions.length > 0 && (
            <section aria-labelledby="history-h" className="card p-4">
              <h2 id="history-h" className="font-semibold">Decision history</h2>
              <ol className="mt-2 space-y-2 text-sm">
                {a.decisions.map((d) => (
                  <li key={d.decidedAt}>
                    <span className="font-medium">{statusLabel(d.outcome)}</span> · {new Date(d.decidedAt).toLocaleString()}
                    <span className="block text-fg-muted">{d.reasons.items.map((r) => r.text).join(' ')}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <ApplicationActions
          id={a.id}
          status={a.status}
          assessmentFailed={a.assessment?.status === 'ERROR'}
          criteria={a.criteria.map((c) => ({ id: c.id, text: c.text }))}
          defaultScope={{
            domain: a.opportunity.brief.domain,
            specialty: a.opportunity.brief.specialty,
            jurisdictions: a.opportunity.brief.jurisdictions,
            languages: a.opportunity.brief.languages,
            contributionRoles: a.opportunity.brief.contributionRoles,
          }}
          roleLabels={CONTRIBUTION_ROLE_LABELS}
        />
      </div>
    </div>
  );
}
