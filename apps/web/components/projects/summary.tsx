import { CANCELLABLE_STATUSES, type DemographicAttributeDto, type JobDescriptionDto, type ProjectDto, type TemplateDto } from '@praxis/shared';
import Link from 'next/link';
import { CancelProjectButton } from './cancel-button';
import { ProjectStatusBadge } from './project-status';

/** Read-only view of a submitted (or later) project, showing its frozen snapshots. */
export function ProjectSummary({
  project: p,
  template,
  attributes,
  jobDescriptions,
}: {
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
      <dl className="mt-6 divide-y divide-line rounded-md border border-line text-sm">
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
      {CANCELLABLE_STATUSES.includes(p.status) && <CancelProjectButton projectId={p.id} />}
    </div>
  );
}
