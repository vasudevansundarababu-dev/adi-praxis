import type { Metadata } from 'next';
import Link from 'next/link';
import { KnowledgeMap } from '@/components/cert/knowledge-map';
import type { VersionDetail } from '@/components/cert/types';
import { PublishTierButton, RegenerateForm } from '@/components/cert/version-actions';
import { NoAccess } from '@/components/no-access';
import { BackLink, fmtDateTime, NotFoundCard, StatePill, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Guidelines version' };

const tokens = (n?: number) => (n === undefined ? '—' : n.toLocaleString());

/** Section 7.6: generation run status → knowledge map → per-tier course, blueprint and families → publish. */
export default async function VersionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'REVIEWER')) return <NoAccess need="Admins and Validators" />;
  const isAdmin = user.roles.includes('ADMIN');
  const { id } = await params;
  const { data: v } = await apiGet<VersionDetail>(`/guidelines/versions/${id}`);
  if (!v) return <NotFoundCard what="guidelines version" back="/guidelines" backLabel="Back to guidelines" />;
  const running = v.runs.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING');

  return (
    <div className="space-y-8">
      <div>
        <BackLink href="/guidelines">Guidelines</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {v.package.name} · version {v.version}
          </h1>
          <StatePill state={v.status} />
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          {v.package.domain} · {v.package.taskFamily} · {v.major ? 'major' : 'minor'} version · {v.fileName} · {v.sections.length} sections
          {isAdmin && (
            <>
              {' · '}
              <a href={`/api/v1/guidelines/versions/${v.id}/source`} className="text-link hover:underline">
                Download source
              </a>
            </>
          )}
        </p>
      </div>

      <section aria-labelledby="tiers">
        <h2 id="tiers" className="text-lg font-semibold">
          Tiers
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Each tier needs an approved course, an approved blueprint and an approved item family for every competency before it can be published. A published tier cannot change; upload a new version instead.</p>
        <ul className="mt-3 grid gap-4 lg:grid-cols-3">
          {v.tiers.map((t) => (
            <li key={t.tier} className="card flex flex-col p-4 text-sm">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">{t.tierLabel}</h3>
                {t.published ? <StatePill state="PUBLISHED" label="Published" /> : t.readyToPublish ? <StatePill state="APPROVED" label="Ready to publish" /> : <StatePill state="DRAFT" label="In review" />}
              </div>
              <dl className="mt-3 space-y-1">
                <div className="flex gap-2">
                  <dt className="w-24 text-fg-muted">Course</dt>
                  <dd>
                    {t.course ? (
                      <Link href={`/guidelines/courses/${t.course.id}`} className="text-link hover:underline">
                        {t.course.modules} modules · {t.course.status.toLowerCase()}
                      </Link>
                    ) : (
                      'Not generated yet'
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 text-fg-muted">Blueprint</dt>
                  <dd>
                    {t.blueprint ? (
                      <Link href={`/guidelines/blueprints/${t.blueprint.id}`} className="text-link hover:underline">
                        {t.blueprint.itemCount} items · {t.blueprint.timeLimitMinutes} min · {t.blueprint.status.toLowerCase()}
                      </Link>
                    ) : (
                      'Not generated yet'
                    )}
                  </dd>
                </div>
                {t.blueprint && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-fg-muted">Families</dt>
                    <dd>
                      {t.blueprint.approvedFamilies} of {t.blueprint.families} approved
                      {t.blueprint.flaggedFamilies > 0 && <span className="text-error"> · {t.blueprint.flaggedFamilies} flagged</span>}
                    </dd>
                  </div>
                )}
              </dl>
              {!t.published && t.missing.length > 0 && (
                <div className="mt-3">
                  <p className="font-medium">Still to approve</p>
                  <ul className="mt-1 list-disc pl-5 text-fg-muted">
                    {t.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {isAdmin && !t.published && (
                <div className="mt-auto pt-4">
                  <PublishTierButton versionId={v.id} tier={t.tier} tierLabel={t.tierLabel} ready={t.readyToPublish} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="runs">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="runs" className="text-lg font-semibold">
            Generation runs
          </h2>
          {running && <StatePill state="RUNNING" label="Running now: refresh to see progress" />}
        </div>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className={TH}>Started</th>
                <th className={TH}>Scope</th>
                <th className={TH}>Stage</th>
                <th className={TH}>Status</th>
                <th className={TH}>Model</th>
                <th className={TH}>Cost (calls · tokens in / out)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {v.runs.map((r) => (
                <tr key={r.id}>
                  <td className={TD}>{fmtDateTime(r.createdAt)}</td>
                  <td className={TD}>
                    {r.scope.toLowerCase()}
                    {r.target?.tier ? ` · ${r.target.tier.toLowerCase().replace('_sme', '')}` : ''}
                  </td>
                  <td className={TD}>{r.stage.toLowerCase().replace(/_/g, ' ')}</td>
                  <td className={TD}>
                    <StatePill state={r.status} />
                    {r.error && <span className="mt-1 block text-xs text-error">{r.error}</span>}
                  </td>
                  <td className={TD}>
                    {r.model ?? '—'}
                    {r.cost?.bulkModel && r.cost.bulkModel !== r.model && <span className="block text-xs text-fg-muted">bulk: {r.cost.bulkModel}</span>}
                  </td>
                  <td className={`${TD} tabular-nums`}>
                    {tokens(r.cost?.calls)} · {tokens(r.cost?.inputTokens)} / {tokens(r.cost?.outputTokens)}
                  </td>
                </tr>
              ))}
              {v.runs.length === 0 && (
                <tr>
                  <td className={`${TD} text-fg-muted`} colSpan={6}>
                    No runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {isAdmin && <RegenerateForm versionId={v.id} publishedTiers={v.tiers.filter((t) => t.published).map((t) => t.tier)} disabled={running} />}
      </section>

      <section aria-labelledby="knowledge">
        <h2 id="knowledge" className="text-lg font-semibold">
          Knowledge map
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Rules, steps, thresholds, edge cases and failure modes drawn from the guidelines. Every item cites its section; approve, edit or reject each one.</p>
        <KnowledgeMap items={v.knowledge} sections={v.sections} canEdit={isAdmin} />
      </section>

      <details className="card p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Guideline sections ({v.sections.length})</summary>
        <ol className="mt-3 space-y-3">
          {v.sections.map((s) => (
            <li key={s.anchor} id={`section-${s.anchor}`}>
              <p className="font-medium">
                <span className="font-mono text-fg-muted">{s.anchor}</span> {s.heading}
              </p>
              <p className="mt-1 whitespace-pre-line text-fg-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
