import type { Metadata } from 'next';
import { CertificationDecision, GradeItem, LicenceCheck, type QueueResponse } from '@/components/cert/review-queue';
import { NoAccess } from '@/components/no-access';
import { Empty, fmtDateTime, humanize, shortId, StatePill, SupplyOff } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Certification reviews' };

/** Written answers to grade, certifications that need a person, and licences to check (section 7.4). */
export default async function CertificationsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'REVIEWER')) return <NoAccess need="Validators and Admins" />;
  const { status, data } = await apiGet<QueueResponse>('/certifications/review-queue');
  if (status === 404) return <SupplyOff title="Certification reviews" />;
  const grading = data?.grading ?? [];
  const certs = data?.certifications ?? [];
  const decisions = certs.filter((c) => c.state === 'REVIEW_REQUIRED');
  const licences = certs.filter((c) => c.licenceStatus === 'PENDING');
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Certification reviews</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          The model grades written answers as a recommendation only. You confirm every grade and make every certification decision; nobody is refused on a model’s score alone.
        </p>
      </div>

      <section aria-labelledby="grading">
        <h2 id="grading" className="text-lg font-semibold">
          Written answers to grade ({grading.reduce((n, a) => n + a.items.length, 0)})
        </h2>
        {grading.length === 0 ? (
          <Empty>No written answers are waiting.</Empty>
        ) : (
          <ul className="mt-3 space-y-4">
            {grading.map((a) => (
              <li key={a.attemptId} className="card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">Test {shortId(a.attemptId)}</span>
                  <span className="text-fg-muted">
                    {humanize(a.tier)} · {a.domain} · submitted {fmtDateTime(a.submittedAt)}
                  </span>
                </div>
                <ol className="mt-3 space-y-4">
                  {a.items.map((i, n) => (
                    <li key={i.itemId}>
                      <GradeItem attemptId={a.attemptId} item={i} n={n + 1} userId={user.id} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="decisions">
        <h2 id="decisions" className="text-lg font-semibold">
          Certifications that need a decision ({decisions.length})
        </h2>
        {decisions.length === 0 ? (
          <Empty>No certifications are waiting for a decision.</Empty>
        ) : (
          <ul className="mt-3 space-y-4">
            {decisions.map((c) => (
              <li key={c.id} className="card p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {humanize(c.tier)} · {c.domain}
                  </span>
                  <StatePill state={c.state} />
                  <span className="text-fg-muted">
                    SME {shortId(c.smeUserId)} · {c.attemptsUsed} attempt{c.attemptsUsed === 1 ? '' : 's'} used
                  </span>
                  {c.licenceStatus && <StatePill state={c.licenceStatus === 'CONFIRMED' ? 'APPROVED' : c.licenceStatus} label={`Licence: ${c.licenceStatus.toLowerCase().replace(/_/g, ' ')}`} />}
                </div>
                {c.reviewReason && <p className="mt-2">{c.reviewReason}</p>}
                <CertificationDecision id={c.id} licenceBlocking={c.licenceStatus !== null && c.licenceStatus !== 'CONFIRMED'} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="licences">
        <h2 id="licences" className="text-lg font-semibold">
          Licences to check ({licences.length})
        </h2>
        {licences.length === 0 ? (
          <Empty>No licences are waiting.</Empty>
        ) : (
          <ul className="mt-3 space-y-4">
            {licences.map((c) => (
              <li key={c.id}>
                <LicenceCheck cert={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
