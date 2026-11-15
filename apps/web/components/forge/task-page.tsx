'use client';

import { getFieldValue, isArrayType, itemFieldsOf, PROFILE_SECTIONS, type ForgeComment, type ItemField, type ProjectPersonDto, type RubricView, type SectionKey, type TemplateProfile, type ValidationRunDto } from '@praxis/shared';
import { RubricReadOnly } from './rubric-readonly';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ExportState } from '@/components/projects/export-panel';
import { mutate } from '@/lib/client-api';
import {
  changeAuthorState,
  decisionBody,
  decisionProblem,
  fmtWhen,
  fullName,
  latestValidation,
  REJECT_REASONS,
  reviewersOf,
  reviewTrail,
  routeLabel,
  smesOf,
  tabHref,
  taskBanner,
  taskName,
  taskStatusLabel,
  taskStatusTone,
  type Decision,
  type DecisionForm,
  type ReviewRoute,
} from '@/lib/forge-console';

/** GET /projects/:id/forge-tasks/:taskId (MVP1 step 2). */
export interface ForgeTaskView {
  taskId: string;
  label: string;
  slotLabel: string;
  status: string;
  reviewRoute: ReviewRoute;
  reviewStage: 'EXPERT_REVIEW' | 'PM_APPROVAL' | null;
  project: { id: string; name: string };
  author: { name: string; email: string | null } | null;
  reviewer: { name: string; email: string | null } | null;
  template: { workflow: string; profileId: string | null; profile: TemplateProfile | null };
  output: Record<string, unknown> | null;
  outputVersion: number | null;
  versions: { version: number; submittedAt: string }[];
  coverageTags: { tags: Record<string, string>; edgeCase: string | null } | null;
  reviews: { id: string; by: string; decision: string; stage: string | null; comments: ForgeComment[] | null; notes: string | null; rejectReason: string | null; version: number | null; at: string }[];
  date: string;
  canDecide: boolean;
  waitingFor: 'REVIEWER' | 'PM' | null;
  expectedVersion: number | null;
  expectedRevision: number;
  checklist: { key: string; label: string }[];
  checklistRequired: boolean;
  flaggedDuplicate: boolean;
  confirmCoverage: boolean;
}

const REVIEWABLE = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK'];
const DECISION_LABEL: Record<string, string> = { PASS: 'Passed to PM/Admin', ACCEPT: 'Approved', REWORK: 'Sent back for rework', REJECT: 'Rejected' };
const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function scalar(field: ItemField, value: unknown): string {
  if (isBlank(value)) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return field.options?.find((o) => o.value === value)?.label ?? String(value);
}

