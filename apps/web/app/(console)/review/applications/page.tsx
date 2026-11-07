import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { recommendationLabel, statusLabel } from '@/components/review/labels';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'Applications' };

type Item = { id: string; candidateName: string | null; projectName: string; title: string; status: string; submittedAt: string | null; recommendation: string | null };

const FILTERS = [
  ['', 'Waiting for review'],
  ['NEEDS_INFORMATION', 'More information requested'],
  ['SELECTED', 'Selected'],
  ['NOT_SELECTED', 'Not selected'],
] as const;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN')) return <NoAccess need="Validators and Admins" />;
  const { status } = await searchParams;
  const filter = FILTERS.some(([v]) => v === status) ? status! : '';
  const { data } = await apiGet<{ items: Item[] }>(`/review/enrollments${filter ? `?status=${filter}` : ''}`);
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Applications</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        Applications for the pools you review. The assessment is a recommendation only; you make every selection decision.
      </p>
      <nav aria-label="Filter applications" className="mt-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([v, label]) => (
          <Link key={v} href={v ? `/review/applications?status=${v}` : '/review/applications'} aria-current={filter === v ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${filter === v ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}>
            {label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="mt-6 text-fg-muted">No applications here.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Candidate</th>
                <th className="px-3 py-2 font-medium">Pool</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Recommendation</th>
                <th className="px-3 py-2 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2">
                    <Link href={`/review/applications/${i.id}`} className="font-medium text-link hover:underline">
                      {i.candidateName ?? 'Unnamed candidate'}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {i.title}
                    <span className="block text-xs text-fg-muted">{i.projectName}</span>
                  </td>
                  <td className="px-3 py-2"><span className={`pill ${i.status === 'REVIEW_PENDING' ? 'pill-warning' : i.status === 'SELECTED' ? 'pill-success' : 'pill-info'}`}>{statusLabel(i.status)}</span></td>
                  <td className="px-3 py-2">{recommendationLabel(i.recommendation)}</td>
                  <td className="px-3 py-2">{i.submittedAt ? new Date(i.submittedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
