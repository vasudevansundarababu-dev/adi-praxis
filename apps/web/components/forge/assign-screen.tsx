'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import {
  assignBody,
  assignButtons,
  assignOptions,
  assignProblem,
  criteriaLine,
  personKey,
  placesFullNote,
  requiredWorkersProblem,
  tabHref,
  taskName,
  type AssignableData,
  type AssignablePerson,
} from '@/lib/forge-console';

const TH = 'px-4 py-2.5 text-xs font-semibold text-fg-muted';

/** The project's location and experience criteria in words, for the intro line (D20). */
function locationText(d: AssignableData) {
  const parts = [d.criteria?.countries ? `location ${d.criteria.countries.join(', ')}` : '', d.criteria?.minYears ? `${d.criteria.minYears}+ years' domain experience` : ''].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}
const TD = 'px-4 py-3 align-top';

function Row({ projectId, d, p, codes }: { projectId: string; d: AssignableData; p: AssignablePerson; codes: Record<string, string> }) {
  const router = useRouter();
  const [taskId, setTaskId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const groups = assignOptions(d, p);
  const buttons = assignButtons(d, p);

  async function assign(role: 'SME' | 'REVIEWER') {
    const problem = assignProblem(role, taskId, d);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/assignments/direct`, assignBody(p, role, taskId));
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  const matched = p.matchingSkills.filter((s) => s.matched === true).map((s) => s.skill);
  const criteria = criteriaLine(p);
  return (
    <tr data-person={personKey(p)} data-source={p.source ?? 'SOURCING'}>
      <td className={TD}>{p.firstName}</td>
      <td className={TD}>{p.lastName}</td>
      <td className={`${TD} font-mono text-xs`}>{p.email}</td>
      <td className={`${TD} text-[13px] text-fg-muted`}>
        {p.assessed ? matched.join(', ') || 'None stated' : 'Not assessed yet'}
        {p.role === 'REVIEWER' && <span className="ml-2 pill pill-brand">Reviewer</span>}
        {p.source === 'POOL' && <span className="ml-2 pill pill-info">Platform pool</span>}
        {criteria.length > 0 && <span className="mt-1 block text-xs">{criteria.join(' · ')}</span>}
      </td>
      <td className={TD}>
        <select
          aria-label={`Task for ${p.firstName} ${p.lastName}`}
          aria-required="true"
          value={taskId}
          onChange={(e) => {
            setTaskId(e.target.value);
            setError(null);
          }}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px]"
        >
          <option value="">Choose a task…</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.tasks.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  {codes[t.taskId] ?? ''} · {taskName(t.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error && (
          <p role="alert" className="mt-1 text-xs text-error">
            {error}
          </p>
        )}
      </td>
      <td className={`${TD} text-right whitespace-nowrap`}>
        {buttons.smeFull && <span className="text-xs text-fg-muted">SME places full: raise Required workers above</span>}
        {buttons.sme && (
          <button type="button" disabled={pending} onClick={() => void assign('SME')} className="btn btn-primary disabled:opacity-60">
            Assign as SME
          </button>
        )}
        {buttons.reviewer && (
          <button type="button" disabled={pending} onClick={() => void assign('REVIEWER')} className="btn btn-secondary ml-2 disabled:opacity-60">
            Assign as Reviewer
          </button>
        )}
      </td>
    </tr>
  );
}

/** D19: SME places used, why they are full, and Required workers the PM or Admin can raise here (audited). */
function Places({ projectId, d }: { projectId: string; d: AssignableData }) {
  const router = useRouter();
  const min = d.minRequiredWorkers ?? 1;
  const [value, setValue] = useState(String(d.requiredWorkers ?? min));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const note = placesFullNote(d);

  async function save() {
    const problem = requiredWorkersProblem(value, min);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/required-workers`, { requiredWorkers: Number(value) });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="mb-5 text-sm text-fg-muted" data-places>
      <p>
        SME places: {d.smePlacesUsed} of {d.requiredWorkers ?? '—'} used{d.smePlacesFull ? ' (full)' : ''}
        {d.taskCount !== undefined ? ` · ${d.taskCount} task${d.taskCount === 1 ? '' : 's'}` : ''}.
      </p>
      {note && (
        <p role="status" className="mt-1 text-fg">
          {note}
        </p>
      )}
      {d.requiredWorkers !== null && (
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="required-workers" className="text-xs font-semibold">
            Required workers
          </label>
          <input
            id="required-workers"
            type="number"
            min={min}
            step={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-[13px]"
          />
          <button type="button" disabled={pending} onClick={() => void save()} className="btn btn-secondary disabled:opacity-60">
            Save
          </button>
          <span className="text-xs">At least {min}: one place per task.</span>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * MVP1 Assign screen (owner, 15 Nov): Sourcing profiles for this project, with the matching skills. Assigning always
 * includes choosing the task; assigning is the selection.
 */
export function AssignScreen({ projectId, projectName, data: d, codes }: { projectId: string; projectName: string; data: AssignableData; codes: Record<string, string> }) {
  const two = d.reviewRoute === 'SME_EXPERT_PM';
  return (
    <div>
      <Link href={tabHref(projectId, 'people')} className="text-sm text-link hover:underline">
        ← {projectName} · Resource assignments
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Assign people</h1>
      <p className="mb-1.5 text-sm text-fg-muted">
        Choose the task each person works on. This project&apos;s Sourcing profiles, and available people from the platform pool who match its criteria
        {locationText(d)}. Template skills: <strong className="text-fg">{d.projectSkills.join(', ') || 'none listed'}</strong>.
      </p>
      <p className="mb-1.5 text-sm text-fg-muted">
        {two
          ? 'As SME, pick an unassigned task to author. As Reviewer, pick an authored task to review (never their own). A person is never both on one project.'
          : "This project's route is Author → PM/Admin, so people can be assigned as SME only, to an unassigned task."}
      </p>
      <Places key={d.requiredWorkers ?? 'none'} projectId={projectId} d={d} />
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline">
            <tr>
              <th className={TH}>First name</th>
              <th className={TH}>Last name</th>
              <th className={TH}>Email</th>
              <th className={TH}>Matching skills</th>
              <th className={`${TH} w-60`}>
                Task <span className="text-error">*</span>
              </th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {d.people.map((p) => (
              <Row key={personKey(p)} projectId={projectId} d={d} p={p} codes={codes} />
            ))}
            {d.people.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-fg-muted">
                  No one available matches this project. Upload more profiles in{' '}
                  <Link href="/sourcing" className="text-link hover:underline">
                    Sourcing
                  </Link>
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
