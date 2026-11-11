import { CANCELLABLE_STATUSES, type DemographicAttributeDto, type JobDescriptionDto, type ProjectDto, type TemplateDto } from '@praxis/shared';
import Link from 'next/link';
import { CancelProjectButton } from './cancel-button';
import { PauseResumeButton } from './pause-resume';
import { ProjectStatusBadge } from './project-status';
import { ReviewersPanel } from './reviewers-panel';

/** Read-only view of a submitted (or later) project, showing its frozen snapshots. */
export function ProjectSummary({
  project: p,
  template,
  attributes,
  jobDescriptions,
  reviewers,
}: {
  reviewers: { items: { userId: string; name: string; email: string }[]; available: { userId: string; name: string; email: string }[] } | null;
  project: ProjectDto;
  template: TemplateDto | null;
  attributes: DemographicAttributeDto[];
  jobDescriptions: JobDescriptionDto[];
}) {
  const snapshot = (p.demographicsSnapshot ?? { attributes: [] }) as { attributes: { key: string; label: string }[] };
  const label = (key: string) => snapshot.attributes.find((a) => a.key === key)?.label ?? attributes.find((a) => a.key === key)?.label ?? key;
  // Show the JD as frozen at submit, not its current (possibly edited) version.
  const jd = (p.jdSnapshot as JobDescriptionDto | null) ?? jobDescriptions.find((j) => j.id === p.jobDescriptionId);
  const rows: [string, React.ReactNode][] = [
    ['Workflow', `${p.domainName} — ${p.workflowName} (template v${p.templateVersion})`],
    ['Owner', p.ownerName],
    ['Authoring experience', p.taskMode === 'AUTHORING' ? p.authoringExperience ?? 'Both (legacy)' : 'Not applicable'],
    ['Dates', p.startDate && p.endDate ? `${p.startDate} to ${p.endDate}` : '—'],
    ['Mode', p.taskMode === 'AUTHORING' ? `Authoring: ${p.distinctTarget} distinct tasks, max ${p.maxPerExpert} per expert` : `Annotation: ${p.taskCount} tasks`],
    ['TPT', p.tptMinutes ? `${p.tptMinutes} minutes (${p.hoursPerWorkerDay} h per worker per day)` : '—'],
    ['Required workers', p.requiredWorkers ?? '—'],
    ['Demographics', p.demographicFilters.map((f) => `${label(f.attributeKey)} (${f.required ? 'required' : 'preferred'})`).join(', ') || '—'],
    ['Job description', jd ? `${jd.title}: ${jd.wagePerTask} ${jd.wageCurrency} per task, ${jd.locationType.toLowerCase()}${jd.location ? `, ${jd.location}` : ''}` : '—'],
    ['Submitted', p.submittedAt ? new Date(p.submittedAt).toLocaleString() : '—'],
  ];
  return (
    <div className="max-w-3xl">
      <Link href="/projects" className="text-sm text-link hover:underline">
        ← Projects
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <ProjectStatusBadge status={p.status} />
      </div>
      {p.description && <p className="mt-1 text-fg-muted">{p.description}</p>}
      <dl className="mt-6 card divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-2 px-4 py-2 sm:grid-cols-[10rem_1fr]">
            <dt className="font-medium text-fg-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-fg-muted">
        The job description, demographics and template version were frozen at submit; later edits to them don’t change this project.
        {template && template.status === 'RETIRED' ? ' This template has since been retired.' : ''}
      </p>
      {['READY_FOR_STAFFING', 'STAFFING', 'STAFFED'].includes(p.status) && (
        <Link href={`/projects/${p.id}/staffing`} className="mt-6 inline-block btn btn-primary">
          {p.status === 'READY_FOR_STAFFING' ? 'Start staffing' : 'Resource assignment'}
        </Link>
      )}
      {!['DRAFT', 'CANCELLED', 'COMPLETED'].includes(p.status) && (
        <Link href={`/projects/${p.id}/opportunity`} className="ml-3 mt-6 inline-block btn btn-secondary">
          Opportunity page
        </Link>
      )}
      {p.status === 'READY_FOR_STAFFING' && p.name.startsWith('SYNTHETIC TEST — ') && (
        <Link href={`/projects/${p.id}/tasks`} className="ml-3 mt-6 inline-block btn btn-secondary">
          Tasks and invites
        </Link>
      )}
      {['STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'].includes(p.status) && (
        <>
          <Link href={`/projects/${p.id}/dashboard`} className="ml-3 mt-6 inline-block btn btn-secondary">
            Progress dashboard
          </Link>
          <Link href={`/projects/${p.id}/tasks`} className="ml-3 mt-6 inline-block btn btn-secondary">
            Tasks and invites
          </Link>
        </>
      )}
      {!['CANCELLED', 'COMPLETED'].includes(p.status) && (
        <Link href={`/projects/${p.id}/policy`} className="ml-3 mt-6 inline-block btn btn-secondary">
          Policy rules
        </Link>
      )}
      {(p.status === 'IN_PROGRESS' || p.status === 'PAUSED') && <PauseResumeButton projectId={p.id} paused={p.status === 'PAUSED'} />}
      {CANCELLABLE_STATUSES.includes(p.status) && <CancelProjectButton projectId={p.id} />}
      {reviewers && !['CANCELLED', 'COMPLETED'].includes(p.status) && <ReviewersPanel projectId={p.id} initial={reviewers} />}
    </div>
  );
}
