'use client';

import { STUDIO_STEP_IDS, type SmeAuthoredTaskDto, type StudioAnswers, type StudioControl, type StudioStepId } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import type { StudioConfig } from '@/lib/studio/types';
import { useMemo, useRef, useState } from 'react';
import { SaveIndicator } from '@/components/work/task-page';
import { useAutosave } from '@/components/work/use-autosave';
import { studioBrowser, type CommitResult } from '@/lib/studio/browser';
import { curveParams, stableJson, studioAnswerProblems, studioSteps, taskJsonPreview, TITLE_KEY, withDefaults } from '@/lib/studio/steps';
import { CustomFieldControl, DropzoneControl, inputClass, InvariantToggle, OracleGrid, SimulatorSlider, WeightSliders } from './controls';
import { CurvePlot } from './curve-plot';

export interface StudioWorkbenchProps {
  config: StudioConfig;
  studioUrl: string;
  smeLabel: string;
  tasks: SmeAuthoredTaskDto[];
  initialStep?: StudioStepId;
}

const REVIEW_LABEL: Record<string, string> = { SUBMITTED: 'Submitted for review', IN_REVIEW: 'In review', ACCEPTED: 'Accepted', REWORK: 'Returned to you', REJECTED: 'Not accepted' };
export const reviewLabel = (s: string) => REVIEW_LABEL[s] ?? s.toLowerCase().replace(/_/g, ' ');

