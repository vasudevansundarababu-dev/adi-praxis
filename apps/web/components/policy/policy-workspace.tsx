'use client';

import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mutate } from '@/lib/client-api';
import { elapsed, isActive, pollExtraction, stageLabel } from './extraction-progress';
import { ClientPager } from '@/components/pager';
import { RulesTable } from './rules-table';
import type { AnnotatedRow } from './annotation-logic';
import { MARKING_LABEL, type AnnotationFlag, type MandatoryMarking } from '@praxis/shared';

export interface DocVersion {
  id: string;
  version: number;
  sha256: string;
  fileName: string;
  format: string;
  pageCount: number;
  pageCountMethod: string;
  locatorGranularity: string;
  origin: string;
  createdAt: string;
}
export interface DocumentsData {
  maxPages: number;
  items: Array<{ id: string; title: string; category: string | null; latestVersion: number; versions: DocVersion[] }>;
}
export interface Job {
  id: string;
  status: string;
  provider: string;
  documentVersionId: string;
  document: string;
  documentVersion: number;
  candidateCount: number;
  error: string | null;
  estimatedUsd?: number;
  actualUsd?: number | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  submitted?: boolean;
}
export interface ExtractionData {
  profile: { id: string; label: string; provider: string; revision: number; source: string } | null;
  available: boolean;
  problems: string[];
  /** D-089: a requested extraction no worker has taken within a minute. */
  workerMissing?: boolean;
  workerMessage?: string;
  budget: { provider: string; ceilingUsd?: number | null; spentUsd?: number; usdPerPage?: number; exhausted?: boolean } | null;
  profiles?: Array<{ id: string; label: string; provider: string; enabled: boolean; isDefault: boolean; revision: number; problems: string[] }>;
  batches: Array<{ id: string; status: string; profileId: string; profileRevision: number; selectionSource: string; parentBatchId: string | null; createdAt: string; jobs: Job[] }>;
}
export interface RuleRow extends AnnotatedRow {
  ruleId: string;
  ruleKey: string;
  required: boolean;
  versionId: string;
  version: number;
  state: 'DRAFT' | 'NEEDS_DEFINITION' | 'REVIEWED' | 'EXCLUDED';
  contentHash: string;
  title: string;
  uncertainty: string[];
  requirement: string;
  applied: boolean;
  documentIds: string[];
  evidence: { quote: string; resolution: string; document: string; documentVersion: number } | null;
  definitionProblems: string[];
  evidenceProblems: string[];
  sources: Array<{ document: string; documentVersion: number; locator: { page?: number | null; lineStart?: number | null; section?: string | null }; resolution: string }>;
}
export interface PreviewData {
  included: Array<{ ruleKey: string; version: number; title: string }>;
  excluded: Array<{ ruleKey: string; reason: string | null }>;
  notApplied?: Array<{ ruleKey: string; state: string; required: boolean; marking?: string | null }>;
  markingCounts?: Record<string, number>;
  annotationWarnings?: Array<{ ruleKey: string; flags: AnnotationFlag[] }>;
  blocking: string[];
  conflicts: Array<{ kind: string; message: string; ruleKeys: string[] }>;
  counts: Record<string, number>;
  latest: { id: string; version: number; digest: string } | null;
  affectedTasks: number;
}


