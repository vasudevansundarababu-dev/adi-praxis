import { TIER_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import { BlueprintSettings } from '@/components/cert/blueprint-settings';
import { DecisionForm } from '@/components/cert/course-review';
import { FamilyCard } from '@/components/cert/family-card';
import type { BlueprintDetail } from '@/components/cert/types';
import { NoAccess } from '@/components/no-access';
import { BackLink, Facts, NotFoundCard, StatePill } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Blueprint review' };

/** Blueprint and item-family review per tier (section 7.6), with sample instances and their four checks. */
export default async function BlueprintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'REVIEWER')) return <NoAccess need="Admins and Validators" />;
  const isAdmin = user.roles.includes('ADMIN');
  const { id } = await params;
  const { data: b } = await apiGet<BlueprintDetail>(`/blueprints/${id}`);
  if (!b) return <NotFoundCard what="blueprint" back="/guidelines" backLabel="Back to guidelines" />;
  const pr = b.passRules;
  const byComp = new Map(b.competencies.map((c) => [c.key, c]));
  const expert = b.tier === 'EXPERT';
  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/guidelines/versions/${b.versionId}`}>Guidelines version</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{TIER_LABELS[b.tier]} certification blueprint</h1>
          <StatePill state={b.status} />
        </div>
        <p className="mt-2 max-w-3xl text-sm text-fg-muted">
          Each candidate gets a different but equivalent test built from this blueprint. Correct answers come from each family’s rule, never from the model. Editing the blueprint sends it back for approval.
        </p>
      </div>

      <Facts
        rows={[
          ['Items', `${b.itemCount}${b.authoringTask ? ' + 1 authoring task' : ''}`],
          ['Time limit', `${b.timeLimitMinutes} minutes`],
          [
            'Pass rules',
            [
              `${pr.overallPct}% overall${pr.objectiveOnlyOverall ? ' (objective items only)' : ''}`,
              pr.plantedErrorsPct !== null ? `${pr.plantedErrorsPct}% of planted errors found` : null,
              pr.noCriticalMiss ? 'no critical-rule miss' : null,
              `written answers pass at ${pr.writtenPassScore}`,
              `${pr.confirmationsRequired} ${pr.confirmationsRequired === 1 ? 'person confirms' : 'people confirm'} each authoring grade`,
            ]
              .filter(Boolean)
              .join(' · '),
          ],
          ['Competencies', b.competencies.map((c) => `${c.name} (${c.weight}%)`).join(' · ')],
        ]}
      />

      {isAdmin && <BlueprintSettings blueprint={b} />}
      {isAdmin && <DecisionForm path={`/blueprints/${b.id}/decision`} what="blueprint" status={b.status} />}

      <section>
        <h2 className="text-lg font-semibold">Item families ({b.families.length})</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Approve every family, with at least one valid sample, before publishing.
          {' An Admin decision is sufficient for every tier; no additional Validator or Expert sign-off is required.'}
        </p>
        <ul className="mt-3 space-y-4">
          {b.families.map((f) => (
            <li key={f.id}>
              <FamilyCard family={f} competencyName={byComp.get(f.competency)?.name ?? f.competency} expertTier={expert} isAdmin={isAdmin} userId={user.id} />
            </li>
          ))}
          {b.families.length === 0 && <li className="card p-4 text-sm text-fg-muted">No families yet. They appear when generation finishes.</li>}
        </ul>
      </section>
    </div>
  );
}
