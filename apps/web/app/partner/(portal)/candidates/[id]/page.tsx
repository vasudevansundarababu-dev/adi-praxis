import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DIMENSIONS, dimensionLabel, fmtDate, fmtDateTime, StatePill, stateLabel } from '@/components/partner/labels';
import { WithdrawButton } from '@/components/partner/withdraw-button';
import { partnerGet, type PartnerCandidate, type PartnerRequisition } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Candidate' };

export default async function PartnerCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: c } = await partnerGet<PartnerCandidate>(`/candidates/${id}`);
  if (!c) notFound();
  const { data: r } = await partnerGet<PartnerRequisition>(`/requisitions/${c.requisitionId}`);
  const active = c.states.submission === 'RECEIVED' || c.states.submission === 'INVITED';
  const dims = [...DIMENSIONS.map((d) => d.key), ...Object.keys(c.states).filter((k) => !DIMENSIONS.some((d) => d.key === k))];
  // Newest first reads best on a tracker; the API returns the append-only history oldest first.
  const history = [...c.history].reverse();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/partner/candidates" className="text-sm text-link">
          ← Candidates
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{c.name}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {r ? (
            <Link href={`/partner/requisitions/${r.id}`} className="text-link">
              {r.title}
            </Link>
          ) : (
            'Requisition'
          )}{' '}
          · submitted {fmtDate(c.submittedAt)} · {c.channel === 'PARTNER_PORTAL' ? 'via the portal' : c.channel === 'PARTNER_API' ? 'via the API' : c.channel.toLowerCase().replace(/_/g, ' ')}
          {c.partnerRef ? ` · your ref ${c.partnerRef}` : ''}
        </p>
        <p className="mt-1 font-mono text-xs text-fg-muted">Candidate ID {c.candidateId}</p>
      </div>

      {c.duplicateReason && (
        <p role="note" className="rounded-md border border-error px-3 py-2 text-sm">
          Not accepted: {c.duplicateReason}
        </p>
      )}

      <section aria-labelledby="now-h" className="card p-5">
        <h2 id="now-h" className="font-semibold">
          Where they are now
        </h2>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
          {dims.map((k) => (
            <div key={k}>
              <dt className="text-xs font-medium tracking-wide text-fg-muted uppercase">{dimensionLabel(k)}</dt>
              <dd className="mt-1">{c.states[k] ? <StatePill state={c.states[k]!} /> : <span className="text-fg-muted">Not yet</span>}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-5 grid gap-4 border-t border-hairline pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-fg-muted uppercase">Invite</dt>
            <dd className="mt-1">{c.inviteAccepted ? 'Accepted' : c.inviteExpiresAt ? `Not accepted yet · expires ${fmtDate(c.inviteExpiresAt)}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-fg-muted uppercase">You own this candidate until</dt>
            <dd className="mt-1">{fmtDate(c.ownerUntil)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-fg-muted">
          A requirement-screen recommendation is advice for a Validator. Selection, certification and every “not met” decision are made by a person.
        </p>
      </section>

      {active && <WithdrawButton candidateId={c.candidateId} name={c.name} />}

      <section aria-labelledby="hist-h">
        <h2 id="hist-h" className="font-semibold">
          History
        </h2>
        <p className="text-sm text-fg-muted">Every change, newest first. Entries are never edited or removed.</p>
        {history.length === 0 ? (
          <p className="mt-3 card p-5 text-sm text-fg-muted">No changes recorded yet.</p>
        ) : (
          <ol className="mt-3 card divide-y divide-hairline text-sm">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <time dateTime={h.at} className="w-44 shrink-0 text-fg-muted tabular-nums">
                  {fmtDateTime(h.at)}
                </time>
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{dimensionLabel(h.dimension)}</span>
                    {h.from ? (
                      <>
                        {' '}
                        changed from <span className="text-fg-muted">{stateLabel(h.from)}</span> to
                      </>
                    ) : (
                      ' set to'
                    )}{' '}
                    <StatePill state={h.to} />
                  </p>
                  {h.reason && <p className="mt-1 text-fg-muted">{h.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