function Message({ m }: { m: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!m) return null;
  return (
    <p role={m.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${m.kind === 'error' ? 'text-error' : 'text-success'}`}>
      {m.text}
    </p>
  );
}

export function PolicyWorkspace(props: { projectId: string; isAdmin: boolean; documents: DocumentsData; extraction: ExtractionData | null; rules: RuleRow[]; preview: PreviewData | null }) {
  return (
    <div className="mt-6 space-y-6">
      <Documents projectId={props.projectId} data={props.documents} />
      <Extraction projectId={props.projectId} isAdmin={props.isAdmin} data={props.extraction} documents={props.documents} />
      <section aria-labelledby="rules-h" className="card p-4">
        <h2 id="rules-h" className="font-semibold">
          Rules
        </h2>
        <p className="text-sm text-fg-muted">Choose a document, describe what the template needs, and tick the rules that apply. Your tick is the review: ticked rules go into the rule set when you publish.</p>
        <RulesTable projectId={props.projectId} documents={props.documents.items.map((d) => ({ id: d.id, title: d.title }))} rules={props.rules} />
      </section>
      <Publish projectId={props.projectId} preview={props.preview} />
    </div>
  );
}

export function Documents({ projectId, data }: { projectId: string; data: DocumentsData }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [paste, setPaste] = useState({ open: false, title: '', text: '', granularity: 'line' });
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const docsPaged = usePagedRows(data.items, { param: 'docsPage' });

  async function upload() {
    if (!file) return;
    const form = new FormData();
    form.append('title', title || file.name);
    if (documentId) form.append('documentId', documentId);
    form.append('file', file);
    setPending(true);
    const res = await fetch(`/api/v1/projects/${projectId}/policy/documents`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: form });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setMsg({ kind: 'error', text: body?.message ?? 'Upload failed.' });
    setMsg({ kind: 'ok', text: body.created ? `Added version ${body.version.version} (${body.version.pageCount} page${body.version.pageCount === 1 ? '' : 's'}).` : 'This exact file is already stored as a version; nothing changed.' });
    setFile(null);
    setTitle('');
    router.refresh();
  }

  async function savePaste() {
    setPending(true);
    const r = await mutate<{ version: DocVersion }>('POST', `/projects/${projectId}/policy/documents/text`, { title: paste.title, text: paste.text, granularity: paste.granularity, ...(documentId ? { documentId } : {}) });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not save the text.' });
    setMsg({ kind: 'ok', text: 'Text saved as a document version.' });
    setPaste({ open: false, title: '', text: '', granularity: 'line' });
    router.refresh();
  }

  return (
    <section aria-labelledby="docs-h" className="card p-4 text-sm">
      <h2 id="docs-h" className="font-semibold">
        Policy documents
      </h2>
      <p className="text-fg-muted">PDF, Word (.docx), plain text or Markdown, up to {data.maxPages} pages and 10 MB. Each upload is kept as an immutable version; a new upload never changes earlier versions.</p>
      {data.items.length > 0 && (
        <>
        <table className="mt-3 w-full text-left">
          <thead className="text-xs text-fg-muted">
            <tr>
              <th className="py-1">Document</th>
              <th>Latest version</th>
              <th>Pages</th>
              <th>SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {docsPaged.items.map((d) => {
              const v = d.versions[0]!;
              return (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-1">
                    {d.title}
                    {v.origin === 'SEED' && <span className="ml-1 rounded bg-bg px-1 text-xs">SEED — fictional</span>}
                  </td>
                  <td>
                    v{v.version} · {v.format.toUpperCase()} · <a className="text-link hover:underline" href={`/api/v1/projects/${projectId}/policy/document-versions/${v.id}/file`}>download</a>
                  </td>
                  <td>
                    {v.pageCount}
                    {v.pageCountMethod === 'text_estimate' && <span className="text-fg-muted"> (estimated)</span>}
                  </td>
                  <td className="font-mono text-xs" title={v.sha256}>
                    {v.sha256.slice(0, 12)}…
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ClientPager paged={docsPaged} noun="documents" singular="document" />
        </>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="font-medium">File</span>
          <input type="file" accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex flex-col">
          <span className="font-medium">Title</span>
          <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Uses the file name if empty" />
        </label>
        {data.items.length > 0 && (
          <label className="flex flex-col">
            <span className="font-medium">Add as</span>
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">A new document</option>
              {data.items.map((d) => (
                <option key={d.id} value={d.id}>
                  New version of “{d.title}”
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" disabled={!file || pending} onClick={upload} className="btn btn-primary disabled:opacity-50">
          Upload
        </button>
        <button type="button" onClick={() => setPaste({ ...paste, open: !paste.open })} className="btn btn-secondary" aria-expanded={paste.open}>
          Paste text
        </button>
      </div>
      {paste.open && (
        <div className="mt-3 grid gap-2">
          <label className="flex flex-col">
            <span className="font-medium">Title</span>
            <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
          </label>
          <label className="flex flex-col">
            <span className="font-medium">Policy text</span>
            <textarea className="rounded-md border border-line bg-surface px-2 py-1 text-fg min-h-40 font-mono text-xs" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
          </label>
          <label className="flex flex-col">
            <span className="font-medium">How should citations point into this text?</span>
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={paste.granularity} onChange={(e) => setPaste({ ...paste, granularity: e.target.value })}>
              <option value="line">By line number</option>
              <option value="section">By section name</option>
              <option value="none">No locator (quote only)</option>
            </select>
          </label>
          <button type="button" disabled={!paste.title.trim() || !paste.text.trim() || pending} onClick={savePaste} className="btn btn-primary w-fit disabled:opacity-50">
            Save text
          </button>
        </div>
      )}
      <Message m={msg} />
    </section>
  );
}

/** Keeps the receipts live while any job is queued or running (PRD PR-E15); refreshes the rules once all are done. */
function useLiveExtraction(projectId: string, initial: ExtractionData | null) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [kick, setKick] = useState(0);
  useEffect(() => setData(initial), [initial]);
  const active = !!data && isActive(data.batches.flatMap((b) => b.jobs));
  useEffect(() => {
    if (!active) return;
    const signal = { aborted: false };
    const tick = setInterval(() => setNow(Date.now()), 1000);
    void pollExtraction<ExtractionData>({
      signal,
      fetchOnce: async () => {
        const res = await fetch(`/api/v1/projects/${projectId}/policy/extraction`, { cache: 'no-store' });
        return res.ok ? ((await res.json()) as ExtractionData) : null;
      },
      onUpdate: setData,
      onDone: () => router.refresh(),
    }).finally(() => clearInterval(tick));
    return () => {
      signal.aborted = true;
      clearInterval(tick);
    };
  }, [active, kick, projectId, router]);
  return { data, active, now, restart: () => setKick((k) => k + 1) };
}

export function Extraction({ projectId, isAdmin, data: initial, documents }:{ projectId: string; isAdmin: boolean; data: ExtractionData | null; documents: DocumentsData }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const live = useLiveExtraction(projectId, initial);
  const data = live.data;
  const receipts = usePagedRows((data?.batches ?? []).flatMap((b) => b.jobs.map((j) => ({ b, j }))), { param: 'receiptsPage' });
  if (!data) return null;
  const latest = documents.items.map((d) => ({ doc: d, v: d.versions[0]! }));

  async function run(parentBatchId?: string, versionIds = chosen) {
    setPending(true);
    const r = await mutate<{ batchId: string; created: boolean }>('POST', `/projects/${projectId}/policy/extraction`, { documentVersionIds: versionIds, ...(parentBatchId ? { parentBatchId } : {}) });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Extraction could not start.' });
    setMsg({ kind: 'ok', text: r.data!.created ? 'Extraction started. Progress updates below; rules appear when it finishes.' : 'This extraction already exists; showing its receipt.' });
    router.refresh();
    live.restart();
  }

  async function setProfile(profileId: string) {
    const r = await mutate('PUT', `/projects/${projectId}/policy/extraction/profile`, { profileId });
    setMsg(r.ok ? { kind: 'ok', text: 'Extraction provider for this project updated.' } : { kind: 'error', text: r.error ?? 'Could not change the provider.' });
    router.refresh();
  }
  async function toggle(id: string, enabled: boolean) {
    const r = await mutate('PATCH', `/policy/extraction-profiles/${id}`, { enabled });
    if (!r.ok) setMsg({ kind: 'error', text: r.error ?? 'Could not change the profile.' });
    router.refresh();
  }

  return (
    <section aria-labelledby="ext-h" className="card p-4 text-sm">
      <h2 id="ext-h" className="font-semibold">
        Extract candidate rules
      </h2>
      <p>
        Provider: <strong>{data.profile?.label ?? 'none'}</strong> {data.profile && <span className="text-fg-muted">(revision {data.profile.revision}, set by {data.profile.source === 'project' ? 'this project' : 'the deployment default'})</span>}
      </p>
      {!data.available && (
        <div role="status" className="mt-2 rounded border border-warning/40 bg-warning/10 p-2">
          <strong>Not available.</strong> {data.problems.join(' ')} You can still add rules by hand from pasted text.
        </div>
      )}
      {/* D7 (owner, 15 Nov 2026): no cost or budget figures on project screens; spending moves to an Admin usage page. */}
      {data.budget?.exhausted && <p className="mt-1 text-warning">The extraction budget is used up. Use Paste text, or ask an Admin.</p>}
      {latest.length > 0 && (
        <fieldset className="mt-3" disabled={!data.available}>
          <legend className="font-medium">Documents to extract (latest versions)</legend>
          {latest.map(({ doc, v }) => (
            <label key={v.id} className="mr-4 inline-flex items-center gap-1">
              <input type="checkbox" checked={chosen.includes(v.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, v.id] : chosen.filter((x) => x !== v.id))} />
              {doc.title} v{v.version} ({v.pageCount} p)
            </label>
          ))}
          <button type="button" disabled={!chosen.length || pending || !data.available} onClick={() => run()} className="ml-2 btn btn-primary disabled:opacity-50">
            Extract candidates
          </button>
        </fieldset>
      )}
      <Message m={msg} />
      {live.active && !data.workerMissing && (
        <p role="status" aria-live="polite" className="mt-2 text-fg-muted">
          Extraction in progress — this page updates by itself.
        </p>
      )}
      {data.workerMissing && (
        <p role="alert" className="mt-2 text-warning">
          <strong>No worker is running.</strong> {data.workerMessage ?? 'The extraction has not started.'}
        </p>
      )}
      {receipts.total > 0 && (
        <>
        <table className="mt-4 w-full text-left">
          <caption className="text-left text-xs font-medium text-fg-muted">Receipts</caption>
          <thead className="text-xs text-fg-muted">
            <tr>
              <th className="py-1">Document</th>
              <th>Status</th>
              <th>Candidates</th>
              <th>Elapsed</th>
              <th>Profile</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {receipts.items.map(({ b, j }) => (
                <tr key={j.id} className="border-t border-line align-top">
                  <td className="py-1">
                    {j.document} v{j.documentVersion}
                    {b.parentBatchId && <span className="ml-1 text-xs text-fg-muted">(retry)</span>}
                  </td>
                  <td>
                    {stageLabel(j)}
                    {j.error && <span className="block text-xs text-error">{j.error}</span>}
                  </td>
                  <td>{j.candidateCount}</td>
                  <td className="text-xs">{elapsed(j, live.now) ?? '—'}</td>
                  <td className="text-xs">
                    {b.profileId} r{b.profileRevision}
                  </td>
                  <td>
                    {['FAILED', 'UNCERTAIN', 'PARTIAL', 'CANCELLED'].includes(b.status) && (
                      <button type="button" className="text-link hover:underline disabled:opacity-50" disabled={pending || !data.available} onClick={() => run(b.id, b.jobs.map((x) => x.documentVersionId))}>
                        Retry as new attempt
                      </button>
                    )}
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
        <ClientPager paged={receipts} noun="receipts" singular="receipt" />
        </>
      )}
      {isAdmin && data.profiles && (
        <details className="mt-4">
          <summary className="cursor-pointer font-medium">Admin: extraction profiles</summary>
          <ul className="mt-2 space-y-1">
            {data.profiles.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{p.id}</span> {p.label} {p.isDefault && <span className="text-xs text-fg-muted">(deployment default)</span>}
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => toggle(p.id, e.target.checked)} /> Enabled
                </label>
                <button type="button" className="text-link hover:underline" onClick={() => setProfile(p.id)}>
                  Use for this project
                </button>
                {p.problems.length > 0 && <span className="text-xs text-warning">{p.problems.join(' ')}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

interface PublishedSet {
  id: string;
  version: number;
  digest: string;
  ruleCount: number;
  createdAt: string;
  markingCounts?: Record<string, number>;
}

const markingText = (c: Record<string, number> | undefined) =>
  c && Object.keys(c).length
    ? Object.entries(c)
        .map(([m, n]) => `${m === 'not_annotated' ? 'Not annotated' : (MARKING_LABEL[m as MandatoryMarking] ?? m)} ${n}`)
        .join(' · ')
    : '—';

/** Published rule-set versions with their rules per marking (mockup step 6, approved 15 Nov 2026). */
export function PublishedVersions({ items }: { items: PublishedSet[] }) {
  const paged = usePagedRows(items, { param: 'versionsPage' });
  if (!items.length) return <p className="mt-3 text-fg-muted">No rule set published yet.</p>;
  return (
    <div className="mt-4">
      <h3 className="font-semibold">Published versions</h3>
      <table className="mt-1 w-full text-left">
        <thead className="text-xs text-fg-muted">
          <tr>
            <th className="py-1">Version</th>
            <th>Rules</th>
            <th>By marking</th>
            <th>Digest</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((s, i) => (
            <tr key={s.id} className="border-t border-line align-top">
              <td className="py-1 font-mono">
                v{s.version}
                {(paged.page - 1) * paged.pageSize + i > 0 && <span className="ml-1 text-xs text-fg-muted">(superseded)</span>}
              </td>
              <td>{s.ruleCount}</td>
              <td className="text-xs">{markingText(s.markingCounts)}</td>
              <td className="font-mono text-xs">{s.digest.slice(0, 8)}…</td>
              <td className="text-xs">{new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ClientPager paged={paged} noun="versions" singular="version" />
      <p className="mt-1 text-xs text-fg-muted">RL Gym reads the published set through the unchanged policy manifest. The annotations document (marking, applies when, why, links, provenance) is ready but proposed: it is not sent until RL Gym agrees to the versioned change.</p>
    </div>
  );
}

export function Publish({ projectId, preview }:{ projectId: string; preview: PreviewData | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [sets, setSets] = useState<PublishedSet[]>([]);
  const latestVersion = preview?.latest?.version ?? null;
  useEffect(() => {
    let stop = false;
    void fetch(`/api/v1/projects/${projectId}/policy/rule-sets`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: PublishedSet[] }) => !stop && setSets(d.items))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [projectId, latestVersion]);
  if (!preview) return null;
  async function publish() {
    setPending(true);
    const r = await mutate<{ version: number; created: boolean }>('POST', `/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: preview!.latest?.version ?? null });
    setPending(false);
    setMsg(r.ok ? { kind: 'ok', text: r.data!.created ? `Published rule set version ${r.data!.version}.` : 'Nothing changed since the last publication.' } : { kind: 'error', text: r.error ?? 'Publication failed.' });
    router.refresh();
  }
  return (
    <section aria-labelledby="pub-h" className="card p-4 text-sm">
      <h2 id="pub-h" className="font-semibold">
        Publish the project rule set
      </h2>
      <p className="text-fg-muted">
        {preview.counts.REVIEWED ?? 0} applied · {(preview.counts.DRAFT ?? 0) + (preview.counts.NEEDS_DEFINITION ?? 0)} not applied · {preview.counts.EXCLUDED ?? 0} excluded.
        {preview.latest ? ` Current published version: ${preview.latest.version}.` : ' Nothing published yet.'}
      </p>
      <label className="mt-2 inline-flex items-center gap-2">
        <input type="checkbox" checked readOnly aria-describedby="inherit-note" /> Apply to all project tasks
      </label>
      <p id="inherit-note" className="text-xs text-fg-muted">
        Release 1: every task in the project inherits the published set ({preview.affectedTasks} task{preview.affectedTasks === 1 ? '' : 's'} now). Tasks can add clarifications, stricter constraints or source-backed exemptions.
      </p>
      {preview.included.length > 0 && (
        <p className="mt-2">
          Included: {preview.included.map((r) => `${r.ruleKey} v${r.version}`).join(', ')}
        </p>
      )}
      {preview.notApplied && preview.notApplied.length > 0 && (
        <p className="text-fg-muted">
          Not applied (left out of the set): {preview.notApplied.length} rule{preview.notApplied.length === 1 ? '' : 's'}
          {preview.notApplied.some((r) => r.marking === 'mandatory' || r.marking === 'mandatory_when_applicable') && `, of which ${preview.notApplied.filter((r) => r.marking === 'mandatory' || r.marking === 'mandatory_when_applicable').length} marked Mandatory or Mandatory when applicable`}.
        </p>
      )}
      {preview.markingCounts && Object.keys(preview.markingCounts).length > 0 && (
        <p className="text-fg-muted">
          Applied by marking:{' '}
          {Object.entries(preview.markingCounts)
            .map(([m, n]) => `${m === 'not_annotated' ? 'Not annotated' : (MARKING_LABEL[m as MandatoryMarking] ?? m)} ${n}`)
            .join(' · ')}
        </p>
      )}
      {preview.annotationWarnings && preview.annotationWarnings.length > 0 && (
        <details className="mt-2 rounded border border-warning/40 bg-warning/5 p-2">
          <summary className="cursor-pointer">
            {preview.annotationWarnings.length} applied rule{preview.annotationWarnings.length === 1 ? ' has' : 's have'} annotation warnings (they do not block publishing and are exported as open issues)
          </summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {preview.annotationWarnings.map((w) => (
              <li key={w.ruleKey}>
                {w.ruleKey}: {w.flags.map((f) => f.message).join(' ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {preview.excluded.filter((r) => !preview.notApplied?.some((n) => n.ruleKey === r.ruleKey)).length > 0 && (
        <p className="text-fg-muted">
          Excluded: {preview.excluded.filter((r) => !preview.notApplied?.some((n) => n.ruleKey === r.ruleKey)).map((r) => `${r.ruleKey} (${r.reason ?? 'no reason'})`).join('; ')}
        </p>
      )}
      {preview.blocking.length > 0 && (
        <div role="status" className="mt-2 rounded border border-warning/40 bg-warning/10 p-2">
          <strong>Publication is blocked:</strong>
          <ul className="list-disc pl-5">
            {preview.blocking.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" disabled={pending || preview.blocking.length > 0} onClick={publish} className="mt-3 btn btn-primary disabled:opacity-50">
        Publish rule set
      </button>
      <Message m={msg} />
      <PublishedVersions items={sets} />
    </section>
  );
}