/** Screen 4: the SME studio for one deployment (S4-01 to S4-10, S4-13). */
export function StudioWorkbench({ config, studioUrl, smeLabel, tasks, initialStep = 'scenario' }: StudioWorkbenchProps) {
  const router = useRouter();
  const bp = config.blueprint;
  const steps = useMemo(() => studioSteps(bp), [bp]);
  const [committed, setCommitted] = useState<CommitResult | null>(null);
  const readOnly = committed !== null;
  const target = useMemo(() => studioBrowser.draftTarget(config.studioKey), [config.studioKey]);
  const { value, update, currentRevision, state, flush } = useAutosave<StudioAnswers>(config.taskInstanceId, withDefaults(bp, config.answers), config.revision, readOnly, target);
  const [step, setStep] = useState<StudioStepId>(initialStep);
  const problems = useMemo(() => studioAnswerProblems(bp, value), [bp, value]);
  const current = steps.find((s) => s.id === step)!;
  const navRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setField = (key: string, v: StudioAnswers['fields'][string]) => update((a) => ({ ...a, fields: { ...a.fields, [key]: v } }));

  const onNavKey = (i: number) => (e: React.KeyboardEvent) => {
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? steps.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const j = (to + steps.length) % steps.length;
    navRefs.current[j]?.focus();
    setStep(steps[j]!.id);
  };

  function control(c: StudioControl, i: number): React.ReactNode {
    switch (c.kind) {
      case 'text':
        return c.key === 'title' ? (
          <TextControl key={i} label={c.label} required={c.required} disabled={readOnly} value={String(value.fields[TITLE_KEY] ?? '')} onChange={(v) => setField(TITLE_KEY, v)} />
        ) : (
          <TextControl key={i} label={c.label} required={c.required} multiline={c.multiline} disabled={readOnly} value={value.instructionNotes} onChange={(v) => update((a) => ({ ...a, instructionNotes: v }))} />
        );
      case 'custom_field':
        return <CustomFieldControl key={c.field.field_id} field={c.field} value={value.fields[c.field.field_id]} disabled={readOnly} onChange={(v) => setField(c.field.field_id, v)} />;
      case 'dropzone':
        return (
          <DropzoneControl key={c.dropzoneId} label={c.label} format={c.format} targetPath={c.targetPath} disabled={readOnly} value={value.inputs[c.dropzoneId] ?? ''} onChange={(v) => update((a) => ({ ...a, inputs: { ...a.inputs, [c.dropzoneId]: v } }))} />
        );
      case 'oracle_grid':
        return <OracleGrid key={i} columns={c.columns} tagOptions={c.tagOptions} previewRows={c.previewRows} rows={value.oracleRows} disabled={readOnly} onChange={(rows) => update((a) => ({ ...a, oracleRows: rows }))} />;
      case 'curve_slider':
        return (
          <SimulatorSlider key={c.key} label={c.label} min={c.min} max={c.max} step={c.step} formula={c.formula} disabled={readOnly} value={value.sliders[c.key] ?? c.default} onChange={(v) => update((a) => ({ ...a, sliders: { ...a.sliders, [c.key]: v } }))} />
        );
      case 'invariant_toggle':
        return (
          <InvariantToggle
            key={c.ruleId}
            ruleId={c.ruleId}
            description={c.description}
            disabled={readOnly}
            checked={value.invariantRuleIds.includes(c.ruleId)}
            onChange={(on) => update((a) => ({ ...a, invariantRuleIds: on ? bp.step_4_invariant_catalog.rules.map((r) => r.id).filter((id) => id === c.ruleId || a.invariantRuleIds.includes(id)) : a.invariantRuleIds.filter((id) => id !== c.ruleId) }))}
          />
        );
      case 'weight_slider':
        return null;
      case 'summary':
        return <div key={i}>{summary()}</div>;
    }
  }

  function stepBody() {
    const weights = current.controls.filter((c): c is Extract<StudioControl, { kind: 'weight_slider' }> => c.kind === 'weight_slider');
    const curve = step === 'simulator' ? curveParams(bp, value.sliders) : null;
    return (
      <div className="space-y-5">
        {current.controls.map(control)}
        {curve && (
          <div className="rounded-md border border-line p-3">
            <p className="text-sm font-medium">Diminishing-returns curve</p>
            <CurvePlot ctrBase={curve.ctrBase} kHalf={curve.kHalf} maxSpend={curve.maxSpend} />
          </div>
        )}
        {weights.length > 0 && <WeightSliders milestones={weights} weights={value.milestoneWeights} disabled={readOnly} onChange={(w) => update((a) => ({ ...a, milestoneWeights: w }))} />}
        {current.controls.length === 0 && <p className="text-sm text-fg-muted">Nothing to set in this step for this template.</p>}
      </div>
    );
  }

  function summary() {
    return (
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-1">
          <dt className="text-fg-muted">Title</dt>
          <dd>{String(value.fields[TITLE_KEY] ?? '') || '—'}</dd>
          <dt className="text-fg-muted">Oracle rows tagged</dt>
          <dd>{value.oracleRows.length}</dd>
          <dt className="text-fg-muted">Guardrails on</dt>
          <dd>{value.invariantRuleIds.join(', ') || 'none'}</dd>
          <dt className="text-fg-muted">Rubric weights</dt>
          <dd>{Object.entries(value.milestoneWeights).map(([k, w]) => `${k} ${w}%`).join(', ') || '—'}</dd>
        </dl>
        {problems.confirm.length > 0 ? (
          <div role="alert" className="rounded-md border border-warning p-3">
            <p className="font-medium">Fix these before you commit:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.confirm.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ) : (
          <p role="status" className="text-success">Every step is complete.</p>
        )}
        {commitPanel()}
      </div>
    );
  }

  const [declared, setDeclared] = useState(false);
  const [pending, setPending] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const commitKey = useRef<string | null>(null);

  async function commit() {
    setPending(true);
    setCommitError(null);
    if (!(await flush())) {
      setPending(false);
      return setCommitError('Your latest changes could not be saved yet, so nothing was committed.');
    }
    commitKey.current ??= crypto.randomUUID();
    const r = await studioBrowser.commit(config.studioKey, currentRevision(), commitKey.current);
    setPending(false);
    if (r.ok && r.data) return setCommitted(r.data);
    // A network failure keeps the key so the retry is the same request; any answer from the server ends the attempt.
    if (r.status !== 0) commitKey.current = null;
    setCommitError(r.error);
  }

  function commitPanel() {
    if (committed) return null;
    const blocked = problems.confirm.length > 0;
    return (
      <div className="space-y-3 rounded-md border border-line p-3">
        <p>
          Data classification: <strong>Synthetic</strong>
          {!config.realDataEnabled && <span className="text-fg-muted"> (real public data is not enabled)</span>}
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="mt-1" />
          <span>I confirm this task uses only synthetic data: no real customer, employer or personal data.</span>
        </label>
        <button type="button" disabled={blocked || !declared || pending} onClick={() => void commit()} className="btn btn-primary">
          {pending ? 'Committing…' : 'Save & Commit'}
        </button>
        {commitError && <p role="alert" className="text-error">{commitError}</p>}
      </div>
    );
  }

  const previewText = committed ? stableJson(committed.taskJson) : taskJsonPreview(bp, value);

  return (
    <div className="space-y-4">
      <StudioHeader config={config} studioUrl={studioUrl} smeLabel={smeLabel} committed={committed} save={<SaveIndicator state={state} readOnly={readOnly} />} />
      {committed && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-success p-3 text-sm" data-testid="submitted">
          <span className="pill pill-success">Submitted for review</span>
          <span>
            Task <code>{committed.externalTaskId}</code> was saved to the database, as JSON and as a Harbor bundle. A Reviewer checks it before it can reach the
            Approved Task Dataset; if it is returned, it comes back here.
          </span>
          <button type="button" className="btn btn-secondary !px-3 !py-1 text-xs" onClick={() => router.refresh()}>
            Start the next task
          </button>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">
        <nav aria-label="Authoring steps" className="xl:sticky xl:top-20 xl:self-start">
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const n = problems[s.id].length;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      navRefs.current[i] = el;
                    }}
                    aria-current={s.id === step ? 'step' : undefined}
                    onClick={() => setStep(s.id)}
                    onKeyDown={onNavKey(i)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${s.id === step ? 'border-focus bg-surface font-semibold' : 'border-transparent hover:border-line'}`}
                  >
                    <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full text-xs ${n === 0 ? 'bg-success text-white' : 'border border-warning'}`}>
                      {n === 0 ? '✓' : i + 1}
                    </span>
                    <span className="flex-1">{s.title}</span>
                    <span className={`text-xs ${n === 0 ? 'text-success' : 'text-warning'}`}>{n === 0 ? 'Complete' : `${n} to fix`}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-fg-muted">↑/↓ move between steps.</p>
        </nav>

        <section aria-labelledby="studio-step-title" className="card min-w-0 p-5">
          <h2 id="studio-step-title" className="text-lg font-semibold">
            {STUDIO_STEP_IDS.indexOf(step) + 1}. {current.title}
          </h2>
          {step !== 'confirm' && problems[step].length > 0 && (
            <ul aria-label="Still to do in this step" className="mt-3 list-disc rounded-md border border-warning p-3 pl-7 text-sm">
              {problems[step].map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="mt-4">
            {stepBody()}
          </div>
          <div className="mt-6 flex justify-between">
            <button type="button" className="btn btn-secondary" disabled={step === STUDIO_STEP_IDS[0]} onClick={() => setStep(STUDIO_STEP_IDS[STUDIO_STEP_IDS.indexOf(step) - 1]!)}>
              ← Back
            </button>
            {step !== 'confirm' && (
              <button type="button" className="btn btn-primary" onClick={() => setStep(STUDIO_STEP_IDS[STUDIO_STEP_IDS.indexOf(step) + 1]!)}>
                Next →
              </button>
            )}
          </div>
        </section>

        <aside className="space-y-4" aria-label="Task JSON and storage">
          <JsonPreview text={previewText} answersText={stableJson(value)} fileName={`${committed?.externalTaskId ?? config.studioKey}.task.json`} stored={committed !== null} />
          <DbMetadata config={config} committed={committed} />
          <OwnTasks tasks={tasks} />
        </aside>
      </div>
    </div>
  );
}

function TextControl({ label, value, onChange, multiline, required, disabled }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; required?: boolean; disabled?: boolean }) {
  const id = `studio-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
        {required && <span aria-hidden className="text-error"> *</span>}
      </label>
      {multiline ? (
        <textarea id={id} rows={4} required={required} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      ) : (
        <input id={id} required={required} aria-required={required} disabled={disabled} value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="btn btn-secondary !px-2 !py-0.5 text-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** S4-01: status, preserved URL, project and SME identity, from the deployment record. */
export function StudioHeader({ config, studioUrl, smeLabel, committed, save }: { config: StudioConfig; studioUrl: string; smeLabel: string; committed: CommitResult | null; save?: React.ReactNode }) {
  const running = config.deploymentStatus === 'ACTIVE';
  return (
    <header className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{config.workflowName}</h1>
        <p className="text-fg-muted">
          SME Studio · template v{config.templateVersion}
        </p>
      </div>
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <div>
          <dt className="text-xs text-fg-muted">Status</dt>
          <dd>
            <span className={`pill ${running ? 'pill-success' : 'pill-error'}`}>{running ? 'Running' : config.deploymentStatus === 'STOPPED' ? 'Stopped' : 'Failed'}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Studio URL</dt>
          <dd className="flex items-center gap-2">
            <code className="max-w-72 truncate" title={studioUrl}>{studioUrl}</code>
            <CopyButton text={studioUrl} label="Copy studio URL" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Project</dt>
          <dd>{config.projectName}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">SME</dt>
          <dd>{smeLabel}</dd>
        </div>
      </dl>
      <div className="ml-auto">{committed ? <span className="pill pill-success">Submitted for review</span> : save}</div>
    </header>
  );
}

function JsonPreview({ text, answersText, fileName, stored }: { text: string; answersText: string; fileName: string; stored: boolean }) {
  const [tab, setTab] = useState<'task' | 'answers'>('task');
  const shown = tab === 'task' ? text : answersText;
  const download = () => {
    const url = URL.createObjectURL(new Blob([shown], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = tab === 'task' ? fileName : fileName.replace('.task.json', '.answers.json');
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-labelledby="json-preview-title" className="card p-4">
      <div className="flex items-center gap-2">
        <h2 id="json-preview-title" className="font-semibold">Live JSON</h2>
        <span className="ml-auto flex gap-1">
          <CopyButton text={shown} label="Copy JSON" />
          <button type="button" onClick={download} className="btn btn-secondary !px-2 !py-0.5 text-xs">
            Download
          </button>
        </span>
      </div>
      <div role="group" aria-label="JSON view" className="mt-2 flex gap-1 text-xs">
        <button type="button" className="chip" aria-pressed={tab === 'task'} onClick={() => setTab('task')}>
          task.json{stored ? ' (stored)' : ' (preview)'}
        </button>
        <button type="button" className="chip" aria-pressed={tab === 'answers'} onClick={() => setTab('answers')}>
          Saved answers
        </button>
      </div>
      <pre tabIndex={0} aria-label={tab === 'task' ? 'task.json' : 'Saved answers JSON'} className="mt-2 max-h-96 overflow-auto rounded-md bg-surface p-3 font-mono text-xs" data-testid="json-preview">
        {shown}
      </pre>
    </section>
  );
}

/** S4-09: where the task lives. Never a connection string or secret. */
export function DbMetadata({ config, committed }: { config: StudioConfig; committed: CommitResult | null }) {
  const rows: Array<[string, string]> = [
    ['Database', 'PostgreSQL · Praxis task store'],
    ['Task ID', committed?.externalTaskId ?? config.taskInstanceId],
    ['Configuration', `${config.deploymentStatus === 'ACTIVE' ? 'Deployed' : config.deploymentStatus} · template v${config.templateVersion} · ${committed ? 'committed' : `draft revision ${config.revision}`}`],
    ['Repository path', committed ? `tasks/${committed.externalTaskId}/ (bundle sha256 ${committed.bundleSha256.slice(0, 12)}…)` : 'Assigned when you commit'],
  ];
  return (
    <section aria-labelledby="db-meta-title" className="card p-4 text-sm">
      <h2 id="db-meta-title" className="font-semibold">Database</h2>
      <dl className="mt-2 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-fg-muted">{k}</dt>
            <dd className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate" title={v}>{v}</code>
              <CopyButton text={v} label={`Copy ${k}`} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OwnTasks({ tasks }: { tasks: SmeAuthoredTaskDto[] }) {
  if (tasks.length === 0) return null;
  return (
    <section aria-labelledby="own-tasks-title" className="card p-4 text-sm">
      <h2 id="own-tasks-title" className="font-semibold">Your committed tasks</h2>
      <ul className="mt-2 divide-y divide-hairline">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <code>{t.externalTaskId}</code>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <span className="pill">{reviewLabel(t.reviewStatus)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
