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
  withSlotCase,
  publicText,
  type ItemField,
  type RubricView,
  type ViewLink,
  type ProfileProblem,
  type SectionKey,
  type TemplateProfile, EDGE_CASE_LABEL, EDGE_CASE_HELP,
  isBlankValue,
  provenanceSummary,
  sectionsToConfirm,
  suggestibleFields,
  isConfirmed,
  AUTHORSHIP_DECLARATION,
  type FieldSuggestion,
  type SuggestionState,
} from '@praxis/shared';
import { FieldSuggestionBox, ProvenanceCounts, SectionConfirm, UseAllSuggestions, useSuggestions } from './field-suggestions';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { placeComments } from '@/lib/forge';
import type { TaskView } from '@/lib/work-types';
import { SubmitPanel } from './submit-panel';
import { SaveIndicator } from './task-page';
import { useAutosave } from './use-autosave';
import { SaveBar } from './save-bar';
import { PolicyPicker, type LibraryView } from './policy-picker';
import { RubricEditor, SourcePanel, rubricBlockers, useRubricView } from './rubric-editor';

/** RUBRIC_RECOMMENDATIONS_ENABLED: the S4/S7/S8 controls change. Template text always shows public names (D5). */
const FormV2 = createContext(false);

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
  const sent = task.template.profile;
  const found = sent && sent.profileId === task.template.profileId ? ({ status: 'ok', profile: sent } as const) : profileForTemplate({ workflowName: task.template.workflow, profileId: task.template.profileId });
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
  const v2 = useContext(FormV2);
  const id = domId(path);
  const mine = problems.filter((p) => p.path === path);
  const describedBy = [`${id}-help`, mine.length ? `${id}-problems` : ''].filter(Boolean).join(' ');
  const required = evaluateRequired(field.required, lookup).required;
  const common = { id, 'aria-describedby': describedBy, 'aria-invalid': mine.length ? true : undefined, 'aria-required': required || undefined };
  const header = (
    <>
      <label htmlFor={id} className="block text-sm font-medium">
        {publicText(field.label)}
        {required && <Req />}
      </label>
      <p id={`${id}-help`} className="text-xs text-fg-muted">
        {publicText(field.help)}
      </p>
    </>
  );
  const example = field.example ? (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-link">Example</summary>
      <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{publicText(field.example)}</p>
    </details>
  ) : null;

  if (isArrayType(field.type)) return <ArrayControl field={field} value={value} path={path} problems={problems} lookup={lookup} onChange={onChange} />;

  if (field.type === 'multi_select') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    if (field.options?.length)
      return (
        <fieldset className="min-w-0" aria-describedby={describedBy}>
          <legend className="text-sm font-medium">
            {publicText(field.label)}
            {required && <Req />}
          </legend>
          <p id={`${id}-help`} className="text-xs text-fg-muted">
            {publicText(field.help)}
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
          {publicText(field.label)}
          {required && <Req />}
        </legend>
        <p id={`${id}-help`} className="text-xs text-fg-muted">
          {publicText(field.help)}
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
          {publicText(field.help)}
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
  const v2 = useContext(FormV2);
  const id = domId(path);
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const noun = field.itemLabel ?? 'item';
  const subs = itemFieldsOf(field);
  const mine = problems.filter((p) => p.path === path);
  const required = evaluateRequired(field.required, lookup).required;
  return (
    <fieldset className="min-w-0 rounded-md border border-line p-3" aria-describedby={`${id}-help`}>
      <legend className="px-1 text-sm font-medium">
        {publicText(field.label)}
        {required && <Req />}
      </legend>
      <p id={`${id}-help`} className="text-xs text-fg-muted">
        {publicText(field.help)}
      </p>
      {field.example && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-link">Example</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{publicText(field.example)}</p>
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

/**
 * The task's case-selector field (e.g. Application type): set by the task's slot, shown read-only so the author never
 * chooses it a second time (15 Nov 2026).
 */
export function SelectorField({ field, value, label }: { field: TemplateProfile['sections'][number]['fields'][number]; value: string; label?: string }) {
  const shown = label ?? field.options?.find((o) => o.value === value)?.label ?? value;
  return (
    <div data-selector-field={field.key}>
      <p className="block text-sm font-medium">{field.label}</p>
      <p className="mt-1 rounded-md border border-line bg-surface px-3 py-2 text-sm" aria-readonly="true">
        {shown}
      </p>
      <p className="mt-1 text-xs text-fg-muted">Set by this task. It cannot be changed.</p>
    </div>
  );
}

/** The D3 declaration (owner, 15 Nov 2026): exactly this text, nothing else, everywhere it appears. */
export const DECLARATION_V2 = 'I won’t use real customer, employer or account information.';
const isPolicyReferenceField = (f: ItemField) => f.type === 'repeated_array' && (f.itemFields ?? []).some((x) => /sha256/i.test(x.key));
const isSourcesField = (f: ItemField) => f.type === 'long_text' && /source/i.test(`${f.key} ${f.label}`) && f.visibility !== 'private_reference' && f.visibility !== 'private_rubric';

export function ProfileEditor({ task, profile, onSubmitted, initialSection, initialRubric = null, initialLibrary = null, initialSuggestions = null }: { task: TaskView; profile: TemplateProfile; onSubmitted: () => void; initialSection?: number; initialRubric?: RubricView | null; initialLibrary?: LibraryView | null; initialSuggestions?: SuggestionState | null }) {
  const v2 = task.formV2 === true;
  const sugOn = task.fieldSuggestions === true;
  const sug = useSuggestions(task.id, sugOn, initialSuggestions);
  const hasRubric = profile.sections.some((s) => s.fields.some((f) => f.type === 'criterion'));
  const rubric = useRubricView(task.id, initialRubric, undefined, v2 && hasRubric);
  const [openLink, setOpenLink] = useState<ViewLink | null>(null);
  const initial = useMemo(
    () => withSlotCase(profile, profileApplies(profile, task.output) ? (task.output as Record<string, unknown>) : startProfileOutput(profile, task.output), task.readOnly ? null : task.input.slot?.case, { lock: true }),
    [profile, task.output, task.input.slot?.case, task.readOnly],
  );
  const { value, update, currentRevision, state, flush } = useAutosave<Record<string, unknown>>(task.id, initial, task.revision, task.readOnly);
  // Rework opens on the first section with a comment.
  const [active, setActive] = useState(() => {
    const flagged = task.status === 'REWORK' ? placeComments(task.review?.comments ?? [], profile.sections.map((s) => s.key)).flagged[0] : undefined;
    const start = initialSection ?? (flagged ? profile.sections.findIndex((s) => s.key === flagged) : 0);
    return Math.min(Math.max(start, 0), profile.sections.length - 1);
  });
  const problems = useMemo(() => profileProblems(profile, value), [profile, value]);
  const progress = useMemo(() => sectionProgress(profile, value), [profile, value]);
  const section = profile.sections[active]!;
  const slot = task.input.slot;
  const header = (value.header ?? {}) as { title?: string; coverageTags?: Record<string, string>; edgeCase?: string };
  // Suggested text (FIELD_SUGGESTIONS_ENABLED): the section's empty fields get a suggestion when the section opens.
  const sugFields = useMemo(() => (sugOn ? suggestibleFields(profile, section.key, slot?.case?.source ?? null) : []), [sugOn, profile, section.key, slot?.case?.source]);
  const sugKeys = useMemo(() => new Set(sugFields.map((f) => f.key)), [sugFields]);
  const needsSuggestions = sugFields.some((f) => isBlankValue(getFieldValue(profile, value, section.key as SectionKey, f)));
  const { load: loadSuggestions } = sug;
  useEffect(() => {
    if (sugOn && !task.readOnly && needsSuggestions) void loadSuggestions(section.key);
  }, [sugOn, task.readOnly, needsSuggestions, loadSuggestions, section.key]);
  const pendingSuggestions = sugFields
    .filter((f) => isBlankValue(getFieldValue(profile, value, section.key as SectionKey, f)))
    .map((f) => sug.offeredFor(section.key, f.key))
    .filter((x): x is FieldSuggestion => !!x);
  const useAll = (items: FieldSuggestion[]) => update((prev) => items.reduce((acc, i) => setFieldValue(profile, acc, section.key as SectionKey, i.key, i.value), prev));
  const confirmable = sugOn && sectionsToConfirm(profile).includes(section.key);
  const withSuggestion = (f: TemplateProfile["sections"][number]["fields"][number], node: React.ReactNode) =>
    sugOn && sugKeys.has(f.key) ? (
      <div key={f.key} className="min-w-0">
        {node}
        <FieldSuggestionBox field={f} section={section.key} value={getFieldValue(profile, value, section.key as SectionKey, f)} s={sug} inputId={domId(`${section.key}.${f.key}`)} readOnly={task.readOnly} onUse={(v) => setField(f.key, v)} />
      </div>
    ) : (
      node
    );
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
  const setRubric = useCallback(
    (sectionKey: SectionKey, key: string) => (v: unknown) => update((prev) => setFieldValue(profile, prev, sectionKey, key, v)),
    [update, profile],
  );
  const rubricItems = useMemo(() => {
    const rf = profile.sections.flatMap((s) => s.fields.filter((f) => f.type === 'criterion').map((f) => getFieldValue(profile, value, s.key as SectionKey, f)))[0];
    return Array.isArray(rf) ? (rf as Record<string, unknown>[]) : [];
  }, [profile, value]);
  const rubricField = useMemo(() => profile.sections.flatMap((s) => s.fields.filter((f) => f.type === 'criterion'))[0] ?? null, [profile]);
  // D14: S8 lists only what blocks Submit in the rubric; recommendations stay in S7, collapsed.
  const rubricTodo = useMemo(() => (v2 && rubric.view && rubricField ? rubricBlockers(rubric.view, rubricField, rubricItems) : []), [v2, rubric.view, rubricField, rubricItems]);
  const openInForm = (l: ViewLink) => {
    setOpenLink(null);
    if (!l.section) return;
    goTo(sectionIndex(l.section));
    const target = `pf-${`${l.section}.${l.field ?? ''}`.replace(/[^A-Za-z0-9]+/g, '-')}`;
    setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  // Review comments sit under their own section (S1, or a range such as S3-S4); the rest are listed at the top.
  const rework = task.status === 'REWORK';
  const placed = useMemo(() => placeComments(task.review?.comments ?? [], profile.sections.map((s) => s.key)), [task.review, profile.sections]);
  const here = placed.bySection[section.key] ?? [];

  return (
    <FormV2.Provider value={v2}>
    <div className="max-w-4xl min-w-0 space-y-4">
      {openLink && <SourcePanel link={openLink} onClose={() => setOpenLink(null)} onOpenInForm={openInForm} />}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-xl font-semibold">{header.title || 'New task'}</h1>
        <SaveIndicator state={state} readOnly={task.readOnly} />
      </div>
      <p className="text-xs text-fg-muted">
        {task.template.workflow} · profile {profile.profileId} v{profile.version} · agent mode {profile.agentMode.toLowerCase()} · revision {task.revision}
        {profile.contractStatus === 'requires_confirmation' && ' · field contract awaiting domain-owner confirmation'}
      </p>
      {slot?.brief && <p className="rounded-md border border-line p-3 text-sm">{slot.brief}</p>}
      {rework && (
        <div role="status" className="rounded-md border border-warning p-3 text-sm" data-rework-summary>
          <p className="font-semibold text-warning">Rework requested</p>
          {placed.flagged.length > 0 && (
            <p className="mt-1">
              Comments on {placed.flagged.join(', ')}, shown under each section. Fix them and resubmit.
            </p>
          )}
          {task.review?.notes && <p className="mt-1">{task.review.notes}</p>}
        </div>
      )}
      {placed.unmatched.length > 0 && (
        <ul className="space-y-1 text-sm text-warning" data-unplaced-comments>
          {placed.unmatched.map((c, i) => (
            <li key={i}>
              Reviewer ({c.section}): {c.text}
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Task sections">
        <ol className="flex flex-wrap gap-2">
          {profile.sections.map((s, i) => {
            const p = progress[i]!;
            const flagged = placed.flagged.includes(s.key);
            return (
              <li key={s.key}>
                <button type="button" onClick={() => goTo(i)} aria-current={i === active ? 'step' : undefined} data-flagged={flagged || undefined} className={`rounded-md border px-2 py-1 text-left text-xs ${i === active ? 'border-link font-semibold' : flagged ? 'border-warning' : 'border-line'}`}>
                  {s.key} {s.title}
                  {flagged && <span className="ml-1 text-warning">· comment</span>}
                  {sugOn && isConfirmed(profile, value, sug.state, s.key) && <span className="ml-1 text-success" data-confirmed-section={s.key}>· ✓ confirmed</span>}
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

      <section aria-labelledby="pf-section-h" data-flagged={here.length > 0 || undefined} className={`min-w-0 space-y-4 ${here.length ? 'rounded-md border-l-4 border-warning pl-3' : ''}`}>
        <div>
          <p className="text-xs text-fg-muted">
            Section {active + 1} of {profile.sections.length}
          </p>
          <h2 id="pf-section-h" className="text-lg font-semibold">
            {section.key} · {publicText(section.title)}
          </h2>
          {section.help && <p className="mt-1 text-sm text-fg-muted">{publicText(section.help)}</p>}
          {here.map((c, i) => (
            <p key={i} role="status" data-section-comment={section.key} className="mt-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm">
              <strong className="text-warning">Reviewer:</strong> {c.text}
            </p>
          ))}
        </div>
        {!task.readOnly && <RequiredNote />}
        {sugOn && !task.readOnly && sugFields.length > 0 && <UseAllSuggestions section={section.key} pending={pendingSuggestions} s={sug} onUseAll={useAll} />}
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
                {EDGE_CASE_LABEL}
                <Req />
                <input aria-required="true" aria-describedby="edge-case-help" value={header.edgeCase ?? ''} onChange={(e) => update((prev) => ({ ...prev, header: { ...(prev.header as object), edgeCase: e.target.value } }))} className={input} />
                <span id="edge-case-help" className="mt-1 block text-xs font-normal text-fg-muted">
                  {EDGE_CASE_HELP}
                </span>
              </label>
            </div>
          )}
          {section.fields.map((f) =>
            slot?.case && slot.case.source === `${section.key}.${f.key}` ? (
              <SelectorField key={f.key} field={f} value={slot.case.value} label={slot.case.label} />
            ) : v2 && f.type === 'criterion' ? (
              rubric.view ? (
                <RubricEditor key={f.key} taskId={task.id} field={f} value={getFieldValue(profile, value, section.key as SectionKey, f)} onChange={setRubric(section.key as SectionKey, f.key)} view={rubric.view} reload={rubric.reload} readOnly={task.readOnly} onOpenSource={setOpenLink} />
              ) : (
                <p key={f.key} role="status" className="text-sm text-fg-muted">
                  {rubric.error ?? 'Loading the rubric…'}
                </p>
              )
            ) : v2 && isPolicyReferenceField(f) ? (
              <PolicyPicker key={f.key} taskId={task.id} field={f} value={getFieldValue(profile, value, section.key as SectionKey, f)} onChange={(v) => setField(f.key, v)} readOnly={task.readOnly} initialLibrary={initialLibrary} />
            ) : v2 && isSourcesField(f) && rubric.view ? (
              withSuggestion(f, <SourcesUsedField key={f.key} view={rubric.view} value={getFieldValue(profile, value, section.key as SectionKey, f)} onFill={(text) => setField(f.key, text)} readOnly={task.readOnly} onChangeSources={() => goTo(sectionIndex(rubric.view!.rubric.section))}>
                <FieldControl field={f} value={getFieldValue(profile, value, section.key as SectionKey, f)} path={`${section.key}.${f.key}`} problems={problems} lookup={lookup} onChange={(v) => setField(f.key, v)} />
              </SourcesUsedField>)
            ) : (
              withSuggestion(f, <FieldControl key={f.key} field={f} value={getFieldValue(profile, value, section.key as SectionKey, f)} path={`${section.key}.${f.key}`} problems={problems} lookup={lookup} onChange={(v) => setField(f.key, v)} />)
            ),
          )}
        </fieldset>

        {confirmable && (
          <SectionConfirm profile={profile} output={value} section={section.key} s={sug} ready={progress[active]!.done >= progress[active]!.required && !progress[active]!.problems} flush={flush} readOnly={task.readOnly} />
        )}

        {section.key === 'S8' && sugOn && (
          <div className="space-y-2">
            <h3 className="font-semibold">Where the text came from</h3>
            <ProvenanceCounts summary={provenanceSummary(profile, value, sug.state, slot?.case?.source ?? null)} />
          </div>
        )}

        {section.key === 'S8' && (
          <div className="space-y-3">
            <h3 className="font-semibold">Still to fix</h3>
            {rubricTodo.length > 0 && (
              <ul className="space-y-1 text-sm" data-rubric-to-finish>
                {rubricTodo.map((t, i) => (
                  <li key={i}>
                    <button type="button" className="text-left text-link underline" onClick={() => goTo(sectionIndex(rubric.view!.rubric.section))}>
                      {rubric.view!.rubric.section}
                    </button>{' '}
                    {t.message}
                  </li>
                ))}
              </ul>
            )}
            {problems.length === 0 ? (
              <p className="text-sm">{rubricTodo.length ? 'Every required field is complete. Fix the rubric items above, then submit.' : 'Every required field is complete. Run the checks, then submit.'}</p>
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
            {!task.readOnly && <SubmitPanel taskId={task.id} flush={flush} revision={currentRevision} onSubmitted={onSubmitted} onGoTo={(s) => goTo(sectionIndex(s))} submitLabel={rework ? 'Resubmit for review' : undefined} declaration={DECLARATION_V2} authorship={sugOn ? AUTHORSHIP_DECLARATION : undefined} />}
          </div>
        )}

        <SaveBar state={state} flush={flush} readOnly={task.readOnly}>
          {active !== profile.sections.length - 1 && (
            <button type="button" className="btn btn-primary" onClick={() => goTo(profile.sections.length - 1)}>
              Check and submit
            </button>
          )}
        </SaveBar>

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
    </FormV2.Provider>
  );
}

/**
 * S8 "Sources" (owner, "make it simple"): the ticked "Sources used for this task", read-only, with a link to change
 * them in the rubric step. An empty field is filled with one readable line per ticked source; text the author already
 * wrote is never overwritten.
 */
function SourcesUsedField({ view, value, onFill, readOnly, onChangeSources, children }: { view: RubricView; value: unknown; onFill: (text: string) => void; readOnly: boolean; onChangeSources: () => void; children: React.ReactNode }) {
  const ticked = view.sources.items.filter((s) => s.ticked);
  const text = ticked.map((s) => `${s.label} (${s.detail})`).join('\n');
  const empty = typeof value !== 'string' || !value.trim();
  return (
    <div className="space-y-2" data-sources-used>
      <div className="rounded-md border border-dashed border-line p-3 text-sm">
        <p className="font-medium">Sources used for this task</p>
        {ticked.length ? (
          <ul className="mt-1 list-disc pl-5">
            {ticked.map((s) => (
              <li key={s.ref}>
                {s.label} <span className="text-xs text-fg-muted">({s.detail})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted">No sources ticked.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-3">
          <button type="button" className="text-link underline" onClick={onChangeSources}>
            Change sources
          </button>
          {!readOnly && empty && ticked.length > 0 && (
            <button type="button" className="text-link underline" onClick={() => onFill(text)}>
              Fill the field below from this list
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
