'use client';

import {
  computeProjectFigures,
  educationLabel,
  effectiveCoverage,
  type CoverageQuotas,
  type DemographicAttributeDto,
  type DemographicFilterInput,
  type JobDescriptionDto,
  type ProjectDto,
  type TaskMode,
  type TemplateDto,
  ENABLED_REVIEW_ROUTES,
  REVIEW_ROUTE_LABELS,
  REVIEW_ROUTES,
} from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req, RequiredNote } from '@/components/required';
import { DemographicsStep } from './demographics-step';
import { FiguresPanel } from './figures-panel';
import { JobDescriptionStep } from './jd-step';
import { GeneratedJdPanel, type ProjectJds } from './generated-jd';

const STEPS = ['Template', 'Basics', 'Volume, diversity and TPT', 'Demographics', 'Job description', 'Review and submit'] as const;

export interface WizardState {
  templateId: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  authoringExperience: 'CLASSIC' | 'CHATBOT' | 'BOTH' | '';
  reviewRoute: 'SME_PM' | 'SME_EXPERT_PM';
  taskMode: TaskMode;
  taskCount: string;
  distinctTarget: string;
  maxPerExpert: string;
  coverageQuotas: CoverageQuotas;
  tptMinutes: string;
  hoursPerWorkerDay: string;
  demographicFilters: DemographicFilterInput[];
  jobDescriptionId: string | null;
  /** Generated from the template (default for new projects) or picked by hand. */
  jdGenerated: boolean;
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

function initialState(project: ProjectDto | null, templates: TemplateDto[]): WizardState {
  if (project) {
    return {
      templateId: project.templateId,
      name: project.name,
      description: project.description ?? '',
      startDate: project.startDate ?? '',
      endDate: project.endDate ?? '',
      authoringExperience: project.authoringExperience ?? '',
      reviewRoute: project.reviewRoute ?? 'SME_PM',
      taskMode: project.taskMode,
      taskCount: project.taskCount?.toString() ?? '',
      distinctTarget: project.distinctTarget?.toString() ?? '',
      maxPerExpert: project.maxPerExpert?.toString() ?? '',
      coverageQuotas: project.coverageQuotas ?? { cells: [], edgeCases: [] },
      tptMinutes: project.tptMinutes?.toString() ?? '',
      hoursPerWorkerDay: String(project.hoursPerWorkerDay),
      demographicFilters: project.demographicFilters,
      jobDescriptionId: project.jobDescriptionId,
      jdGenerated: project.jdGenerated,
    };
  }
  const t = templates[0];
  return {
    templateId: t?.id ?? '',
    authoringExperience: '',
    reviewRoute: 'SME_PM',
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    taskMode: t?.taskModes.includes('AUTHORING') ? 'AUTHORING' : (t?.taskModes[0] ?? 'AUTHORING'),
    taskCount: '',
    distinctTarget: String(t?.defaultDistinctTarget ?? 50),
    maxPerExpert: String(t?.defaultMaxPerExpert ?? 4),
    coverageQuotas: { cells: [], edgeCases: [] },
    tptMinutes: t?.defaultTptMinutes?.toString() ?? '',
    hoursPerWorkerDay: '4',
    demographicFilters: [],
    // The API applies the template's default JD (if any) when the draft is created.
    jobDescriptionId: null,
    jdGenerated: true,
  };
}

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';

/** FLOW 1 wizard (SPEC): six steps, save as draft at any point, submit from the review step. */
export function ProjectWizard(props: {
  templates: TemplateDto[];
  attributes: DemographicAttributeDto[];
  jobDescriptions: JobDescriptionDto[];
  project: ProjectDto | null;
}) {
  const { templates, attributes, project } = props;
  const router = useRouter();
  const [jobDescriptions, setJobDescriptions] = useState(props.jobDescriptions);
  const [state, setState] = useState<WizardState>(() => initialState(project, templates));
  const [step, setStep] = useState(project ? 1 : 0);
  const [projectId, setProjectId] = useState(project?.id ?? null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; problems?: string[] } | null>(null);

  const set = (patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
    setMessage(null);
  };
  const template = templates.find((t) => t.id === state.templateId);
  const [projectJds, setProjectJds] = useState<ProjectJds | null>(null);
  const jd = state.jdGenerated ? (projectJds?.author ?? null) : (jobDescriptions.find((j) => j.id === state.jobDescriptionId) ?? null);
  const figures = useMemo(
    () =>
      computeProjectFigures({
        taskMode: state.taskMode,
        taskCount: num(state.taskCount),
        distinctTarget: num(state.distinctTarget),
        maxPerExpert: num(state.maxPerExpert),
        tptMinutes: num(state.tptMinutes),
        hoursPerWorkerDay: num(state.hoursPerWorkerDay) ?? 0,
        startDate: state.startDate || null,
        endDate: state.endDate || null,
        wagePerTask: jd?.wagePerTask ?? null,
      }),
    [state, jd],
  );

  function payload() {
    return {
      templateId: state.templateId,
      name: state.name.trim(),
      description: state.description.trim() || null,
      startDate: state.startDate || null,
      endDate: state.endDate || null,
      authoringExperience: state.authoringExperience || undefined,
      reviewRoute: state.taskMode === 'AUTHORING' ? state.reviewRoute : undefined,
      taskMode: state.taskMode,
      taskCount: state.taskMode === 'ANNOTATION' ? num(state.taskCount) : null,
      distinctTarget: state.taskMode === 'AUTHORING' ? num(state.distinctTarget) : null,
      maxPerExpert: state.taskMode === 'AUTHORING' ? num(state.maxPerExpert) : null,
      coverageQuotas: state.coverageQuotas,
      tptMinutes: num(state.tptMinutes),
      hoursPerWorkerDay: num(state.hoursPerWorkerDay) ?? 4,
      demographicFilters: state.demographicFilters,
      jdGenerated: state.jdGenerated,
      ...(state.jdGenerated ? {} : { jobDescriptionId: state.jobDescriptionId }),
    };
  }

  /** Creates the draft on first save, then updates it. Returns the project id, or null on failure. */
  async function save(): Promise<string | null> {
    if (!state.templateId || !state.name.trim()) {
      setMessage({ kind: 'error', text: 'Choose a template and give the project a name before saving.' });
      setStep(state.templateId ? 1 : 0);
      return null;
    }
    if (state.taskMode === 'AUTHORING' && !state.authoringExperience && (!projectId || !!project?.authoringExperience)) { setMessage({kind:'error',text:'Choose Classic, Chatbot or Both before saving.'}); setStep(1); return null; }
    setPending(true);
    const res = projectId
      ? await mutate<ProjectDto>('PATCH', `/projects/${projectId}`, payload())
      : await mutate<ProjectDto>('POST', '/projects', payload());
    setPending(false);
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error! });
      return null;
    }
    if (!projectId) {
      setProjectId(res.data!.id);
      // Keep the wizard open on the draft's own URL.
      window.history.replaceState(null, '', `/projects/${res.data!.id}`);
    }
    setMessage({ kind: 'ok', text: 'Draft saved.' });
    return res.data!.id;
  }

  async function submit() {
    const id = await save();
    if (!id) return;
    setPending(true);
    const res = await fetch(`/api/v1/projects/${id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: '{}',
    });
    setPending(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage({ kind: 'error', text: 'This project can’t be submitted yet.', problems: body?.details?.problems ?? [body?.message ?? 'Submit failed'] });
      return;
    }
    router.push(`/projects/${id}`);
    router.refresh();
  }

  const coverage = template ? effectiveCoverage(template, state.coverageQuotas) : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold">{project ? state.name || 'Draft project' : 'New project'}</h1>
      <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Wizard steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={`rounded-full border px-3 py-1 ${i === step ? 'border-brand-blue bg-surface font-medium' : 'border-line text-fg-muted'}`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-1 h-1 rounded-full bg-brand-gradient" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} aria-hidden />

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <section aria-label={STEPS[step]}>
          <h2 className="text-lg font-semibold">{STEPS[step]}</h2>

          {step === 0 && (
            <div className="mt-4 space-y-4">
              {templates.length === 0 ? (
                <p className="text-fg-muted">No published templates yet. An Admin needs to publish one first.</p>
              ) : (
                <>
                  <RequiredNote />
                  <label htmlFor="template" className="block text-sm font-medium">
                    Domain and workflow
                    <Req />
                  </label>
                  <select
                    id="template"
                    aria-required="true"
                    value={state.templateId}
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value)!;
                      set({
                        templateId: t.id,
                        taskMode: t.taskModes.includes(state.taskMode) ? state.taskMode : t.taskModes[0]!,
                        tptMinutes: state.tptMinutes || (t.defaultTptMinutes?.toString() ?? ''),
                        coverageQuotas: { cells: [], edgeCases: [] },
                      });
                    }}
                    className={input}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.domainName} — {t.workflowName} (v{t.version})
                      </option>
                    ))}
                  </select>
                  {template && (
                    <dl className="space-y-3 rounded-md border border-line p-4 text-sm">
                      {(
                        [
                          ['Primary work', template.primaryWork],
                          ['Verification / reward', template.verificationCriteria],
                          ['Human gate', template.humanGate],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt className="font-medium text-fg-muted">{k}</dt>
                          <dd>{v ?? '—'}</dd>
                        </div>
                      ))}
                      {template.status !== 'PUBLISHED' && <p className="text-error">This template is no longer published. Choose another.</p>}
                    </dl>
                  )}
                </>
              )}
            </div>
          )}

          {step === 1 && state.taskMode === 'AUTHORING' && <fieldset className="mb-5 space-y-2"><legend className="font-medium">Authoring experience <Req /></legend><p className="text-sm text-fg-muted">Choose how SMEs author tasks. Agent type remains defined by the template.</p>{project && !project.authoringExperience && <p className="text-sm text-fg-muted">Legacy project: both existing views remain available. Leave this choice unchanged to preserve its current controls.</p>}<div className="grid gap-3 sm:grid-cols-3">{(['CLASSIC','CHATBOT','BOTH'] as const).map(mode=><label key={mode} className="rounded border border-line p-3"><input type="radio" name="authoringExperience" checked={state.authoringExperience===mode} onChange={()=>set({authoringExperience:mode})} /> <b>{mode==='CLASSIC'?'Classic':mode==='CHATBOT'?'Chatbot':'Both'}</b><p className="mt-2 text-sm">{mode==='CLASSIC'?'Guided fields and investigation map.':mode==='CHATBOT'?'Conversation-led authoring and investigation map.':'Switch views while editing the same task.'}</p></label>)}</div></fieldset>}
          {step === 1 && state.taskMode === 'AUTHORING' && <fieldset className="mb-5 space-y-2"><legend className="font-medium">Review route</legend><p className="text-sm text-fg-muted">Who checks a submitted task. This is platform review; it is never a step inside the task&apos;s workflow.</p><div className="grid gap-3 sm:grid-cols-2">{REVIEW_ROUTES.map(route=>{const enabled=ENABLED_REVIEW_ROUTES.includes(route);return <label key={route} className={`rounded border border-line p-3 ${enabled?'':'opacity-60'}`}><input type="radio" name="reviewRoute" disabled={!enabled} checked={state.reviewRoute===route} onChange={()=>set({reviewRoute:route})} /> <b>{REVIEW_ROUTE_LABELS[route]}</b><p className="mt-2 text-sm">{route==='SME_PM'?'The PM (or an authorised reviewer) approves each submitted task.':'An Expert (a Validator assigned to the project) reviews first and may return, reject or edit with a reason; then the PM approves the exact reviewed version. The same person may hold both responsibilities; each decision is audited separately.'}{!enabled&&' Coming in the next release.'}</p></label>;})}</div></fieldset>}
          {step === 1 && (
            <div className="mt-4 space-y-4">
              <RequiredNote />
              <div>
                <label htmlFor="name" className="block text-sm font-medium">
                  Project name
                  <Req />
                </label>
                <input id="name" aria-required="true" value={state.name} onChange={(e) => set({ name: e.target.value })} className={input} />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-medium">
                  Description
                </label>
                <textarea id="description" rows={3} value={state.description} onChange={(e) => set({ description: e.target.value })} className={input} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="startDate" className="block text-sm font-medium">
                    Start date
                    <Req />
                  </label>
                  <input id="startDate" aria-required="true" type="date" value={state.startDate} onChange={(e) => set({ startDate: e.target.value })} className={input} />
                </div>
                <div>
                  <label htmlFor="endDate" className="block text-sm font-medium">
                    Target end date
                    <Req />
                  </label>
                  <input id="endDate" aria-required="true" type="date" value={state.endDate} onChange={(e) => set({ endDate: e.target.value })} className={input} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && template && (
            <div className="mt-4 space-y-4">
              <RequiredNote />
              <fieldset>
                <legend className="text-sm font-medium">
                  Task mode
                  <Req />
                </legend>
                <div className="mt-2 flex gap-4">
                  {template.taskModes.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <input type="radio" name="taskMode" aria-required="true" checked={state.taskMode === m} onChange={() => set({ taskMode: m })} />
                      {m === 'AUTHORING' ? 'Authoring (experts write new tasks)' : 'Annotation (workers process inputs)'}
                    </label>
                  ))}
                </div>
              </fieldset>
              {state.taskMode === 'AUTHORING' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="distinctTarget" className="block text-sm font-medium">
                      Distinct-task target
                      <Req />
                    </label>
                    <input id="distinctTarget" aria-required="true" type="number" min={1} value={state.distinctTarget} onChange={(e) => set({ distinctTarget: e.target.value })} className={input} />
                  </div>
                  <div>
                    <label htmlFor="maxPerExpert" className="block text-sm font-medium">
                      Max tasks per expert
                      <Req />
                    </label>
                    <input id="maxPerExpert" aria-required="true" type="number" min={1} value={state.maxPerExpert} onChange={(e) => set({ maxPerExpert: e.target.value })} className={input} />
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="taskCount" className="block text-sm font-medium">
                    Number of tasks
                    <Req />
                  </label>
                  <input id="taskCount" aria-required="true" type="number" min={1} value={state.taskCount} onChange={(e) => set({ taskCount: e.target.value })} className={input} />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tpt" className="block text-sm font-medium">
                    TPT (minutes per task)
                    <Req />
                  </label>
                  <input id="tpt" aria-required="true" type="number" min={1} max={480} value={state.tptMinutes} onChange={(e) => set({ tptMinutes: e.target.value })} className={input} />
                  <p className="mt-1 text-xs text-fg-muted">A planning and pay target, not a deadline.</p>
                </div>
                <div>
                  <label htmlFor="hours" className="block text-sm font-medium">
                    Hours per worker per day
                  </label>
                  <input id="hours" type="number" min={0.5} max={24} step={0.5} value={state.hoursPerWorkerDay} onChange={(e) => set({ hoursPerWorkerDay: e.target.value })} className={input} />
                </div>
              </div>
              {state.taskMode === 'AUTHORING' && coverage && (coverage.cells.length > 0 || coverage.edgeCases.length > 0) && (
                <CoverageQuotaEditor template={template} state={state} set={set} requiredSlots={coverage.requiredSlots} />
              )}
            </div>
          )}

          {step === 3 && <DemographicsStep attributes={attributes} filters={state.demographicFilters} onChange={(demographicFilters) => set({ demographicFilters })} />}

          {step === 4 && (
            <fieldset className="mt-4 flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">How to set the job description</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="jdSource" checked={state.jdGenerated} onChange={() => set({ jdGenerated: true })} />
                Generate from the template (recommended)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="jdSource" checked={!state.jdGenerated} onChange={() => set({ jdGenerated: false })} />
                Use or write my own
              </label>
            </fieldset>
          )}
          {step === 4 && state.jdGenerated && (
            <GeneratedJdPanel
              template={template}
              taskMode={state.taskMode}
              reviewRoute={state.reviewRoute}
              tptMinutes={num(state.tptMinutes)}
              filters={state.demographicFilters}
              attributes={attributes}
              projectId={projectId}
              jds={projectJds}
              onJdsChange={setProjectJds}
            />
          )}
          {step === 4 && !state.jdGenerated && (
            <JobDescriptionStep
              jobDescriptions={jobDescriptions}
              selectedId={state.jobDescriptionId}
              onSelect={(jobDescriptionId) => set({ jobDescriptionId })}
              onCreated={(jd) => {
                setJobDescriptions((list) => [...list, jd]);
                set({ jobDescriptionId: jd.id });
              }}
            />
          )}

          {step === 5 && (
            <ReviewStep state={state} template={template} jd={jd} reviewerJd={projectJds?.reviewer ?? null} attributes={attributes} />
          )}

          {message && (
            <div role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-6 rounded-md border p-3 text-sm ${message.kind === 'error' ? 'border-error' : 'border-success'}`}>
              <p className={message.kind === 'error' ? 'font-medium text-error' : 'text-success'}>{message.text}</p>
              {message.problems && (
                <ul className="mt-1 list-disc pl-5">
                  {message.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="btn btn-secondary">
                Back
              </button>
            )}
            <button type="button" disabled={pending} onClick={save} className="btn btn-secondary disabled:opacity-60">
              Save as draft
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => setStep(step + 1)} className="btn btn-primary">
                Next
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={submit} className="btn btn-primary disabled:opacity-60">
                {pending ? 'Submitting…' : 'Submit project'}
              </button>
            )}
          </div>
        </section>

        <FiguresPanel figures={figures} taskMode={state.taskMode} currency={jd?.wageCurrency ?? null} requiredSlots={coverage?.requiredSlots ?? null} />
      </div>
    </div>
  );
}

