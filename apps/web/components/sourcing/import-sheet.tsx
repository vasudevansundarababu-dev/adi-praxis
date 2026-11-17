'use client';

import type { SourcedRole, SourcingImportResult, SourcingProjectDto } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useState } from 'react';
import { ClientPager } from '@/components/pager';
import { Req } from '@/components/required';
import { upload } from '@/lib/client-api';
import { projectsForRole } from './new-person-form';
import { ROLE_LABEL } from './sourcing-list';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';
const TH = 'px-3 py-2 font-medium';
const TD = 'px-3 py-2 align-top';

/** The preview of a dry run: one line per row, OK or its problems. */
export function ImportPreview({ result }: { result: SourcingImportResult }) {
  const paged = usePagedRows(result.rows);
  return (
    <>
    <div className="card mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-fg-muted">
          <tr>
            <th className={TH}>Row</th>
            <th className={TH}>First name</th>
            <th className={TH}>Last name</th>
            <th className={TH}>Email</th>
            <th className={TH}>Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {paged.items.map((r) => (
            <tr key={r.row}>
              <td className={`${TD} font-mono text-xs tabular-nums`}>{r.row}</td>
              <td className={TD}>{r.firstName || '—'}</td>
              <td className={TD}>{r.lastName || '—'}</td>
              <td className={TD}>{r.email || '—'}</td>
              <td className={TD}>{r.ok ? <span className="pill pill-success">OK</span> : <span className="text-error">{r.problems.join(' ')}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <ClientPager paged={paged} noun="rows" singular="row" />
    </>
  );
}

export function ImportSheet({ projects, role, initialProjectId = '' }: { projects: SourcingProjectDto[]; role: SourcedRole; initialProjectId?: string }) {
  const router = useRouter();
  const options = projectsForRole(projects, role);
  const [projectId, setProjectId] = useState(options.some((p) => p.id === initialProjectId) ? initialProjectId : '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SourcingImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const back = role === 'REVIEWER' ? '/sourcing?tab=REVIEWER' : '/sourcing';

  async function send(dryRun: boolean) {
    setError(null);
    if (!projectId) return setError('Choose a project.');
    if (!file) return setError('Choose the filled assessment sheet (.xlsx).');
    if (!/\.xlsx$/i.test(file.name)) return setError('Upload the assessment sheet as Excel (.xlsx).');
    const form = new FormData();
    form.append('projectId', projectId);
    form.append('role', role);
    form.append('file', file);
    setPending(true);
    const res = await upload<SourcingImportResult>(`/sourcing/people/import?dryRun=${dryRun ? 1 : 0}`, form);
    setPending(false);
    if (!res.ok) return setError(res.error);
    if (dryRun) return setPreview(res.data);
    router.push(back);
    router.refresh();
  }

  return (
    <div className="max-w-4xl">
      <div className="card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="imp-project" className="block text-sm font-medium">
              Project
              <Req />
            </label>
            <select
              id="imp-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPreview(null);
              }}
              className={input}
              required
            >
              <option value="">Choose a project…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="imp-file" className="block text-sm font-medium">
              Filled assessment sheet (.xlsx, up to 10 MB)
              <Req />
            </label>
            <input
              id="imp-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
              className="mt-1 w-full text-sm"
              required
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Use the sheet from the project&apos;s Export to Recruiter. Each valid row becomes one {ROLE_LABEL[role]} profile; the sheet is kept with each profile. Content is
          accepted in good faith.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send(true)}>
            Check the sheet
          </button>
          {preview && (
            <button type="button" className="btn btn-primary" disabled={pending || preview.valid === 0} onClick={() => send(false)}>
              Import {preview.valid} valid {preview.valid === 1 ? 'row' : 'rows'}
            </button>
          )}
          <Link href={back} className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </div>
      {preview && (
        <>
          <p className="mt-4 text-sm" aria-live="polite">
            {preview.valid} of {preview.rows.length} rows can be imported.{preview.valid < preview.rows.length ? ' Rows with problems are skipped.' : ''}
          </p>
          <ImportPreview result={preview} />
        </>
      )}
    </div>
  );
}
