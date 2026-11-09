'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { locatorText } from './locator';
import { RuleReview } from './rule-review';

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
}
export interface ExtractionData {
  profile: { id: string; label: string; provider: string; revision: number; source: string } | null;
  available: boolean;
  problems: string[];
  budget: { provider: string; ceilingUsd?: number | null; spentUsd?: number; usdPerPage?: number; exhausted?: boolean } | null;
  profiles?: Array<{ id: string; label: string; provider: string; enabled: boolean; isDefault: boolean; revision: number; problems: string[] }>;
  batches: Array<{ id: string; status: string; profileId: string; profileRevision: number; selectionSource: string; parentBatchId: string | null; createdAt: string; jobs: Job[] }>;
}
export interface RuleRow {
  ruleId: string;
  ruleKey: string;
  required: boolean;
  versionId: string;
  version: number;
  state: 'DRAFT' | 'NEEDS_DEFINITION' | 'REVIEWED' | 'EXCLUDED';
  contentHash: string;
  title: string;
  uncertainty: string[];
  sources: Array<{ document: string; documentVersion: number; locator: { page?: number | null; lineStart?: number | null; section?: string | null }; resolution: string }>;
}
export interface PreviewData {
  included: Array<{ ruleKey: string; version: number; title: string }>;
  excluded: Array<{ ruleKey: string; reason: string | null }>;
  blocking: string[];
  conflicts: Array<{ kind: string; message: string; ruleKeys: string[] }>;
  counts: Record<string, number>;
  latest: { id: string; version: number; digest: string } | null;
  affectedTasks: number;
}

const STATE_LABEL: Record<RuleRow['state'], string> = { DRAFT: 'Draft', NEEDS_DEFINITION: 'Needs definition', REVIEWED: 'Reviewed', EXCLUDED: 'Excluded' };
const STATE_CLASS: Record<RuleRow['state'], string> = { DRAFT: 'bg-bg', NEEDS_DEFINITION: 'bg-warning/15 text-warning', REVIEWED: 'bg-success/15 text-success', EXCLUDED: 'bg-bg text-fg-muted line-through' };
const JOB_LABEL: Record<string, string> = { QUEUED: 'Queued', PROCESSING: 'Processing', SUCCEEDED: 'Succeeded', PARTIAL: 'Partial — some output unreadable', FAILED: 'Failed', CANCELLED: 'Cancelled', UNCERTAIN: 'Uncertain — not resubmitted' };

