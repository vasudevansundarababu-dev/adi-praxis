'use client';

import { jurisdictionProblem } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * KYC Judgment v1 console gaps (b)–(d) (coordinator, 25 Nov 2026: the PM never needs API calls): each document's kind,
 * ISO jurisdiction and capture provenance; loading the environment's fact catalog (from the template's fact bindings);
 * exporting the policy library (C1), with each export's exact bytes to download.
 * D-090 (owner, 26 Nov 2026): every detail stays editable after upload, including the date the document is in force
 * from (rules without their own date take it); jurisdictions must be real ISO 3166 codes.
 */
export interface LibraryDocument {
  id: string;
  title: string;
  jurisdiction: string | null;
  libraryKind: string | null;
  captureSourceUrl: string | null;
  captureDownloadedOn: string | null;
  effectiveFrom?: string | null;
}
export interface LibraryExportRow {
  revision: number;
  exportId: string;
  sha256: string;
  rules: number;
  versions: number;
  at: string;
}

/** What C1 still needs from a document, in plain words (null when nothing). */
export function documentLibraryProblem(d: LibraryDocument): string | null {
  if (!d.libraryKind || !d.jurisdiction) return 'Set the kind (official text or bank policy) and an ISO jurisdiction such as US-CA.';
  const j = jurisdictionProblem(d.jurisdiction);
  if (j) return `${j} Set an ISO jurisdiction such as US or US-CA.`;
  if (d.libraryKind === 'official_text' && (!d.captureSourceUrl || !d.captureDownloadedOn)) return 'An official text needs where and when it was downloaded.';
  return null;
}

/** A document is ready for the library when C1 needs nothing more and it has an in-force date for its rules (D-090). */
export const documentReady = (d: LibraryDocument) => !documentLibraryProblem(d) && !!d.effectiveFrom;

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

