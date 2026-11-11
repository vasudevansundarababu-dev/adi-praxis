'use client';

import {
  evaluateRequired,
  getFieldValue,
  isArrayType,
  isBlankOutput,
  itemFieldsOf,
  newItem,
  profileApplies,
  profileForTemplate,
  profileProblems,
  sectionProgress,
  setFieldValue,
  startProfileOutput,
  type ItemField,
  type ProfileProblem,
  type SectionKey,
  type TemplateProfile,
} from '@praxis/shared';
import { useMemo, useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import type { TaskView } from '@/lib/work-types';
import { SubmitPanel } from './submit-panel';
import { SaveIndicator } from './task-page';
import { useAutosave } from './use-autosave';

/**
 * The Classic editor for any registered template profile (handover v2.1 ch. 04/05): eight sections with progress,
 * every section editable, repeated records with Add/Remove, collapsed examples, inline problems from the profile,
 * autosave (and save on section switch). The workflow graph mounts in the marked slot below the editor.
 */

export type ProfileRoute = { kind: 'editor'; profile: TemplateProfile } | { kind: 'diagnostic'; workflow: string; problems: string[] } | null;

/**
 * Which editor a task gets: a non-KYC authoring task whose workflow has a registered (sections) profile opens the
 * profile editor, unless it already holds legacy generic content, which keeps the generic editor unchanged.
 */
export function profileRouteFor(task: Pick<TaskView, 'taskType' | 'definition' | 'output' | 'template'>): ProfileRoute {
  if (task.taskType !== 'AUTHORING' || task.definition === 'kyc-onboarding-v1') return null;
  const found = profileForTemplate({ workflowName: task.template.workflow, profileId: task.template.profileId });
  if (found.status === 'unsupported') return { kind: 'diagnostic', workflow: found.workflow, problems: found.problems };
  if (found.status !== 'ok' || found.profile.domainPlugin || found.profile.storage !== 'sections') return null;
  if (!profileApplies(found.profile, task.output) && !isBlankOutput(task.output)) return null;
  return { kind: 'editor', profile: found.profile };
}

/** An unsupported profile is shown as a diagnostic, never as an apparently complete blank form. */
export function ProfileDiagnostic({ workflow, problems }: { workflow: string; problems: string[] }) {
  return (
    <section role="alert" className="max-w-3xl rounded-md border border-error p-4 text-sm">
      <h1 className="text-lg font-semibold">This template cannot be edited yet</h1>
      <p className="mt-1">The authoring profile for {workflow} is not supported, so the form is disabled. Your saved work is kept. Ask the project manager.</p>
      <ul className="mt-2 list-disc pl-5 text-fg-muted">
        {problems.slice(0, 10).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

const domId = (path: string) => `pf-${path.replace(/[^A-Za-z0-9]+/g, '-')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const input = 'mt-1 w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5';
const button = 'rounded-md border border-line px-3 py-1.5 text-sm';

type Lookup = (ref: string) => unknown;

interface FieldProps {
  field: ItemField;
  value: unknown;
  path: string;
  problems: ProfileProblem[];
  lookup: Lookup;
  onChange: (v: unknown) => void;
}

function Messages({ id, problems }: { id: string; problems: ProfileProblem[] }) {
  if (!problems.length) return null;
  return (
    <ul id={id} className="mt-1 space-y-0.5 text-xs text-error">
      {problems.map((p, i) => (
        <li key={i}>{p.message}</li>
      ))}
    </ul>
  );
}

function FieldControl({ field, value, path, problems, lookup, onChange }: FieldProps) {
  const id = domId(path);
  const mine = problems.filter((p) => p.path === path);
  const describedBy = [`${id}-help`, mine.length ? `${id}-problems` : ''].filter(Boolean).join(' ');
  const required = evaluateRequired(field.required, lookup).required;
  const common = { id, 'aria-describedby': describedBy, 'aria-invalid': mine.length ? true : undefined, 'aria-required': required || undefined };
  const header = (
    <>
      <label htmlFor={id} className="block text-sm font-medium">
        {field.label}
        {required && <Req />}
      </label>
      <p id={`${id}-help`} className="text-xs text-fg-muted">
        {field.help}
      </p>
    </>
  );
  const example = field.example ? (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-link">Example</summary>
      <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{field.example}</p>
    </details>
  ) : null;

  if (isArrayType(field.type)) return <ArrayControl field={field} value={value} path={path} problems={problems} lookup={lookup} onChange={onChange} />;

  if (field.type === 'multi_select') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    if (field.options?.length)
      return (
        <fieldset className="min-w-0" aria-describedby={describedBy}>
          <legend className="text-sm font-medium">
            {field.label}
            {required && <Req />}
          </legend>
          <p id={`${id}-help`} className="text-xs text-fg-muted">
            {field.help}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {field.options.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={list.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
          {example}
          <Messages id={`${id}-problems`} problems={mine} />
        </fieldset>
      );
    return (
      <fieldset className="min-w-0" aria-describedby={describedBy}>
        <legend className="text-sm font-medium">
          {field.label}
          {required && <Req />}
        </legend>
        <p id={`${id}-help`} className="text-xs text-fg-muted">
          {field.help}
        </p>
        {list.length === 0 && <p className="mt-1 text-xs text-fg-muted">None yet.</p>}
        {list.map((v, i) => (
          <div key={i} className="mt-1 flex gap-2">
            <input aria-label={`${field.label} ${i + 1}`} value={v} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} className={input} />
            <button type="button" className={button} aria-label={`Remove ${field.label} ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={`${button} mt-2`} onClick={() => onChange([...list, ''])}>
          Add {field.label.toLowerCase()}
        </button>
        {example}
        <Messages id={`${id}-problems`} problems={mine} />
      </fieldset>
    );
  }

  if (field.type === 'flag')
    return (
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
        <p id={`${id}-help`} className="text-xs text-fg-muted">
          {field.help}
        </p>
      </div>
    );

  let control;
  if (field.type === 'long_text') control = <textarea {...common} rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={input} />;
  else if (field.type === 'number')
    control = <input {...common} type="number" inputMode="decimal" min={field.min} max={field.max} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={input} />;
  else if (field.type === 'date') control = <input {...common} type="date" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={input} />;
  else if (field.type === 'pick_list')
    control = (
      <select {...common} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="">Choose…</option>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else control = <input {...common} type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={input} />;
  return (
    <div className="min-w-0">
      {header}
      {control}
      {example}
      <Messages id={`${id}-problems`} problems={mine} />
    </div>
  );
}

function ArrayControl({ field, value, path, problems, lookup, onChange }: FieldProps) {
  const id = domId(path);
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const noun = field.itemLabel ?? 'item';
  const subs = itemFieldsOf(field);
  const mine = problems.filter((p) => p.path === path);
  const required = evaluateRequired(field.required, lookup).required;
  return (
    <fieldset className="min-w-0 rounded-md border border-line p-3" aria-describedby={`${id}-help`}>
      <legend className="px-1 text-sm font-medium">
        {field.label}
        {required && <Req />}
      </legend>
      <p id={`${id}-help`} className="text-xs text-fg-muted">
        {field.help}
      </p>
      {field.example && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-link">Example</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{field.example}</p>
        </details>
      )}
      <Messages id={`${id}-problems`} problems={mine} />
      {items.length === 0 && <p className="mt-2 text-sm text-fg-muted">No {noun}s yet. Use “Add {noun}” to create one; it opens its fields here.</p>}
      <ol className="mt-2 space-y-3">
        {items.map((item, i) => {
          const itemPath = `${path}[${i}]`;
          const sibling: Lookup = (ref) => (ref.includes('.') ? lookup(ref) : item[ref]);
          return (
            <li key={i} className="min-w-0 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  {cap(noun)} {i + 1}
                  {typeof item.id === 'string' && item.id ? ` · ${item.id}` : ''}
                </h4>
                <button type="button" className={button} aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {subs.map((sub) => (
                  <div key={sub.key} className={sub.type === 'long_text' || isArrayType(sub.type) || sub.type === 'multi_select' ? 'sm:col-span-2' : ''}>
                    <FieldControl field={sub} value={item[sub.key]} path={`${itemPath}.${sub.key}`} problems={problems} lookup={sibling} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [sub.key]: v } : x)))} />
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className={`${button} mt-3`} onClick={() => onChange([...items, newItem(field, items)])}>
        Add {noun}
      </button>
    </fieldset>
  );
}

export function ProfileEditor({ task, profile, onSubmitted, initialSection = 0 }: { task: TaskView; profile: TemplateProfile; onSubmitted: () => void; initialSection?: number }) {
  const initial = useMemo(() => (profileApplies(profile, task.output) ? (task.output as Record<string, unknown>) : startProfileOutput(profile, task.output)), [profile, task.output]);
  const { value, update, currentRevision, state, flush } = useAutosave<Record<string, unknown>>(task.id, initial, task.revision, task.readOnly);
  const [active, setActive] = useState(Math.min(Math.max(initialSection, 0), profile.sections.length - 1));
  const problems = useMemo(() => profileProblems(profile, value), [profile, value]);
  const progress = useMemo(() => sectionProgress(profile, value), [profile, value]);
  const section = profile.sections[active]!;
  const slot = task.input.slot;
  const header = (value.header ?? {}) as { title?: string; coverageTags?: Record<string, string>; edgeCase?: string };
  const lookup: Lookup = (ref) => {
    const [sk, key] = ref.split('.');
    return getFieldValue(profile, value, sk as SectionKey, { key: key! });
  };

  // Save on section switch: the switch is immediate; the save state shows any failure.
  const goTo = (i: number) => {
    if (i === active || i < 0 || i >= profile.sections.length) return;
    void flush();
    setActive(i);
  };
  // Server checks name a profile section (S1..S8); the common coverage checks use W01 (the brief).
  const sectionIndex = (key: string) => {
    const i = profile.sections.findIndex((s) => s.key === key);
    return i >= 0 ? i : key === 'W01' ? 0 : profile.sections.length - 1;
  };
  const setField = (key: string, v: unknown) => update((prev) => setFieldValue(profile, prev, section.key as SectionKey, key, v));

  return (
    <div className="max-w-4xl min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-xl font-semibold">{header.title || 'New task'}</h1>
        <SaveIndicator state={state} readOnly={task.readOnly} />
      </div>
      <p className="text-xs text-fg-muted">
        {task.template.workflow} · profile {profile.profileId} v{profile.version} · agent mode {profile.agentMode.toLowerCase()} · revision {task.revision}
        {profile.contractStatus === 'requires_confirmation' && ' · field contract awaiting domain-owner confirmation'}
      </p>
      {slot?.brief && <p className="rounded-md border border-line p-3 text-sm">{slot.brief}</p>}
      {task.review?.comments.map((c, i) => (
        <p key={i} role="status" className="text-sm text-warning">
          Reviewer ({c.section}): {c.text}
        </p>
      ))}

      <nav aria-label="Task sections">
        <ol className="flex flex-wrap gap-2">
          {profile.sections.map((s, i) => {
            const p = progress[i]!;
            return (
              <li key={s.key}>
                <button type="button" onClick={() => goTo(i)} aria-current={i === active ? 'step' : undefined} className={`rounded-md border px-2 py-1 text-left text-xs ${i === active ? 'border-link font-semibold' : 'border-line'}`}>
                  {s.key} {s.title}
                  <span className="block text-fg-muted">
                    {p.required ? `${p.done}/${p.required} required done` : 'nothing required'}
                    {p.problems ? ` · ${p.problems} to fix` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="pf-section-h" className="min-w-0 space-y-4">
        <div>
          <p className="text-xs text-fg-muted">
            Section {active + 1} of {profile.sections.length}
          </p>
          <h2 id="pf-section-h" className="text-lg font-semibold">
            {section.key} · {section.title}
          </h2>
          {section.help && <p className="mt-1 text-sm text-fg-muted">{section.help}</p>}
        </div>
        {!task.readOnly && <RequiredNote />}
        <fieldset disabled={task.readOnly} className="min-w-0 space-y-4">
          {section.key === 'S1' && slot?.isOpen && (
            <div className="grid gap-3 sm:grid-cols-2">
              {task.template.coverageDimensions
                .filter((d) => d.values.length)
                .map((d) => (
                  <label key={d.key} className="block text-sm font-medium">
                    {d.label}
                    <select value={header.coverageTags?.[d.key] ?? ''} onChange={(e) => {
                      const v = e.target.value;
                      update((prev) => {
                        const h = (prev.header ?? {}) as { coverageTags?: Record<string, string> };
                        return { ...prev, header: { ...h, coverageTags: { ...(h.coverageTags ?? {}), [d.key]: v } } };
                      });
                    }} className={input}>
                      <option value="">Choose…</option>
                      {d.values.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                ))}
              <label className="block text-sm font-medium">
                Edge case this task tests
                <Req />
                <input aria-required="true" value={header.edgeCase ?? ''} onChange={(e) => update((prev) => ({ ...prev, header: { ...(prev.header as object), edgeCase: e.target.value } }))} className={input} />
              </label>
            </div>
          )}
          {section.fields.map((f) => (
            <FieldControl key={f.key} field={f} value={getFieldValue(profile, value, section.key as SectionKey, f)} path={`${section.key}.${f.key}`} problems={problems} lookup={lookup} onChange={(v) => setField(f.key, v)} />
          ))}
        </fieldset>

        {section.key === 'S8' && (
          <div className="space-y-3">
            <h3 className="font-semibold">Still to fix</h3>
            {problems.length === 0 ? (
              <p className="text-sm">Every required field is complete. Run the checks, then submit.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {problems.slice(0, 50).map((p, i) => (
                  <li key={i}>
                    <button type="button" className="text-left text-link underline" onClick={() => goTo(sectionIndex(p.section))}>
                      {p.section}
                    </button>{' '}
                    {p.message}
                  </li>
                ))}
              </ul>
            )}
            {!task.readOnly && <SubmitPanel taskId={task.id} flush={flush} revision={currentRevision} onSubmitted={onSubmitted} onGoTo={(s) => goTo(sectionIndex(s))} />}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={button} disabled={active === 0} onClick={() => goTo(active - 1)}>
            Previous section
          </button>
          <button type="button" className={button} disabled={active === profile.sections.length - 1} onClick={() => goTo(active + 1)}>
            Next section
          </button>
        </div>
      </section>

    </div>
  );
}
