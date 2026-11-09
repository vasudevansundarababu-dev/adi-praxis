'use client';

import type { GenerationRunDto, StudioDeploymentDto, VerificationRunDto } from '@praxis/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mcBrowser, type DeploymentTarget, type ModelsResponse } from '@/lib/mc/browser';
import { canDeploy, CHECK_LABELS, deployHint, gatesPassed, isRunning, modelChoices, modelKey, POLL_MS, usd } from '@/lib/mc/pipeline';

export interface PipelineProps {
  templateId: string;
  models: ModelsResponse;
  targets: DeploymentTarget[];
  deployments: StudioDeploymentDto[];
  initialGeneration: GenerationRunDto | null;
  initialVerification: VerificationRunDto | null;
}

/** Polls `load` every POLL_MS while `active`; stops on unmount. */
function usePoll<T>(active: boolean, load: () => Promise<T | null>, onData: (d: T) => void) {
  const cb = useRef(onData);
  cb.current = onData;
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (!stop && d) cb.current(d);
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [active, load]);
}

function keepInUrl(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(null, '', url.toString());
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="mt-1 h-2 overflow-hidden rounded-full bg-surface">
        <div className="h-full bg-[var(--praxis-focus)] transition-[width]" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string | undefined }) {
  const tone = status === 'SUCCEEDED' ? 'pill-success' : status === 'FAILED' || status === 'CAPPED' ? 'pill-error' : status ? 'pill-warning' : '';
  return <span className={`pill ${tone}`}>{status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Not started'}</span>;
}

const selectClass = 'mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm';

/** Screen 3: Generate (Step 1), Test & Verify Harbor (Step 2), Ready to Deploy (Step 3) (S3-01 to S3-09). */
export function Pipeline({ templateId, models, targets, deployments: initialDeployments, initialGeneration, initialVerification }: PipelineProps) {
  const choices = useMemo(() => modelChoices(models.items), [models.items]);
  const firstAvailable = choices.find((m) => m.available);
  const [model, setModel] = useState(initialGeneration ? modelKey(initialGeneration) : firstAvailable ? modelKey(firstAvailable) : '');
  const [gen, setGen] = useState<GenerationRunDto | null>(initialGeneration);
  const [ver, setVer] = useState<VerificationRunDto | null>(initialVerification);
  const [projectId, setProjectId] = useState('');
  const [smeId, setSmeId] = useState('');
  const [deployments, setDeployments] = useState(initialDeployments);
  const [deployed, setDeployed] = useState<StudioDeploymentDto | null>(null);
  const [busy, setBusy] = useState<'gen' | 'ver' | 'deploy' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const keys = useRef<Record<string, string>>({});
  const keyFor = (action: string) => (keys.current[action] ??= crypto.randomUUID());

  const genId = gen?.id;
  const verId = ver?.id;
  const loadGen = useMemo(() => async () => (genId ? (await mcBrowser.generation(genId)).data : null), [genId]);
  const loadVer = useMemo(() => async () => (verId ? (await mcBrowser.verification(verId)).data : null), [verId]);
  usePoll(isRunning(gen?.status), loadGen, setGen);
  usePoll(isRunning(ver?.status), loadVer, setVer);

  const selected = choices.find((m) => modelKey(m) === model);
  const project = targets.find((p) => p.id === projectId);

  async function generate() {
    if (!selected) return;
    setBusy('gen');
    setError(null);
    const r = await mcBrowser.startGeneration(templateId, selected.provider, selected.model, keyFor(`gen:${model}:${gen?.id ?? ''}`));
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error);
    setGen(r.data);
    setVer(null);
    keepInUrl({ run: r.data.id, ver: null });
  }

  async function verify() {
    if (!gen) return;
    setBusy('ver');
    setError(null);
    const r = await mcBrowser.startVerification(gen.id, keyFor(`ver:${gen.id}:${ver?.id ?? ''}`));
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error);
    setVer(r.data);
    keepInUrl({ ver: r.data.id });
  }

  async function deploy() {
    if (!ver || !canDeploy(ver, projectId, smeId)) return;
    setBusy('deploy');
    setError(null);
    const r = await mcBrowser.deploy(templateId, { verificationRunId: ver.id, projectId, smeCandidateId: smeId }, keyFor(`deploy:${ver.id}:${projectId}:${smeId}`));
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error);
    setDeployed(r.data);
    setCopied(false);
    const list = await mcBrowser.deployments(templateId);
    if (list.data) setDeployments(list.data.items);
  }

  const hint = deployHint(ver, projectId, smeId);
  const logs = [gen && `[compiler] ${gen.status.toLowerCase()}: ${gen.progress.message}${gen.error ? ` (${gen.error})` : ''}`, ver?.logTail].filter(Boolean).join('\n');
  const checks = ver?.checks ?? (Object.keys(CHECK_LABELS) as Array<keyof typeof CHECK_LABELS>).map((id) => ({ id, passed: null, value: null, evidence: null }));

  return (
    <div className="space-y-4">
      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-md border border-error p-3 text-sm text-error">
            {error}
          </p>
        )}
      </div>

      <section aria-labelledby="step1" className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="step1" className="text-lg font-semibold">
            Step 1 · Generate the studio
          </h2>
          <StatusPill status={gen?.status} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-72 text-sm font-medium">
            Code-generation model
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={isRunning(gen?.status)} className={selectClass}>
              {choices.map((m) => (
                <option key={modelKey(m)} value={modelKey(m)} disabled={!m.available}>
                  {m.label}
                  {m.available ? '' : ' (not available here)'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={!selected?.available || busy !== null || isRunning(gen?.status)} onClick={() => void generate()}>
            {gen ? 'Generate again' : 'Generate'}
          </button>
        </div>
        <p className="text-xs text-fg-muted">
          Credentials stay on the server: no key is ever sent to the browser.{' '}
          {models.liveAi ? 'Each run records its estimated cost before the paid call and stops at the cost cap.' : 'Live AI is off here, so runs use the local mock drafter at no cost.'} Blueprint mode builds the
          shared studio from the UISpec; the model drafts content only.
        </p>
        {gen && (
          <div className="space-y-2" data-testid="generation">
            <Progress label="UI compilation" value={gen.progress.ui} />
            <Progress label="Backend (persistence and MCP simulator)" value={gen.progress.backend} />
            <p className="text-sm">{gen.progress.message}</p>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 text-xs">
              <dt className="text-fg-muted">Model</dt>
              <dd>
                {gen.provider} · {gen.model}
              </dd>
              <dt className="text-fg-muted">Estimated cost</dt>
              <dd>{usd(gen.estimatedCostUsd)}</dd>
              <dt className="text-fg-muted">Actual cost</dt>
              <dd>{usd(gen.actualCostUsd)}</dd>
              <dt className="text-fg-muted">Output SHA-256</dt>
              <dd className="truncate font-mono">{gen.outputSha256 ?? '—'}</dd>
            </dl>
            {gen.error && <p className="text-sm text-error">{gen.error}</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="step2" className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="step2" className="text-lg font-semibold">
            Step 2 · Test the studio and verify Harbor
          </h2>
          <StatusPill status={ver?.status} />
          <button type="button" className="btn btn-secondary ml-auto !py-1.5 text-sm" disabled={gen?.status !== 'SUCCEEDED' || busy !== null || isRunning(ver?.status)} onClick={() => void verify()}>
            {ver ? 'Run checks again' : 'Run checks'}
          </button>
        </div>
        {gen?.status !== 'SUCCEEDED' && <p className="text-sm text-fg-muted">Step 2 starts after Step 1 succeeds.</p>}
        <ol className="grid gap-2 md:grid-cols-5" aria-label="Verification checks">
          {checks.map((c) => {
            const label = CHECK_LABELS[c.id];
            const state = c.passed === true ? 'Pass' : c.passed === false ? 'Fail' : ver && isRunning(ver.status) ? 'Running' : 'Pending';
            return (
              <li key={c.id} className={`rounded-md border p-3 text-sm ${c.passed === true ? 'border-success' : c.passed === false ? 'border-error' : 'border-line'}`} data-testid={`check-${c.id}`}>
                <p className="text-xs text-fg-muted">Check {c.id.slice(0, 2)}</p>
                <p className="font-medium">{label.title}</p>
                <p className={c.passed === true ? 'text-success' : c.passed === false ? 'text-error' : 'text-fg-muted'}>{state}</p>
                <p className="mt-1 font-mono text-xs">{c.value ?? `expect ${label.expect}`}</p>
                {c.evidence && <p className="mt-1 text-xs text-fg-muted">{c.evidence}</p>}
              </li>
            );
          })}
        </ol>
        {ver && (
          <p className="text-xs text-fg-muted">
            Zero-baseline score {ver.zeroBaselineScore?.toFixed(2) ?? '—'} · Oracle score {ver.oracleScore?.toFixed(2) ?? '—'} · Bundle SHA-256{' '}
            <span className="font-mono">{ver.bundleSha256?.slice(0, 16) ?? '—'}</span>
          </p>
        )}
        <div>
          <h3 className="text-sm font-medium">Logs</h3>
          <pre role="log" aria-label="Compiler and verifier logs" tabIndex={0} className="mt-1 max-h-56 overflow-auto rounded-md bg-surface p-3 font-mono text-xs" data-testid="logs">
            {logs || 'No logs yet.'}
          </pre>
          <p className="text-xs text-fg-muted">Updated every {POLL_MS / 1000} s while a step runs. Secrets and personal data are redacted on the server.</p>
        </div>
      </section>

      <section aria-labelledby="step3" className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="step3" className="text-lg font-semibold">
            Step 3 · Ready to deploy
          </h2>
          {gatesPassed(ver) ? <span className="pill pill-success">Gates passed</span> : <span className="pill">Gates not passed</span>}
        </div>
        {targets.length === 0 ? (
          <p className="text-sm text-fg-muted">No project uses this workflow yet. Create a project from this template first, then assign an SME.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-64 text-sm font-medium">
              Project
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setSmeId('');
                }}
                className={selectClass}
              >
                <option value="">Choose a project…</option>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (v{p.templateVersion})
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-64 text-sm font-medium">
              Assigned SME
              <select value={smeId} onChange={(e) => setSmeId(e.target.value)} disabled={!project} className={selectClass}>
                <option value="">{project && project.smes.length === 0 ? 'No SME assigned to this project' : 'Choose an SME…'}</option>
                {project?.smes.map((s) => (
                  <option key={s.candidateId} value={s.candidateId}>
                    {s.displayName ?? 'SME'}
                    {s.email ? ` · ${s.email}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={!canDeploy(ver, projectId, smeId) || busy !== null} aria-describedby={hint ? 'deploy-hint' : undefined} onClick={() => void deploy()}>
              Deploy studio
            </button>
            {hint && (
              <span id="deploy-hint" className="text-xs text-fg-muted">
                {hint}
              </span>
            )}
          </div>
        )}
        {deployed && (
          <div role="status" className="space-y-2 rounded-md border border-success p-3 text-sm" data-testid="deployed">
            <p className="font-medium">Studio deployed. The workflow is now Active in the directory.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="truncate">{deployed.studioUrl}</code>
              <button type="button" className="btn btn-secondary !px-2 !py-0.5 text-xs" onClick={() => void navigator.clipboard?.writeText(deployed.studioUrl).then(() => setCopied(true))}>
                {copied ? 'Copied' : 'Copy URL'}
              </button>
              <a href={deployed.studioUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary !px-3 !py-1 text-xs">
                Open studio<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
        )}
        {deployments.length > 0 && (
          <div>
            <h3 className="text-sm font-medium">Studios for this workflow</h3>
            <p className="text-xs text-fg-muted">A studio stays live until a newer generation passes Step 2 and is deployed to the same project and SME.</p>
            <ul className="mt-1 divide-y divide-hairline text-sm">
              {deployments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className={`pill ${d.status === 'ACTIVE' ? 'pill-success' : ''}`}>{d.status.charAt(0) + d.status.slice(1).toLowerCase()}</span>
                  <span>v{d.templateVersion}</span>
                  <span className="text-fg-muted">{targets.find((p) => p.id === d.projectId)?.name ?? d.projectId}</span>
                  <a href={d.studioUrl} target="_blank" rel="noopener noreferrer" className="ml-auto truncate text-link hover:underline">
                    {d.studioUrl}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
