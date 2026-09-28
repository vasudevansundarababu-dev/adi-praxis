import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtDate, StatePill } from '@/components/partner/labels';
import { partnerGet, type PartnerCandidate } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Candidates' };

const COLUMNS = [
  { key: 'submission', label: 'Submission' },
  { key: 'screen', label: 'Screen' },
  { key: 'identity', label: 'Identity' },
  { key: 'selection', label: 'Selection' },
  { key: 'certification', label: 'Certification' },
  { key: 'standing', label: 'Standing' },
];

export default async function PartnerCandidatesPage({ searchParams }: { searchParams: Promise<{ requisitionId?: string }> }) {
  const { requisitionId } = await searchParams;
  const qs = requisitionId && /^[0-9a-f-]{36}$/i.test(requisitionId) ? `?requisitionId=${requisitionId}` : '';
  const { data, status } = await partnerGet<{ items: PartnerCandidate[] }>(`/candidates${qs}`);
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Candidates</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Everyone you put forward through the portal or the live API, with their current state in each stage. Open a candidate for the full history. You can follow progress but
        not act for a candidate.
      </p>
      {qs && (
        <p className="mt-2 text-sm">
          Showing one requisition.{' '}
          <Link href="/partner/candidates" className="text-link">
            Show all candidates
          </Link>
        </p>
      )}
      {status !== 200 && (
        <p role="alert" className="mt-4 text-sm text-error">
          Could not load candidates. Refresh the page; if it keeps failing, contact your partner manager.
        </p>
      )}
      {status === 200 && items.length === 0 && (
        <p className="mt-6 card p-5 text-sm text-fg-muted">
          No candidates yet. Open a{' '}
          <Link href="/partner/requisitions" className="text-link">
            requisition
          </Link>{' '}
          to submit one.
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-6 card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-fg-muted">
              <tr className="border-b border-hairline">
                <th className="px-4 py-2 font-medium">Candidate</th>
                <th className="px-4 py-2 font-medium">Requisition</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-4 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.candidateId} className="border-b border-hairline align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/partner/candidates/${c.candidateId}`} className="font-medium text-link">
                      {c.name}
                    </Link>
                    {c.partnerRef && <span className="block text-xs text-fg-muted">Ref {c.partnerRef}</span>}
                  </td>
                  <td className="px-4 py-2">{c.requisitionTitle ?? '—'}</td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="px-4 py-2">
                      {c.states[col.key] ? <StatePill state={c.states[col.key]!} /> : <span className="text-fg-muted">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(c.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