function DocumentRow({ projectId, d }: { projectId: string; d: LibraryDocument }) {
  const router = useRouter();
  const [kind, setKind] = useState(d.libraryKind ?? '');
  const [jur, setJur] = useState(d.jurisdiction ?? '');
  const [url, setUrl] = useState(d.captureSourceUrl ?? '');
  const [on, setOn] = useState(day(d.captureDownloadedOn));
  const [from, setFrom] = useState(day(d.effectiveFrom));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const problem = documentLibraryProblem(d);
  const typed = jur.trim() ? jurisdictionProblem(jur.trim().toUpperCase()) : null;
  async function save() {
    setMsg(null);
    const body = { kind, ...(jur.trim() ? { jurisdiction: jur.trim() } : {}), ...(kind === 'official_text' ? { captureSourceUrl: url, captureDownloadedOn: on } : {}), effectiveFrom: from || null };
    const r = await mutate('PUT', `/projects/${projectId}/policy/documents/${d.id}/library`, body);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Not saved.' });
    setMsg({ kind: 'ok', text: 'Saved.' });
    router.refresh();
  }
  const id = (k: string) => `doc-${d.id}-${k}`;
  return (
    <li className="rounded border border-line p-3" data-document-ready={documentReady(d) ? 'yes' : 'no'}>
      <p className="font-medium">
        {d.title} {documentReady(d) ? <span className="ml-1 text-xs text-success">✓ Ready</span> : <span className="ml-1 text-xs text-warning">Not ready</span>}
      </p>
      {problem && <p className="text-sm text-warning">{problem}</p>}
      {!problem && !d.effectiveFrom && <p className="text-sm text-warning">No in-force date: rules from this document without their own date have none.</p>}
      <div className="mt-2 grid gap-2 md:grid-cols-5">
        <label htmlFor={id('kind')} className="flex flex-col text-sm">
          <span>Kind</span>
          <select id={id('kind')} className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Not set</option>
            <option value="official_text">Official text (statute or regulation)</option>
            <option value="bank_policy">Bank policy</option>
          </select>
        </label>
        <label htmlFor={id('jur')} className="flex flex-col text-sm">
          <span>Jurisdiction (US, US-CA)</span>
          <input id={id('jur')} className="input mt-1" value={jur} aria-describedby={typed ? id('jur-err') : undefined} onChange={(e) => setJur(e.target.value)} />
          {typed && (
            <span id={id('jur-err')} className="mt-1 text-xs text-warning">
              {typed}
            </span>
          )}
        </label>
        <label htmlFor={id('from')} className="flex flex-col text-sm">
          <span>In force from</span>
          <input id={id('from')} type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        {kind === 'official_text' && (
          <>
            <label htmlFor={id('url')} className="flex flex-col text-sm">
              <span>Downloaded from (URL)</span>
              <input id={id('url')} className="input mt-1" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label htmlFor={id('on')} className="flex flex-col text-sm">
              <span>Downloaded on</span>
              <input id={id('on')} type="date" className="input mt-1" value={on} onChange={(e) => setOn(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <button type="button" className="btn btn-secondary mt-2" disabled={!kind} onClick={() => void save()}>
        Save document details
      </button>
      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-1 text-sm ${msg.kind === 'error' ? 'text-error' : ''}`}>
          {msg.text}
        </p>
      )}
    </li>
  );
}

/** Each document's library details, editable at any time. */
export function DocumentDetailsList({ projectId, documents }: { projectId: string; documents: LibraryDocument[] }) {
  if (!documents.length) return <p className="mt-2 text-sm text-fg-muted">Upload a policy document first.</p>;
  return (
    <ul className="mt-2 space-y-2">
      {documents.map((d) => (
        <DocumentRow key={d.id} projectId={projectId} d={d} />
      ))}
    </ul>
  );
}

type Msg = { kind: 'ok' | 'error'; text: string; problems?: string[] } | null;
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  async function run(kind: string, path: string, ok: (d: Record<string, unknown>) => string) {
    setBusy(kind);
    setMsg(null);
    const r = await mutate<Record<string, unknown>>('POST', path, {});
    setBusy(null);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Something went wrong.', problems: r.problems });
    setMsg({ kind: 'ok', text: ok(r.data ?? {}) });
    router.refresh();
  }
  return { busy, msg, run };
}
function RunMessage({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.kind === 'error' ? 'text-error' : ''}`}>
      <p>{msg.text}</p>
      {msg.problems?.length ? (
        <ul className="ml-4 list-disc">
          {msg.problems.slice(0, 20).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
          {msg.problems.length > 20 && <li>…and {msg.problems.length - 20} more.</li>}
        </ul>
      ) : null}
    </div>
  );
}

/** Load the environment's fact catalog (the facts conditions are written over). */
export function LoadCatalogButton({ projectId, primary = false }: { projectId: string; primary?: boolean }) {
  const { busy, msg, run } = useRun();
  return (
    <>
      <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={!!busy} onClick={() => void run('catalog', `/projects/${projectId}/policy/fact-catalog/from-template`, () => 'Loaded the environment’s fact catalog.')}>
        {busy === 'catalog' ? 'Loading…' : 'Load the environment’s fact catalog'}
      </button>
      <RunMessage msg={msg} />
    </>
  );
}

/** Export the policy library (C1); the server refuses with the whole list of what is missing. */
export function ExportLibraryButton({ projectId, primary = true }: { projectId: string; primary?: boolean }) {
  const { busy, msg, run } = useRun();
  return (
    <>
      <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={!!busy} onClick={() => void run('export', `/projects/${projectId}/policy/library-exports`, (d) => (d.unchanged ? `Nothing changed since revision ${String(d.revision)}.` : `Exported revision ${String(d.revision)}.`))}>
        {busy === 'export' ? 'Exporting…' : 'Export policy library (C1)'}
      </button>
      <RunMessage msg={msg} />
    </>
  );
}

export function ExportList({ projectId, exports }: { projectId: string; exports: LibraryExportRow[] }) {
  if (!exports.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {exports.map((e) => (
        <li key={e.revision}>
          Revision {e.revision} · {e.rules} rules, {e.versions} versions · <span className="font-mono text-xs">{e.sha256.slice(0, 12)}…</span> ·{' '}
          <a className="text-link hover:underline" href={`/api/v1/projects/${projectId}/policy/library-exports/${e.revision}`} download>
            Download revision {e.revision}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The whole library setup in one section (projects that don't use the setup checklist). */
export function LibrarySetupPanel({ projectId, documents, catalog, exports }: { projectId: string; documents: LibraryDocument[]; catalog: { version: number | null; catalogId: string | null }; exports: LibraryExportRow[] }) {
  return (
    <section aria-labelledby="libsetup-h" className="mt-8 rounded-md border border-line p-4" data-library-setup>
      <h2 id="libsetup-h" className="text-lg font-semibold">
        Library setup
      </h2>
      <p className="text-sm text-fg-muted">The policy library the benchmark serves (C1): every approved rule, with its versions. Set each document’s details, load the environment’s facts, then export.</p>
      <h3 className="mt-3 font-medium">Documents</h3>
      <DocumentDetailsList projectId={projectId} documents={documents} />
      <h3 className="mt-4 font-medium">Facts</h3>
      <p className="text-sm">{catalog.version ? `Fact catalog: ${catalog.catalogId ?? 'project'} (version ${catalog.version}).` : 'No fact catalog yet: conditions can’t be checked.'}</p>
      {!catalog.version && (
        <div className="mt-2">
          <LoadCatalogButton projectId={projectId} />
        </div>
      )}
      <h3 className="mt-4 font-medium">Export</h3>
      <div className="mt-2">
        <ExportLibraryButton projectId={projectId} />
      </div>
      <ExportList projectId={projectId} exports={exports} />
    </section>
  );
}