function CoverageQuotaEditor({
  template,
  state,
  set,
  requiredSlots,
}: {
  template: TemplateDto;
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  requiredSlots: number;
}) {
  const cov = effectiveCoverage(template, state.coverageQuotas);
  const sig = (tags: Record<string, string>) => JSON.stringify(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)));
  const setCell = (tags: Record<string, string>, quota: number) =>
    set({ coverageQuotas: { ...state.coverageQuotas, cells: [...state.coverageQuotas.cells.filter((c) => sig(c.tags) !== sig(tags)), { tags, quota }] } });
  const setEdge = (name: string, quota: number) =>
    set({ coverageQuotas: { ...state.coverageQuotas, edgeCases: [...state.coverageQuotas.edgeCases.filter((e) => e.name !== name), { name, quota }] } });
  const templateMin = (kind: 'cell' | 'edge', key: string) => {
    const base = effectiveCoverage(template, null);
    return kind === 'cell' ? (base.cells.find((c) => sig(c.tags) === key)?.quota ?? 1) : (base.edgeCases.find((e) => e.name === key)?.quota ?? 1);
  };
  return (
    <div className="rounded-md border border-line p-4">
      <h3 className="font-medium">Coverage quotas</h3>
      <p className="text-sm text-fg-muted">
        From the template. You can raise a quota but not go below the template minimum. Required slots: {requiredSlots}.
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {cov.cells.map((c) => (
          <li key={sig(c.tags)} className="flex items-center gap-3">
            <span className="flex-1">
              {Object.entries(c.tags).map(([k, v]) => `${k} = ${v}`).join(', ')} {c.required ? '' : <em className="text-fg-muted">(optional)</em>}
            </span>
            <input type="number" aria-label="Quota" min={templateMin('cell', sig(c.tags))} value={c.quota} onChange={(e) => setCell(c.tags, Number(e.target.value))} className="w-20 rounded-md border border-line bg-surface px-2 py-1" />
          </li>
        ))}
        {cov.edgeCases.map((e) => (
          <li key={e.name} className="flex items-center gap-3">
            <span className="flex-1">
              Edge case: {e.name} {e.required ? '' : <em className="text-fg-muted">(optional)</em>}
            </span>
            <input type="number" aria-label={`Quota for ${e.name}`} min={templateMin('edge', e.name)} value={e.quota} onChange={(ev) => setEdge(e.name, Number(ev.target.value))} className="w-20 rounded-md border border-line bg-surface px-2 py-1" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function jdSummary(jd: JobDescriptionDto): string {
  const req = [jd.mandatorySkills.length ? `mandatory skills ${jd.mandatorySkills.join(', ')}` : '', jd.minExperienceYears ? `${jd.minExperienceYears}+ years` : '', jd.educationLevel ? educationLabel(jd.educationLevel) : '']
    .filter(Boolean)
    .join('; ');
  return `${jd.title}: ${jd.wagePerTask ? `${jd.wagePerTask} ${jd.wageCurrency} per task` : 'pay not set'}, ${jd.locationType.toLowerCase()}${jd.location ? `, ${jd.location}` : ''}${req ? ` (${req})` : ''}`;
}

function ReviewStep({ state, template, jd, reviewerJd, attributes }: { state: WizardState; template?: TemplateDto; jd: JobDescriptionDto | null; reviewerJd: JobDescriptionDto | null; attributes: DemographicAttributeDto[] }) {
  const label = (key: string) => attributes.find((a) => a.key === key)?.label ?? key;
  const rows: [string, React.ReactNode][] = [
    ['Template', template ? `${template.domainName} — ${template.workflowName} (v${template.version})` : '—'],
    ['Name', state.name || '—'],
    ['Authoring experience', state.taskMode === 'AUTHORING' ? state.authoringExperience || 'Choose before saving' : 'Not applicable'],
    ['Review route', state.taskMode === 'AUTHORING' ? REVIEW_ROUTE_LABELS[state.reviewRoute] : 'Not applicable'],
    ['Dates', state.startDate && state.endDate ? `${state.startDate} to ${state.endDate}` : '—'],
    ['Mode', state.taskMode === 'AUTHORING' ? `Authoring: ${state.distinctTarget || '?'} distinct tasks, max ${state.maxPerExpert || '?'} per expert` : `Annotation: ${state.taskCount || '?'} tasks`],
    ['TPT', state.tptMinutes ? `${state.tptMinutes} minutes` : '—'],
    ['Demographics', state.demographicFilters.length ? state.demographicFilters.map((f) => `${label(f.attributeKey)} (${f.required ? 'required' : 'preferred'})`).join(', ') : '—'],
    ['Job description', jd ? jdSummary(jd) : '—'],
    ...(state.taskMode === 'AUTHORING' && state.reviewRoute === 'SME_EXPERT_PM' ? ([['Reviewer job description', reviewerJd ? jdSummary(reviewerJd) : 'Created when you save the draft']] as [string, React.ReactNode][]) : []),
  ];
  return (
    <dl className="mt-4 card divide-y divide-line text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-2 px-4 py-2 sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-fg-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
