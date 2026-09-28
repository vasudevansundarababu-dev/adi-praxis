import { TIER_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess } from '@/components/no-access';
import { LinkGuidelines, LinkRateCard, RequisitionTransitions } from '@/components/supply/requisition-actions';
import { SubmissionsTable } from '@/components/supply/submissions-table';
import type { GuidelinesPackageRow, PartnerRow, RateCardRow, RequisitionDto, SubmissionRow } from '@/components/supply/types';
import { BackLink, Facts, fmtDate, fmtDateTime, humanize, NotFoundCard, StatePill } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Requisition' };

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'PM' || r === 'REVIEWER')) return <NoAccess need="Admins, PMs and Validators" />;
  const canPlan = user.roles.some((r) => r === 'ADMIN' || r === 'PM');
  const canValidate = user.roles.some((r) => r === 'ADMIN' || r === 'REVIEWER');
  const { id } = await params;
  const { data: r } = await apiGet<RequisitionDto>(`/requisitions/${id}`);
  if (!r) return <NotFoundCard what="requisition" back="/requisitions" backLabel="Back to requisitions" />;
  const [subs, partners, packages, cards] = await Promise.all([
    apiGet<{ items: SubmissionRow[] }>(`/requisitions/${id}/submissions`),
    canPlan ? apiGet<{ items: PartnerRow[] }>('/partners') : Promise.resolve({ status: 0, data: null }),
    apiGet<{ items: GuidelinesPackageRow[] }>('/guidelines/packages'),
    canPlan ? apiGet<{ items: RateCardRow[] }>('/rate-cards') : Promise.resolve({ status: 0, data: null }),
  ]);
  const partnerName = new Map((partners.data?.items ?? []).map((p) => [p.id, p.name]));
  const pkg = packages.data?.items.find((p) => p.id === r.guidelinesPackageId);
  const card = cards.data?.items.find((c) => c.id === r.rateCardId);
  const req = r.minimumRequirements;
  const counts = Object.entries(r.counts ?? {});

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/requisitions">Requisitions</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{r.title}</h1>
          <StatePill state={r.state} />
          {canPlan && r.state !== 'CLOSED' && (
            <Link href={`/requisitions/${r.id}/edit`} className="btn btn-secondary ml-auto">
              Edit
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          {r.projectName} · {r.domain} · {TIER_LABELS[r.tier]}
        </p>
        {r.summary && <p className="mt-2 max-w-3xl">{r.summary}</p>}
      </div>

      {canPlan && <RequisitionTransitions id={r.id} state={r.state} />}

      <Facts
        rows={[
          ['Headcount', r.headcount],
          ['Start and length', `${r.startDate ? fmtDate(r.startDate) : 'Start not set'}${r.durationWeeks ? ` · ${r.durationWeeks} weeks` : ''}${r.hoursPerWeek ? ` · ${r.hoursPerWeek} h/week` : ''}`],
          ['Location', [r.location, r.jurisdictions.join(', ')].filter(Boolean).join(' · ') || '—'],
          ['Languages', r.languages.join(', ') || '—'],
          ['Minimum requirements', `${req.minYears}+ years${req.qualifications.length ? ` · ${req.qualifications.join(', ')}` : ''}${req.licenceRequired ? ' · professional licence required' : ''}${req.notes ? ` · ${req.notes}` : ''}`],
          ['Partners allowed', r.allowedPartnerIds.length ? r.allowedPartnerIds.map((pid) => partnerName.get(pid) ?? 'Partner').join(', ') : 'None'],
          ['Careers page', r.directChannel ? 'Accepting direct applications' : 'Off'],
          ['Deadline', `${fmtDateTime(r.submissionDeadline)}${r.maxPerPartner ? ` · at most ${r.maxPerPartner} per partner` : ''}`],
          ['Pay route', r.payRoute === 'DIRECT' ? 'Direct: Praxis pays each SME' : 'Via partner: the partner pays its people'],
          ['Guidelines', pkg ? `${pkg.name}${r.guidelinesVersion ? ` · version ${r.guidelinesVersion}` : ' · latest published version'}` : r.guidelinesPackageId ? 'Linked' : 'Not linked yet'],
          ['Rate card', card ? `${card.name} v${card.version} (${card.currency})` : r.rateCardId ? 'Linked' : r.payRoute === 'DIRECT' ? 'Not linked yet: SMEs earn nothing until one is linked' : 'Not needed (paid via partner)'],
          ['Submissions', counts.length ? counts.map(([s, n]) => `${humanize(s)}: ${n}`).join(' · ') : 'None yet'],
        ]}
      />

      {canPlan && (
        <div className="grid gap-6 lg:grid-cols-2">
          <LinkGuidelines requisitionId={r.id} domain={r.domain} packages={packages.data?.items ?? []} currentPackageId={r.guidelinesPackageId} currentVersion={r.guidelinesVersion} />
          {r.payRoute === 'DIRECT' ? (
            <LinkRateCard requisitionId={r.id} cards={cards.data?.items ?? []} currentId={r.rateCardId} />
          ) : (
            <section className="card p-4 text-sm">
              <h2 className="font-semibold">Rate card</h2>
              <p className="mt-2 text-fg-muted">Not needed: this requisition is paid via the partner, so Praxis records no earnings for it.</p>
            </section>
          )}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold">Submissions</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Every submission is invited at once. The requirement screen is a recommendation only; {canValidate ? 'you confirm' : 'a Validator confirms'} “not met”, and the candidate is told respectfully.
        </p>
        <SubmissionsTable items={subs.data?.items ?? []} canDecide={canValidate} />
      </section>
    </div>
  );
}
