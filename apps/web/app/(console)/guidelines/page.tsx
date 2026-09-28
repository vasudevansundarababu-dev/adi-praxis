import { TIER_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NewPackageForm, UploadVersionForm } from '@/components/cert/guidelines-forms';
import { NoAccess } from '@/components/no-access';
import type { GuidelinesPackageRow } from '@/components/supply/types';
import { Empty, fmtDate, StatePill, SupplyOff } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Guidelines' };

/** Section 7.6: guidelines upload and versions. Each version generates a course and a certification per tier. */
export default async function GuidelinesPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'REVIEWER' || r === 'PM')) return <NoAccess need="Admins and Validators" />;
  const isAdmin = user.roles.includes('ADMIN');
  const canReview = isAdmin || user.roles.includes('REVIEWER');
  const { status, data } = await apiGet<{ items: GuidelinesPackageRow[] }>('/guidelines/packages');
  if (status === 404) return <SupplyOff title="Guidelines" />;
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Guidelines</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        Upload the guidelines for a domain and task family. Praxis drafts a knowledge map, a course and a certification for each tier from them. Nothing reaches candidates until an Admin approves every part and publishes the tier.
      </p>
      {items.length === 0 ? (
        <Empty>No guidelines packages yet.{isAdmin ? ' Create one below, then upload its first version.' : ''}</Empty>
      ) : (
        <ul className="mt-6 space-y-4">
          {items.map((p) => (
            <li key={p.id} className="card p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <span className="text-sm text-fg-muted">
                  {p.domain} · {p.taskFamily}
                </span>
              </div>
              {p.versions.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">No versions yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line text-sm">
                  {p.versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                      {canReview ? (
                        <Link href={`/guidelines/versions/${v.id}`} className="font-medium text-link hover:underline">
                          Version {v.version}
                        </Link>
                      ) : (
                        <span className="font-medium">Version {v.version}</span>
                      )}
                      <span className="text-xs text-fg-muted">{v.major ? 'Major (update module before next task)' : 'Minor (notify only)'}</span>
                      <StatePill state={v.status} />
                      {v.publishedTiers.map((t) => (
                        <StatePill key={t} state="PUBLISHED" label={`${TIER_LABELS[t]} published`} />
                      ))}
                      <span className="ml-auto text-xs text-fg-muted">uploaded {fmtDate(v.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && <UploadVersionForm packageId={p.id} />}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && <NewPackageForm />}
    </div>
  );
}
