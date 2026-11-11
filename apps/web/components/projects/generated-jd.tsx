'use client';

import {
  educationLabel,
  generateJobDescriptions,
  JD_ROLE_LABELS,
  LOCATION_TYPES,
  type DemographicAttributeDto,
  type DemographicFilterInput,
  type GeneratedJd,
  type JobDescriptionDto,
  type TemplateDto,
} from '@praxis/shared';
import { useEffect, useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req } from '@/components/required';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';

export interface ProjectJds {
  author: JobDescriptionDto | null;
  reviewer: JobDescriptionDto | null;
}

/** Requirements block shared by the preview and the saved JD: mandatory skills, experience, education, demographics. */
export function JdRequirements({ jd }: { jd: Pick<GeneratedJd, 'mandatorySkills' | 'minExperienceYears' | 'educationLevel' | 'demographicProfile'> & { skills?: string[] } }) {
  const mandatory = new Set(jd.mandatorySkills.map((s) => s.toLowerCase()));
  const extra = (jd.skills ?? []).filter((s) => !mandatory.has(s.toLowerCase()));
  return (
    <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[11rem_1fr]">
      <dt className="font-medium text-fg-muted">Mandatory skills</dt>
      <dd>
        {jd.mandatorySkills.length ? (
          <ul className="flex flex-wrap gap-1" aria-label="Mandatory skills">
            {jd.mandatorySkills.map((s) => (
              <li key={s} className="rounded-full border border-brand-blue px-2 py-0.5">
                {s} <span className="sr-only">(mandatory, from the template)</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-error">The template has no skills. Ask an Admin to add them.</span>
        )}
      </dd>
      {extra.length > 0 && (
        <>
          <dt className="font-medium text-fg-muted">Other skills</dt>
          <dd>{extra.join(', ')}</dd>
        </>
      )}
      <dt className="font-medium text-fg-muted">Experience</dt>
      <dd>At least {jd.minExperienceYears} years in the domain</dd>
      <dt className="font-medium text-fg-muted">Education</dt>
      <dd>{educationLabel(jd.educationLevel)} or higher (or equivalent professional experience)</dd>
      <dt className="font-medium text-fg-muted">Demographic profile</dt>
      <dd>
        {jd.demographicProfile.length ? (
          <ul className="list-disc pl-5">
            {jd.demographicProfile.map((l) => (
              <li key={l.key}>
                {l.label}: {l.text} ({l.required ? 'required' : 'preferred'})
              </li>
            ))}
          </ul>
        ) : (
          'None set (add filters in the Demographics step)'
        )}
      </dd>
    </dl>
  );
}

/** One saved generated JD: requirements are read-only; title, responsibilities, added skills, pay and location are the PM's. */
function SavedJd({ jd, onSaved }: { jd: JobDescriptionDto; onSaved: (jd: JobDescriptionDto) => void }) {
  const mandatory = new Set(jd.mandatorySkills.map((s) => s.toLowerCase()));
  const [f, setF] = useState({
    title: jd.title,
    responsibilities: jd.responsibilities,
    extraSkills: jd.skills.filter((s) => !mandatory.has(s.toLowerCase())).join(', '),
    wagePerTask: jd.wagePerTask ? String(jd.wagePerTask) : '',
    wageCurrency: jd.wageCurrency,
    locationType: jd.locationType as string,
    location: jd.location ?? '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const id = (k: string) => `jd-${jd.role.toLowerCase()}-${k}`;

  async function save() {
    setPending(true);
    const res = await mutate<JobDescriptionDto>('PATCH', `/job-descriptions/${jd.id}`, {
      title: f.title,
      responsibilities: f.responsibilities,
      skills: [...jd.mandatorySkills, ...f.extraSkills.split(',').map((s) => s.trim()).filter(Boolean)],
      wagePerTask: Number(f.wagePerTask),
      wageCurrency: f.wageCurrency,
      locationType: f.locationType,
      location: f.location.trim() || null,
    });
    setPending(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error! });
    setMsg({ ok: true, text: 'Job description saved.' });
    onSaved(res.data!);
  }

  return (
    <section aria-label={JD_ROLE_LABELS[jd.role]} className="rounded-md border border-line p-4">
      <h3 className="font-semibold">{JD_ROLE_LABELS[jd.role]} job description</h3>
      <JdRequirements jd={{ ...jd, minExperienceYears: jd.minExperienceYears ?? 0, educationLevel: jd.educationLevel ?? '' }} />
      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor={id('title')} className="block text-sm font-medium">
            Title
            <Req />
          </label>
          <input id={id('title')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor={id('resp')} className="block text-sm font-medium">
            Responsibilities
            <Req />
          </label>
          <textarea id={id('resp')} rows={5} value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor={id('skills')} className="block text-sm font-medium">
            Other skills (optional, comma separated)
          </label>
          <input id={id('skills')} value={f.extraSkills} onChange={(e) => setF({ ...f, extraSkills: e.target.value })} className={input} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={id('wage')} className="block text-sm font-medium">
              Wage per task
              <Req />
            </label>
            <input id={id('wage')} type="number" min={0.01} step={0.01} value={f.wagePerTask} onChange={(e) => setF({ ...f, wagePerTask: e.target.value })} className={input} />
          </div>
          <div>
            <label htmlFor={id('cur')} className="block text-sm font-medium">
              Currency (ISO code)
              <Req />
            </label>
            <input id={id('cur')} maxLength={3} value={f.wageCurrency} onChange={(e) => setF({ ...f, wageCurrency: e.target.value.toUpperCase() })} className={input} />
          </div>
          <div>
            <label htmlFor={id('lt')} className="block text-sm font-medium">
              Location type
            </label>
            <select id={id('lt')} value={f.locationType} onChange={(e) => setF({ ...f, locationType: e.target.value })} className={input}>
              {LOCATION_TYPES.map((l) => (
                <option key={l} value={l}>
                  {l[0] + l.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={id('loc')} className="block text-sm font-medium">
              Location {f.locationType === 'REMOTE' ? '(optional)' : <Req />}
            </label>
            <input id={id('loc')} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className={input} />
          </div>
        </div>
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-fg-muted' : 'text-sm text-error'}>
            {msg.text}
          </p>
        )}
        <button type="button" disabled={pending} onClick={save} className="btn btn-secondary disabled:opacity-60">
          {pending ? 'Saving…' : 'Save job description'}
        </button>
      </div>
    </section>
  );
}

/**
 * Generated JDs (owner, 12 Nov 2026). Before the draft is saved this shows a live preview from the template and the
 * demographics; once saved, the API keeps the JDs in step and the PM sets pay and location.
 */
export function GeneratedJdPanel(props: {
  template?: TemplateDto;
  taskMode: string;
  reviewRoute: string;
  tptMinutes: number | null;
  filters: DemographicFilterInput[];
  attributes: DemographicAttributeDto[];
  projectId: string | null;
  jds: ProjectJds | null;
  onJdsChange: (jds: ProjectJds) => void;
}) {
  const { template, projectId, jds, onJdsChange } = props;
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/v1/projects/${projectId}/job-descriptions`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as ProjectJds) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && onJdsChange(d))
      .catch(() => live && setLoadError('Could not load the job descriptions. Save the draft and try again.'));
    return () => {
      live = false;
    };
    // Reload whenever the draft is saved with new requirements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, template?.id, props.reviewRoute, JSON.stringify(props.filters)]);

  if (!template) return <p className="mt-4 text-sm">Choose a template first.</p>;
  const preview = generateJobDescriptions({
    workflowName: template.workflowName,
    domainName: template.domainName,
    primaryWork: template.primaryWork,
    skills: template.skills,
    taskMode: props.taskMode,
    reviewRoute: props.reviewRoute,
    tptMinutes: props.tptMinutes,
    filters: props.filters,
    attributes: props.attributes,
  });

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-fg-muted">
        Praxis writes the job description from the template: its skills are mandatory, and the demographic and education profile comes from the Demographics step.
        {preview.reviewer && ' The Expert review route also needs a reviewer job description: the same skills, with more years of experience.'} Both go to recruitment
        when you submit.
      </p>
      {loadError && (
        <p role="alert" className="text-sm text-error">
          {loadError}
        </p>
      )}
      {projectId && jds?.author ? (
        <>
          <p className="text-sm text-fg-muted">Requirements follow the template and the Demographics step; save the draft to refresh them after a change.</p>
          <SavedJd key={`${jds.author.id}-${jds.author.updatedAt}`} jd={jds.author} onSaved={(author) => onJdsChange({ ...jds, author })} />
          {jds.reviewer && <SavedJd key={`${jds.reviewer.id}-${jds.reviewer.updatedAt}`} jd={jds.reviewer} onSaved={(reviewer) => onJdsChange({ ...jds, reviewer })} />}
        </>
      ) : (
        <>
          <p className="text-sm">Preview. Save the draft to create these job descriptions, then set the pay and location.</p>
          {[preview.author, preview.reviewer].filter((j): j is GeneratedJd => !!j).map((j) => (
            <section key={j.role} aria-label={`${JD_ROLE_LABELS[j.role]} preview`} className="rounded-md border border-line p-4">
              <h3 className="font-semibold">{j.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm">{j.responsibilities}</p>
              <JdRequirements jd={{ ...j, skills: j.mandatorySkills }} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
