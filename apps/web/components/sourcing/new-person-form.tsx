'use client';

import { sourcedPersonFormProblems, type SourcedPersonDto, type SourcedRole, type SourcingProjectDto } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { mutate, upload } from '@/lib/client-api';
import { ROLE_LABEL } from './sourcing-list';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';
const MAX_BYTES = 10 * 1024 * 1024;

/** Projects a role can be added to: Reviewers only where the review route has a Reviewer step. */
export const projectsForRole = (projects: SourcingProjectDto[], role: SourcedRole) => (role === 'REVIEWER' ? projects.filter((p) => p.reviewRoute === 'SME_EXPERT_PM') : projects);

/** File checks before upload (the API checks again): profile PDF only; assessment Excel or PDF; up to 10 MB each. */
export function fileProblems(cv: { name: string; size: number } | null, assessment: { name: string; size: number } | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (cv && !/\.pdf$/i.test(cv.name)) out.cv = 'Upload the profile as a PDF.';
  else if (cv && cv.size > MAX_BYTES) out.cv = 'The profile is larger than 10 MB.';
  if (assessment && !/\.(xlsx|pdf)$/i.test(assessment.name)) out.assessment = 'Upload the assessment as Excel (.xlsx) or PDF.';
  else if (assessment && assessment.size > MAX_BYTES) out.assessment = 'The assessment is larger than 10 MB.';
  return out;
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <span id={id} className="mt-1 block text-xs text-error">
      {text}
    </span>
  );
}

export function NewPersonForm({ projects, role, initialProjectId = '' }: { projects: SourcingProjectDto[]; role: SourcedRole; initialProjectId?: string }) {
  const router = useRouter();
  const options = projectsForRole(projects, role);
  const [f, setF] = useState({ projectId: options.some((p) => p.id === initialProjectId) ? initialProjectId : '', firstName: '', lastName: '', email: '', linkedinUrl: '' });
  const [cv, setCv] = useState<File | null>(null);
  const [assessment, setAssessment] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const project = options.find((p) => p.id === f.projectId);
  const kind = ROLE_LABEL[role];
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const described = (k: string) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': `err-${k}` } : {});

  async function save() {
    setMessage(null);
    const problems = { ...sourcedPersonFormProblems(f), ...fileProblems(cv, assessment) };
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setPending(true);
    const res = await mutate<SourcedPersonDto>('POST', '/sourcing/people', { ...f, role, linkedinUrl: f.linkedinUrl.trim() || undefined });
    if (!res.ok) {
      setPending(false);
      return setMessage(res.status === 409 && /already submitted/i.test(res.error ?? '') ? 'This person was already submitted to this project for this role.' : res.error);
    }
    // The profile exists; then its files, one at a time.
    for (const [k, file] of [['cv', cv], ['assessment', assessment]] as const) {
      if (!file) continue;
      const form = new FormData();
      form.append('kind', k);
      form.append('file', file);
      const up = await upload(`/sourcing/people/${res.data!.id}/files`, form);
      if (!up.ok) {
        setPending(false);
        return setMessage(`The profile was created, but the ${k === 'cv' ? 'profile PDF' : 'assessment'} was not uploaded: ${up.error}`);
      }
    }
    router.push(role === 'REVIEWER' ? '/sourcing?tab=REVIEWER' : '/sourcing');
    router.refresh();
  }

  return (
    <div className="card max-w-4xl p-6">
      <RequiredNote className="mb-3" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor="src-project" className="block text-sm font-medium">
            Project
            <Req />
          </label>
          <select id="src-project" value={f.projectId} onChange={(e) => set('projectId', e.target.value)} className={input} required {...described('projectId')}>
            <option value="">Choose a project…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <FieldError id="err-projectId" text={errors.projectId} />
          {project && <span className="mt-1 block text-xs text-fg-muted">Skills: {project.skills.join(', ') || 'none set on the job description'}</span>}
          {!options.length && (
            <span className="mt-1 block text-xs text-fg-muted">
              {role === 'REVIEWER' ? 'No new or active project has a Reviewer step.' : 'No new or active project is open for people yet.'}
            </span>
          )}
        </div>
        {(
          [
            ['firstName', 'First name', 'text', ''],
            ['lastName', 'Last name', 'text', ''],
            ['email', 'Email', 'email', 'name@gmail.com'],
          ] as const
        ).map(([k, label, type, ph]) => (
          <div key={k}>
            <label htmlFor={`src-${k}`} className="block text-sm font-medium">
              {label}
              <Req />
            </label>
            <input id={`src-${k}`} type={type} value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} className={input} required {...described(k)} />
            <FieldError id={`err-${k}`} text={errors[k]} />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label htmlFor="src-linkedin" className="block text-sm font-medium">
            LinkedIn URL
          </label>
          <input id="src-linkedin" value={f.linkedinUrl} placeholder="https://www.linkedin.com/in/…" onChange={(e) => set('linkedinUrl', e.target.value)} className={input} {...described('linkedinUrl')} />
          <FieldError id="err-linkedinUrl" text={errors.linkedinUrl} />
        </div>
        <div>
          <label htmlFor="src-cv" className="block text-sm font-medium">
            Profile (PDF, up to 10 MB)
          </label>
          <input id="src-cv" type="file" accept=".pdf,application/pdf" onChange={(e) => setCv(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" {...described('cv')} />
          <FieldError id="err-cv" text={errors.cv} />
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="src-assessment" className="block text-sm font-medium">
          Candidate assessment (the recruiter&apos;s filled-in sheet: Excel, or PDF)
        </label>
        <input id="src-assessment" type="file" accept=".xlsx,.pdf" onChange={(e) => setAssessment(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" {...described('assessment')} />
        <FieldError id="err-assessment" text={errors.assessment} />
        <p className="mt-1 text-xs text-fg-muted">Accepted in good faith; the answers are not checked yet.</p>
      </div>
      {message && (
        <p role="alert" className="mt-4 text-sm text-error">
          {message}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          {pending ? 'Uploading…' : 'Upload'}
        </button>
        <Link href={role === 'REVIEWER' ? '/sourcing?tab=REVIEWER' : '/sourcing'} className="btn btn-secondary">
          Cancel
        </Link>
        <span className="ml-auto text-sm text-fg-muted">
          Several candidates?{' '}
          <Link href={`/sourcing/import?role=${role}${f.projectId ? `&project=${f.projectId}` : ''}`} className="text-link hover:underline">
            Upload the recruiter&apos;s assessment sheet
          </Link>{' '}
          (one {kind} profile per row)
        </span>
      </div>
    </div>
  );
}