function Message({ m }: { m: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!m) return null;
  return (
    <p role={m.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${m.kind === 'error' ? 'text-error' : 'text-success'}`}>
      {m.text}
    </p>
  );
}

export function PolicyWorkspace(props: { projectId: string; isAdmin: boolean; documents: DocumentsData; extraction: ExtractionData | null; rules: RuleRow[]; preview: PreviewData | null }) {
  const [selected, setSelected] = useState<string | null>(props.rules.find((r) => r.state !== 'REVIEWED' && r.state !== 'EXCLUDED')?.versionId ?? props.rules[0]?.versionId ?? null);
  return (
    <div className="mt-6 space-y-6">
      <Documents projectId={props.projectId} data={props.documents} />
      <Extraction projectId={props.projectId} isAdmin={props.isAdmin} data={props.extraction} documents={props.documents} />
      <section aria-labelledby="rules-h" className="card p-4">
        <h2 id="rules-h" className="font-semibold">
          Rules
        </h2>
        {props.rules.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No rules yet. Extract candidates from a document, or add a rule by hand from the review panel.</p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <ul aria-label="Rules" className="divide-y divide-line rounded border border-line text-sm">
              {props.rules.map((r) => (
                <li key={r.ruleId}>
                  <button type="button" onClick={() => setSelected(r.versionId)} aria-current={selected === r.versionId} className={`w-full p-2 text-left hover:bg-bg ${selected === r.versionId ? 'bg-bg' : ''}`}>
                    <span className="font-mono text-xs">{r.ruleKey}</span> <span className="text-xs text-fg-muted">v{r.version}</span>
                    {r.required && <span className="ml-1 text-xs text-fg-muted">· required</span>}
                    <span className="block">{r.title}</span>
                    <span className={`mt-1 inline-block rounded px-1.5 text-xs ${STATE_CLASS[r.state]}`}>{STATE_LABEL[r.state]}</span>
                    {r.sources[0] && <span className="ml-2 text-xs text-fg-muted">{r.sources[0].document} v{r.sources[0].documentVersion}, {locatorText(r.sources[0].locator)}</span>}
                    {r.uncertainty.length > 0 && <span className="ml-2 text-xs text-warning">{r.uncertainty.length} uncertain</span>}
                  </button>
                </li>
              ))}
            </ul>
            {selected ? <RuleReview key={selected} projectId={props.projectId} versionId={selected} /> : <p className="text-sm text-fg-muted">Choose a rule.</p>}
          </div>
        )}
      </section>
      <Publish projectId={props.projectId} preview={props.preview} />
    </div>
  );
}

function Documents({ projectId, data }: { projectId: string; data: DocumentsData }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [paste, setPaste] = useState({ open: false, title: '', text: '', granularity: 'line' });
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

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
            {data.items.map((d) => {
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

function Extraction({ projectId, isAdmin, data, documents }: { projectId: string; isAdmin: boolean; data: ExtractionData | null; documents: DocumentsData }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  if (!data) return null;
  const latest = documents.items.map((d) => ({ doc: d, v: d.versions[0]! }));

  async function run(parentBatchId?: string, versionIds = chosen) {
    setPending(true);
    const r = await mutate<{ batchId: string; created: boolean }>('POST', `/projects/${projectId}/policy/extraction`, { documentVersionIds: versionIds, ...(parentBatchId ? { parentBatchId } : {}) });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Extraction could not start.' });
    setMsg({ kind: 'ok', text: r.data!.created ? 'Extraction started. Refresh in a minute to see the result.' : 'This extraction already exists; showing its receipt.' });
    router.refresh();
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
      {isAdmin && data.budget && data.budget.ceilingUsd !== undefined && (
        <p className="mt-1 text-fg-muted">
          Budget ({data.budget.provider}): ${data.budget.spentUsd?.toFixed(2)} of {data.budget.ceilingUsd === null ? 'no limit set (live calls refused)' : `$${data.budget.ceilingUsd.toFixed(2)}`} used; estimate ${data.budget.usdPerPage?.toFixed(2)} per page.
        </p>
      )}
      {!isAdmin && data.budget?.exhausted && <p className="mt-1 text-warning">The extraction budget is used up. Use Paste text, or ask an Admin.</p>}
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
      {data.batches.length > 0 && (
        <table className="mt-4 w-full text-left">
          <caption className="text-left text-xs font-medium text-fg-muted">Receipts</caption>
          <thead className="text-xs text-fg-muted">
            <tr>
              <th className="py-1">Document</th>
              <th>Status</th>
              <th>Candidates</th>
              <th>Profile</th>
              {isAdmin && <th>Cost</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {data.batches.flatMap((b) =>
              b.jobs.map((j) => (
                <tr key={j.id} className="border-t border-line align-top">
                  <td className="py-1">
                    {j.document} v{j.documentVersion}
                    {b.parentBatchId && <span className="ml-1 text-xs text-fg-muted">(retry)</span>}
                  </td>
                  <td>
                    {JOB_LABEL[j.status] ?? j.status}
                    {j.error && <span className="block text-xs text-error">{j.error}</span>}
                  </td>
                  <td>{j.candidateCount}</td>
                  <td className="text-xs">
                    {b.profileId} r{b.profileRevision}
                  </td>
                  {isAdmin && <td className="text-xs">{j.actualUsd != null ? `$${j.actualUsd.toFixed(2)}` : j.estimatedUsd != null ? `≤ $${j.estimatedUsd.toFixed(2)} reserved` : '—'}</td>}
                  <td>
                    {['FAILED', 'UNCERTAIN', 'PARTIAL', 'CANCELLED'].includes(b.status) && (
                      <button type="button" className="text-link hover:underline disabled:opacity-50" disabled={pending || !data.available} onClick={() => run(b.id, b.jobs.map((x) => x.documentVersionId))}>
                        Retry as new attempt
                      </button>
                    )}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
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

function Publish({ projectId, preview }: { projectId: string; preview: PreviewData | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
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
        {preview.counts.REVIEWED ?? 0} reviewed · {preview.counts.DRAFT ?? 0} draft · {preview.counts.NEEDS_DEFINITION ?? 0} needs definition · {preview.counts.EXCLUDED ?? 0} excluded.
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
      {preview.excluded.length > 0 && <p className="text-fg-muted">Excluded: {preview.excluded.map((r) => `${r.ruleKey} (${r.reason ?? 'no reason'})`).join('; ')}</p>}
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
    </section>
  );
}
