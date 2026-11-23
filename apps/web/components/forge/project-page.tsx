import type { DemographicAttributeDto, ForgeTaskRow, JobDescriptionDto, ProjectDto, ProjectPersonDto } from '@praxis/shared';
import { ForgeDashboardTab, type DashboardNumbers } from '@/components/forge/dashboard-tab';
import { ForgePeopleTab, type WithoutTask } from '@/components/forge/people-tab';
import { ForgeProjectShell } from '@/components/forge/project-shell';
import { ForgeTasksTab } from '@/components/forge/tasks-tab';
import { BenchmarkSection } from '@/components/projects/benchmark-section';
import { ApprovedClausesPanel, DispositionsPanel, QualityPanel, type ClauseRow, type QualityRun } from '@/components/projects/clause-panels';
import { PolicyWorkspace, type DocumentsData, type ExtractionData, type PreviewData, type RuleRow } from '@/components/policy/policy-workspace';
import type { ExportState } from '@/components/projects/export-panel';
import type { SearchParams } from '@/components/pager';
import { apiGet, getCurrentUser } from '@/lib/api';
import { benchmarkTabCount, type WaitingBatch } from '@/lib/benchmark-waiting';
import { smesOf, type ProjectTab, type ReviewRoute } from '@/lib/forge-console';

type People = { reviewRoute: ReviewRoute; requiredWorkers: number | null; items: ProjectPersonDto[]; withoutTask?: WithoutTask };

/** The MVP1 project page: header and tabs Dashboard, Resource assignments, Tasks, Policies (`?tab=`). */
export async function ForgeProjectPage({ project, tab, searchParams = {} }: { project: ProjectDto; tab: ProjectTab; searchParams?: SearchParams }) {
  const id = project.id;
  const [peopleRes, tasksRes, setsRes, waitingRes] = await Promise.all([
    apiGet<People>(`/projects/${id}/people`),
    apiGet<{ reviewRoute: ReviewRoute; items: ForgeTaskRow[] }>(`/projects/${id}/forge-tasks`),
    apiGet<{ items: { version: number; ruleCount: number }[] }>(`/projects/${id}/policy/rule-sets`),
    apiGet<{ items: WaitingBatch[] }>('/run-reviews/waiting'),
  ]);
  const people = peopleRes.data?.items ?? [];
  const tasks = tasksRes.data?.items ?? [];
  const reviewRoute: ReviewRoute = peopleRes.data?.reviewRoute ?? tasksRes.data?.reviewRoute ?? project.reviewRoute ?? 'SME_PM';
  const requiredWorkers = peopleRes.data?.requiredWorkers ?? project.requiredWorkers ?? null;
  const ruleSet = setsRes.data?.items[0] ?? null;
  const counts = { people: `${smesOf(people).length} / ${requiredWorkers ?? '—'}`, tasks: String(tasks.length), policies: ruleSet ? `${ruleSet.ruleCount} rules` : undefined, benchmark: benchmarkTabCount(waitingRes.data?.items ?? [], id) };
  const failed = !peopleRes.data || !tasksRes.data;

  let body: React.ReactNode;
  if (tab === 'people') {
    body = <ForgePeopleTab projectId={id} reviewRoute={reviewRoute} requiredWorkers={requiredWorkers} people={people} tasks={tasks} withoutTask={peopleRes.data?.withoutTask} searchParams={searchParams} />;
  } else if (tab === 'tasks') {
    const { data: exportState } = await apiGet<ExportState>(`/projects/${id}/export`);
    body = <ForgeTasksTab projectId={id} tasks={tasks} people={people} exportState={exportState} />;
  } else if (tab === 'benchmark') {
    body = <BenchmarkSection projectId={id} />;
  } else if (tab === 'policies') {
    const [docs, extraction, rules, preview, user, clauses, factCatalog, quality] = await Promise.all([
      apiGet<DocumentsData>(`/projects/${id}/policy/documents`),
      apiGet<ExtractionData>(`/projects/${id}/policy/extraction`),
      apiGet<{ items: RuleRow[] }>(`/projects/${id}/policy/rules`),
      apiGet<PreviewData>(`/projects/${id}/policy/rule-set/preview`),
      getCurrentUser(),
      apiGet<{ items: ClauseRow[] }>(`/projects/${id}/policy/clauses`),
      apiGet<{ catalog: unknown; version: number | null }>(`/projects/${id}/policy/fact-catalog`),
      apiGet<{ referenceSets: { id: string; documentVersionId: string; version: number; labels: number }[]; runs: QualityRun[] }>(`/projects/${id}/policy/quality`),
    ]);
    body = (
      <section aria-label="Policies">
        <p className="mb-4 max-w-3xl text-sm text-fg-muted">
          Add the project’s policy documents, extract candidate rules, review each rule against its source, then publish one rule set. Every task in this project inherits the published set. Extraction suggests; only a person marks a rule Reviewed.
        </p>
        <PolicyWorkspace
          projectId={id}
          isAdmin={user?.roles.includes('ADMIN') ?? false}
          documents={docs.data ?? { maxPages: 20, items: [] }}
          extraction={extraction.data}
          rules={rules.data?.items ?? []}
          preview={preview.data}
        />
        <DispositionsPanel projectId={id} />
        {clauses.data && <ApprovedClausesPanel projectId={id} clauses={clauses.data.items} catalog={factCatalog.data ?? { version: null, catalog: null }} />}
        {quality.data && <QualityPanel projectId={id} documents={(docs.data?.items ?? []).flatMap((d) => d.versions.map((v) => ({ versionId: v.id, label: `${d.title} v${v.version}` })))} runs={quality.data.runs} sets={quality.data.referenceSets} />}
      </section>
    );
  } else {
    const [dash, exp, a, j] = await Promise.all([
      apiGet<DashboardNumbers>(`/projects/${id}/dashboard`),
      apiGet<ExportState>(`/projects/${id}/export`),
      apiGet<{ items: DemographicAttributeDto[] }>('/demographic-attributes'),
      apiGet<{ items: JobDescriptionDto[] }>('/job-descriptions'),
    ]);
    body = (
      <ForgeDashboardTab
        project={project}
        reviewRoute={reviewRoute}
        requiredWorkers={requiredWorkers}
        tasks={tasks}
        people={people}
        dashboard={dash.data}
        ruleSet={ruleSet}
        exportState={exp.data}
        attributes={a.data?.items ?? []}
        jobDescriptions={j.data?.items ?? []}
        searchParams={searchParams}
      />
    );
  }
  return (
    <ForgeProjectShell project={project} tab={tab} counts={counts}>
      {failed && (
        <p role="alert" className="card mb-4 p-4 text-sm text-error">
          Some of this project could not be loaded. Reload the page to try again.
        </p>
      )}
      {body}
    </ForgeProjectShell>
  );
}