/** One authored value, read-only: arrays of records as a table, other arrays as a list, unknown shapes as JSON. */
export function FieldValue({ field, value }: { field: ItemField; value: unknown }) {
  if (isBlank(value)) return <span className="text-fg-muted">—</span>;
  if (isArrayType(field.type) && Array.isArray(value)) {
    const subs = itemFieldsOf(field);
    if (subs.length && value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-hairline text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-semibold">#</th>
                {subs.map((s) => (
                  <th key={s.key} className="px-2 py-1.5 font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {(value as Record<string, unknown>[]).map((item, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 align-top">{i + 1}</td>
                  {subs.map((s) => (
                    <td key={s.key} className="px-2 py-1.5 align-top whitespace-pre-wrap break-words">
                      {scalar(s, item[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
  if (Array.isArray(value))
    return (
      <ul className="list-disc pl-5">
        {value.map((v, i) => (
          <li key={i} className="whitespace-pre-wrap break-words">
            {typeof v === 'object' ? JSON.stringify(v) : field.options?.find((o) => o.value === v)?.label ?? String(v)}
          </li>
        ))}
      </ul>
    );
  if (value && typeof value === 'object') return <pre className="whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>;
  return <span className="whitespace-pre-wrap break-words">{scalar(field, value)}</span>;
}

/** The authored form, read-only, section by section in the template's order. Empty fields show a dash. */
export function AuthoredForm({ profile, output, rubric = null }: { profile: TemplateProfile | null; output: Record<string, unknown> | null; rubric?: RubricView | null }) {
  if (!profile) {
    return output ? (
      <section className="card mb-4 p-5">
        <h3 className="mb-3 font-semibold">Authored task</h3>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(output, null, 2)}</pre>
      </section>
    ) : (
      <p className="card mb-4 p-5 text-sm text-fg-muted">Not authored yet.</p>
    );
  }
  return (
    <>
      {profile.sections.map((s) => (
        <section key={s.key} className="card mb-4 p-5" data-section={s.key}>
          <h3 className="mb-3 font-semibold">
            {s.key} · {s.title}
          </h3>
          {s.fields.length === 0 ? (
            <p className="text-sm text-fg-muted">Checks and submission only.</p>
          ) : (
            <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[12rem_1fr]">
              {s.fields.map((f) => (
                <div key={f.key} className="contents">
                  <dt className="font-medium text-fg-muted">{f.label}</dt>
                  <dd>
                    <FieldValue field={f} value={output ? getFieldValue(profile, output, s.key as SectionKey, f) : undefined} />
                    {rubric && f.type === 'criterion' && <RubricReadOnly view={rubric} items={((output ? getFieldValue(profile, output, s.key as SectionKey, f) : undefined) as Record<string, unknown>[] | undefined) ?? []} />}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </>
  );
}

function AssignReviewer({ projectId, view, people }: { projectId: string; view: ForgeTaskView; people: ProjectPersonDto[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const authorEmail = view.author?.email?.toLowerCase() ?? null;
  const options = reviewersOf(people).filter((r) => r.email !== authorEmail);
  return (
    <div>
      <select
        aria-label="Assign a Reviewer"
        disabled={pending || !options.length}
        defaultValue=""
        className="rounded-md border border-line bg-surface px-2 py-1 text-[13px]"
        onChange={async (e) => {
          const sourcedPersonId = e.target.value;
          if (!sourcedPersonId) return;
          setPending(true);
          setError(null);
          const res = await mutate('POST', `/projects/${projectId}/assignments/direct`, { sourcedPersonId, taskId: view.taskId });
          setPending(false);
          if (!res.ok) {
            e.target.value = '';
            return setError(res.error);
          }
          router.refresh();
        }}
      >
        <option value="">{options.length ? 'Assign reviewer…' : 'No Reviewers on this project yet'}</option>
        {options.map((r) => (
          <option key={r.sourcedPersonId} value={r.sourcedPersonId}>
            {fullName(r)} (Reviewer)
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Change author" (PM or Admin, MVP1 step 9): pick another SME assigned on the project, confirm, and the existing
 * POST /projects/:id/tasks/:taskId/author makes the change. Only before the author starts (owner, 15 Nov): on an In
 * progress or Rework task the control is shown disabled with the reason.
 */
export function ChangeAuthor({ projectId, view, people }: { projectId: string; view: ForgeTaskView; people: ProjectPersonDto[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const state = changeAuthorState(view.status, !!view.author);
  if (!state) return null;
  const authorEmail = view.author?.email?.toLowerCase() ?? null;
  const options = smesOf(people).filter((p) => p.email.toLowerCase() !== authorEmail);
  const chosen = options.find((o) => o.sourcedPersonId === choice) ?? null;
  const disabled = state !== 'enabled' || pending || !options.length;

  async function change() {
    if (!chosen) return setError('Choose the new author.');
    setPending(true);
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/tasks/${view.taskId}/author`, { sourcedPersonId: chosen.sourcedPersonId });
    setPending(false);
    setConfirming(false);
    if (!res.ok) return setError(res.error);
    setChoice('');
    router.refresh();
  }

  return (
    <section aria-labelledby="change-author-h" className="card mb-4 p-5" data-change-author>
      <h3 id="change-author-h" className="mb-2 font-semibold">
        Change author
      </h3>
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          aria-label="New author"
          value={choice}
          disabled={disabled}
          onChange={(e) => {
            setChoice(e.target.value);
            setConfirming(false);
            setError(null);
          }}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm disabled:opacity-60"
        >
          <option value="">{options.length ? 'Choose an SME…' : 'No other SMEs on this project'}</option>
          {options.map((p) => (
            <option key={p.sourcedPersonId} value={p.sourcedPersonId}>
              {fullName(p)} ({p.email})
            </option>
          ))}
        </select>
        {!confirming && (
          <button
            type="button"
            disabled={disabled}
            className="btn btn-secondary disabled:opacity-60"
            onClick={() => (chosen ? (setConfirming(true), setError(null)) : setError('Choose the new author.'))}
          >
            Change author…
          </button>
        )}
      </div>
      {confirming && chosen && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" data-confirm>
          <p>
            Change the author from {view.author?.name ?? 'the current author'} to {fullName(chosen)}? If this was their only task on the project, {view.author?.name ?? 'the current author'} is released from it.
          </p>
          <div className="mt-2 flex gap-2.5">
            <button type="button" disabled={pending} className="btn btn-primary disabled:opacity-60" onClick={() => void change()}>
              Confirm change
            </button>
            <button type="button" disabled={pending} className="btn btn-secondary disabled:opacity-60" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {state === 'started' && <p className="mt-2 text-xs text-fg-muted">The author can be changed only before they start the task.</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}

const emptyForm = (): DecisionForm => ({ comments: [{ section: 'S1', text: '' }], notes: '', rejectReason: '', checklist: {}, duplicateOk: false, coverageOk: false, edgeCase: '' });

/** The decision box: only for the person whose turn it is (canDecide). Rework and Reject need a comment for the author. */
export function DecisionBox({ projectId, view }: { projectId: string; view: ForgeTaskView }) {
  const router = useRouter();
  const [f, setF] = useState<DecisionForm>(() => ({ ...emptyForm(), edgeCase: view.coverageTags?.edgeCase ?? '' }));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sections = view.template.profile?.sections.map((s) => ({ key: s.key, title: s.title })) ?? PROFILE_SECTIONS.map((s) => ({ key: s.key, title: s.title }));
  const needs = {
    checklistKeys: view.checklist.map((c) => c.key),
    checklistRequired: view.checklistRequired,
    duplicateNeeded: view.flaggedDuplicate && view.reviewRoute !== 'SME_EXPERT_PM',
    confirmCoverage: view.confirmCoverage,
    flaggedDuplicate: view.flaggedDuplicate,
    coverageTags: view.coverageTags?.tags ?? {},
  };
  const set = (patch: Partial<DecisionForm>) => {
    setF((x) => ({ ...x, ...patch }));
    setError(null);
  };

  async function decide(decision: Decision) {
    const problem = decisionProblem(decision, f, needs);
    if (problem) return setError(problem);
    if (view.expectedVersion === null) return setError('There is no submitted version to decide on. Reload the page.');
    setPending(true);
    const res = await mutate('POST', `/projects/${projectId}/tasks/${view.taskId}/decision`, decisionBody(decision, f, needs, { version: view.expectedVersion, revision: view.expectedRevision }));
    setPending(false);
    if (!res.ok) return setError(res.error);
    setF(emptyForm());
    router.refresh();
  }

  return (
    <section aria-labelledby="decide-h" className="card mb-4 border-brand-blue p-5" data-decision-box>
      <h3 id="decide-h" className="mb-3 font-semibold">
        Your decision{view.reviewRoute === 'SME_EXPERT_PM' ? ' (final)' : ''}
      </h3>
      <p className="mb-2 text-[13px] text-fg-muted">Comments for the author (required for Rework and Reject), each under one section of the form.</p>
      {f.comments.map((c, i) => (
        <div key={i} className="mb-2 flex flex-wrap items-start gap-2">
          <select
            aria-label={`Section for comment ${i + 1}`}
            value={c.section}
            onChange={(e) => set({ comments: f.comments.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)) })}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key} · {s.title}
              </option>
            ))}
          </select>
          <textarea
            aria-label={`Comment ${i + 1}`}
            rows={2}
            value={c.text}
            onChange={(e) => set({ comments: f.comments.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
            className="min-w-[16rem] flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
            placeholder="What should the author change here?"
          />
          {f.comments.length > 1 && (
            <button type="button" className="text-sm text-link hover:underline" onClick={() => set({ comments: f.comments.filter((_, j) => j !== i) })}>
              Remove
            </button>
          )}
        </div>
      ))}
      <button type="button" className="text-sm text-link hover:underline" onClick={() => set({ comments: [...f.comments, { section: 'S1', text: '' }] })}>
        + Add another comment
      </button>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Notes (optional)</span>
        <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
      </label>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Reason for rejecting (Reject only)</span>
        <select value={f.rejectReason} onChange={(e) => set({ rejectReason: e.target.value as DecisionForm['rejectReason'] })} className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
          <option value="">Choose…</option>
          {REJECT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {view.checklistRequired && (
        <fieldset className="mt-3 text-sm" data-checklist>
          <legend className="font-medium">Checklist (every item must hold to approve)</legend>
          {view.checklist.map((c) => (
            <label key={c.key} className="mt-1 flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={f.checklist[c.key] === true} onChange={(e) => set({ checklist: { ...f.checklist, [c.key]: e.target.checked } })} />
              <span>{c.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {needs.duplicateNeeded && (
        <label className="mt-3 flex items-start gap-2 text-sm" data-duplicate>
          <input type="checkbox" className="mt-1" checked={f.duplicateOk} onChange={(e) => set({ duplicateOk: e.target.checked })} />
          <span>This task looks like an existing one. I checked: it is distinct (needed to approve).</span>
        </label>
      )}
      {view.confirmCoverage && (
        <div className="mt-3 text-sm" data-coverage>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={f.coverageOk} onChange={(e) => set({ coverageOk: e.target.checked })} />
            <span>
              I confirm the coverage this task fills:{' '}
              {Object.entries(view.coverageTags?.tags ?? {})
                .map(([k, v]) => `${k} ${v}`)
                .join(', ') || 'no tags'}{' '}
              (needed to approve).
            </span>
          </label>
          <label className="mt-1 block">
            <span className="text-[13px] text-fg-muted">Edge case</span>
            <input value={f.edgeCase} onChange={(e) => set({ edgeCase: e.target.value })} className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button type="button" disabled={pending} onClick={() => void decide('APPROVE')} className="btn btn-primary disabled:opacity-60">
          Approve
        </button>
        <button type="button" disabled={pending} onClick={() => void decide('REWORK')} className="btn btn-secondary disabled:opacity-60">
          Rework
        </button>
        <button type="button" disabled={pending} onClick={() => void decide('REJECT')} className="btn btn-secondary text-error disabled:opacity-60">
          Reject
        </button>
      </div>
      <p className="mt-2.5 text-xs text-fg-muted">Approve adds the task to the approved dataset. Rework returns it to the author with your comments. Reject is final and frees the slot.</p>
    </section>
  );
}

function ValidateCard({ projectId, recordId, initial }: { projectId: string; recordId: string; initial: ValidationRunDto[] }) {
  const [runs, setRuns] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = latestValidation(runs, recordId);
  return (
    <section className="card mb-4 p-5" data-validate>
      <h3 className="mb-3 flex flex-wrap items-center gap-2.5 font-semibold">
        RL Gym validation <span className="text-xs font-semibold text-fg-muted">checks this task against RL Gym&apos;s export contract; doesn&apos;t export it</span>
      </h3>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className="btn btn-secondary disabled:opacity-60"
          onClick={async () => {
            setPending(true);
            setError(null);
            const res = await mutate<ValidationRunDto>('POST', `/projects/${projectId}/validate`, { recordIds: [recordId] });
            setPending(false);
            if (!res.ok) return setError(res.error);
            setRuns((r) => [res.data!, ...r]);
          }}
        >
          Validate
        </button>
        <span className="text-sm" role="status">
          {latest ? (
            <>
              <span className={`pill ${latest.result.status === 'valid' ? 'pill-success' : latest.result.status === 'needs_fix' ? 'pill-warning' : ''}`}>
                {latest.result.status === 'valid' ? 'Valid' : latest.result.status === 'needs_fix' ? 'Needs fixing' : 'Not validated'}
              </span>{' '}
              <span className="text-fg-muted">
                {latest.run.createdAt.slice(0, 16).replace('T', ' ')} · {latest.result.issues.length} {latest.result.issues.length === 1 ? 'fix' : 'fixes'}
              </span>
            </>
          ) : (
            <span className="text-fg-muted">Not validated yet.</span>
          )}
        </span>
      </div>
      {latest && latest.result.issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {latest.result.issues.map((x, i) => (
            <li key={i}>
              <span className="font-mono text-xs">{x.code}</span> {x.message}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      <p className="mt-2.5 text-xs text-fg-muted">PM or Admin. Fixes are listed per task; nothing changes automatically. &quot;Valid&quot; isn&apos;t approval or RL Gym readiness.</p>
    </section>
  );
}

/** MVP1 task page: the authored form read-only, the review trail, and the decision box when it is the viewer's turn. */
export function ForgeTaskPage({ code, view, people, exportState, rubric = null }: { code: string; view: ForgeTaskView; people: ProjectPersonDto[]; exportState: ExportState | null; rubric?: RubricView | null }) {
  const projectId = view.project.id;
  const last = view.reviews.at(-1) ?? null;
  const decided = ['ACCEPTED', 'REWORK', 'REJECTED'].includes(view.status);
  const trail = reviewTrail(view);
  const recordId = exportState?.tasks.find((t) => t.taskId === view.taskId)?.recordId ?? null;
  const canPickReviewer = view.reviewRoute === 'SME_EXPERT_PM' && !view.reviewer && !!view.author && REVIEWABLE.includes(view.status);
  const showReview = ['SUBMITTED', 'ACCEPTED', 'REWORK', 'REJECTED'].includes(view.status) || canPickReviewer;
  const meta = view.author ? `Authored by ${view.author.name} · ${fmtWhen(view.date)}` : 'No author assigned';
  return (
    <div>
      <Link href={tabHref(projectId, 'tasks')} className="text-sm text-link hover:underline">
        ← {view.project.name} · Tasks
      </Link>
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold">
          {code} · {taskName(view.label)}
        </h1>
        <span className={`pill ${taskStatusTone(view.status)}`}>{taskStatusLabel(view.status)}</span>
      </div>
      <p className="mb-3 text-sm text-fg-muted">
        {meta}
        {view.outputVersion ? ` · version ${view.outputVersion}` : ''}
      </p>
      <p className="mb-4 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm" data-banner>
        {taskBanner(view.status, decided && last ? last : null)}
        {decided && last?.rejectReason ? ` Reason: ${REJECT_REASONS.find((r) => r.value === last.rejectReason)?.label ?? last.rejectReason}.` : ''}
      </p>

      <ChangeAuthor projectId={projectId} view={view} people={people} />

      <AuthoredForm profile={view.template.profile} output={view.status === 'CREATED' ? null : view.output} rubric={rubric} />

      {view.status === 'ACCEPTED' && recordId && <ValidateCard projectId={projectId} recordId={recordId} initial={exportState?.runs ?? []} />}

      {showReview && (
        <section className="card mb-4 p-5" data-review-card>
          <h3 className="mb-3 flex flex-wrap items-center gap-2.5 font-semibold">
            Review <span className="text-xs font-semibold text-fg-muted">{routeLabel(view.reviewRoute)} · set at project creation, read-only</span>
          </h3>
          <ol className="flex flex-wrap gap-2.5 text-[13px]" data-trail>
            {trail.map((s, i) => (
              <li key={s.role} className="contents">
                {i > 0 && (
                  <span aria-hidden className="self-center text-fg-muted">
                    →
                  </span>
                )}
                <div className={`min-w-44 rounded-xl border px-3.5 py-2.5 ${s.state === 'current' ? 'border-brand-blue' : 'border-hairline'}`} data-step={s.role}>
                  <span className={`pill ${s.state === 'done' ? 'pill-success' : s.state === 'current' ? 'pill-info' : ''}`}>{s.role}</span>
                  <div className="mt-1.5 font-semibold">{s.role === 'Reviewer' && canPickReviewer ? <AssignReviewer projectId={projectId} view={view} people={people} /> : s.who}</div>
                  <div className="text-xs text-fg-muted">{s.note}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-xs text-fg-muted">
            {view.reviewRoute === 'SME_EXPERT_PM'
              ? 'The PM or Admin assigns the Reviewer for this task (never its author). The Reviewer checks first; Rework there goes straight back to the author. Only the PM/Admin approval adds the task to the dataset.'
              : 'The PM or Admin reviews directly. Approve adds the task to the dataset.'}
          </p>
          {view.reviews.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm" data-decisions>
              {[...view.reviews].reverse().map((r) => (
                <li key={r.id} className="rounded-lg border border-hairline p-3">
                  <p className="font-medium">
                    {DECISION_LABEL[r.decision] ?? r.decision} · {r.by} · {fmtWhen(r.at)}
                    {r.version ? ` · version ${r.version}` : ''}
                  </p>
                  {(r.comments ?? []).map((c, i) => (
                    <p key={i} className="mt-1">
                      <span className="font-mono text-xs">{c.section}</span> {c.text}
                    </p>
                  ))}
                  {r.notes && <p className="mt-1 text-fg-muted">{r.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view.canDecide && <DecisionBox projectId={projectId} view={view} />}
      {!view.canDecide && view.waitingFor === 'REVIEWER' && (
        <p className="card mb-4 p-5 text-sm" data-waiting>
          <strong>Waiting for the Reviewer.</strong> The decision box opens here once {view.reviewer?.name ?? 'the Reviewer'} passes the task to the PM/Admin.
        </p>
      )}
      {!view.canDecide && view.waitingFor === 'PM' && (
        <p className="card mb-4 p-5 text-sm" data-waiting>
          <strong>Waiting for the PM/Admin.</strong> You can&apos;t decide on a task you wrote or whose author you declared a conflict with.
        </p>
      )}
    </div>
  );
}
