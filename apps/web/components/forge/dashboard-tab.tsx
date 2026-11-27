import type { DemographicAttributeDto, ForgeTaskRow, JobDescriptionDto, ProjectDto, ProjectPersonDto } from '@praxis/shared';
import Link from 'next/link';
import type { SearchParams } from '@/components/pager';
import type { ExportState } from '@/components/projects/export-panel';
import { projectDetailRows } from '@/components/projects/summary';
import { exportStatusLine, fullName, nextStep, reviewersOf, routeLabel, selectorName, smesOf, type ReviewRoute } from '@/lib/forge-console';
import { CoverageTable } from './coverage-table';

export interface DashboardNumbers {
  reworkRate: number;
  tpt: { targetMinutes: number | null; averageActiveMinutes: number | null };
}

export interface RuleSetSummary {
  version: number;
  ruleCount: number;
}

/** MVP1 Dashboard tab: summary cards, the Next step banner, coverage by the template's selector and the project details. */
export function ForgeDashboardTab({
  project: p,
  reviewRoute,
  requiredWorkers,
  tasks,
  people,
  dashboard,
  ruleSet,
  exportState,
  attributes,
  jobDescriptions,
}: {
  project: ProjectDto;
  reviewRoute: ReviewRoute;
  requiredWorkers: number | null;
  tasks: ForgeTaskRow[];
  people: ProjectPersonDto[];
  dashboard: DashboardNumbers | null;
  ruleSet: RuleSetSummary | null;
  exportState: ExportState | null;
  attributes: DemographicAttributeDto[];
  jobDescriptions: JobDescriptionDto[];
  /** D24: the URL's `?page=` for the coverage table (read in the browser by CoverageTable). */
  searchParams?: SearchParams;
}) {
  const smes = smesOf(people).length;
  const approved = tasks.filter((t) => t.status === 'ACCEPTED').length;
  const waiting = tasks.filter((t) => t.status === 'SUBMITTED').length;
  const step = nextStep({ projectId: p.id, tasks, smesAssigned: smes, requiredWorkers });
  const selector = selectorName(tasks);
  const covered = tasks.filter((t) => t.status === 'ACCEPTED').length;
  const reviewers = reviewersOf(people);
  const cards: [string, string, string][] = [
    ['Experts', `${smes} / ${requiredWorkers ?? '—'}`, 'assigned'],
    ['Tasks approved', `${approved} / ${tasks.length}`, `${waiting} waiting for review`],
    ['Rule set', ruleSet ? `v${ruleSet.version}` : '—', ruleSet ? `${ruleSet.ruleCount} rules · published` : 'not published yet'],
    [
      'Rework rate',
      dashboard ? `${Math.round(dashboard.reworkRate * 100)}%` : '—',
      dashboard ? `active time ${dashboard.tpt.averageActiveMinutes ?? '—'} / ${dashboard.tpt.targetMinutes ?? '—'} min` : '',
    ],
  ];
  const base = projectDetailRows(p, attributes, jobDescriptions);
  const submitted = base.findIndex(([k]) => k === 'Submitted');
  const extra: [string, React.ReactNode][] = [
    ['Review route', `${routeLabel(reviewRoute)} · chosen at project creation, read-only`],
    [
      'Reviewers',
      reviewRoute === 'SME_EXPERT_PM' ? (
        <>
          {reviewers.length ? reviewers.map((r) => `${fullName(r)} (Reviewer)`).join(', ') : 'None assigned yet'} ·{' '}
          <Link href={`/projects/${p.id}/assign`} className="text-link hover:underline">
            Assign
          </Link>{' '}
          <span className="text-fg-muted">· PM or Admin assigns</span>
        </>
      ) : (
        <span className="text-fg-muted">Not used: this project&apos;s review route has no Reviewer step, so no reviewer can be assigned.</span>
      ),
    ],
    ['Export to RL Gym', exportStatusLine(exportState)],
  ];
  const rows = submitted >= 0 ? [...base.slice(0, submitted), ...extra, ...base.slice(submitted)] : [...base, ...extra];

  return (
    <section aria-label="Dashboard">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([k, v, sub]) => (
          <div key={k} className="card px-4 py-4" data-card={k}>
            <dt className="text-sm text-fg-muted">{k}</dt>
            <dd className="mt-1 font-mono text-2xl font-bold tabular-nums">{v}</dd>
            {sub && <dd className="text-xs font-medium text-fg-muted">{sub}</dd>}
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm" data-next-step>
        <span className="pill pill-warning">Next step</span>
        <span>{step.text}</span>
        <Link href={step.href} className="ml-auto text-link hover:underline">
          {step.link}
        </Link>
      </div>

      <CoverageTable tasks={tasks} selector={selector} />
      <p className="mt-2.5 text-xs text-fg-muted">
        {covered} of {tasks.length} covered by an approved task.
      </p>

      <h2 className="mt-7 mb-3 text-lg font-semibold">Project details</h2>
      <dl className="card divide-y divide-hairline text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[11rem_1fr]">
            <dt className="font-medium text-fg-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 text-xs text-fg-muted">The job description, demographics and template version were frozen at submit; later edits to them don&apos;t change this project.</p>
    </section>
  );
}
