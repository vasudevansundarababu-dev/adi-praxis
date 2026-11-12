'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

interface CheckResult {
  ok: boolean;
  problems: string[];
  examples: { name: string; problems: string[] }[];
  form: { profileId: string; workflowName: string; agentMode: string } | null;
}

/**
 * Upload a golden task pack (owner, 12 Nov 2026): one authoring form and its worked golden cases, as JSON. Check first
 * (nothing stored), then upload. Uploads are append-only; a changed form gets a new form ID.
 */
export function GoldenPackUpload() {
  const router = useRouter();
  const [pack, setPack] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ profileId: string; createdTemplateId?: string | null } | null>(null);
  const [pending, setPending] = useState(false);

  async function onFile(file: File | undefined) {
    setCheck(null);
    setDone(null);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 2_000_000) return setError('The pack is larger than 2 MB.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return setError('This file is not valid JSON.');
    }
    setPack(parsed);
    setPending(true);
    const res = await mutate<CheckResult>('POST', '/template-profiles/check', parsed);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setCheck(res.data!);
  }

  async function upload() {
    setPending(true);
    setError(null);
    const res = await mutate<{ profileId: string; createdTemplateId?: string | null }>('POST', '/template-profiles', pack);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setDone(res.data!);
    router.refresh();
  }

  return (
    <section aria-labelledby="upload-heading" className="mt-6 rounded-md border border-line p-4">
      <h2 id="upload-heading" className="text-lg font-semibold">
        Upload a golden task pack
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        A JSON file with <code>schemaVersion: &quot;praxis.golden_pack.v1&quot;</code>, a <code>source</code>, the authoring form (<code>profile</code>), optional worked
        cases (<code>examples</code>) and, for a new workflow, its <code>template</code>. Praxis checks everything before storing it.
      </p>
      <label className="mt-3 block text-sm font-medium" htmlFor="pack-file">
        Pack file
      </label>
      <input id="pack-file" type="file" accept="application/json,.json" className="mt-1 block text-sm" disabled={pending} onChange={(e) => void onFile(e.target.files?.[0])} />
      {pending && <p className="mt-2 text-sm text-fg-muted">Checking…</p>}
      {check && (
        <div className="mt-3 text-sm" role="status">
          {check.form && (
            <p>
              Form <strong>{check.form.profileId}</strong> for workflow <strong>{check.form.workflowName}</strong> ({check.form.agentMode === 'MULTI' ? 'multi-agent' : 'single agent'}) in {fileName}.
            </p>
          )}
          {check.examples.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {check.examples.map((e) => (
                <li key={e.name}>
                  {e.name}: {e.problems.length ? `${e.problems.length} problem${e.problems.length === 1 ? '' : 's'}` : 'passes every form check'}
                </li>
              ))}
            </ul>
          )}
          {check.ok ? (
            <button type="button" className="btn btn-primary mt-3 disabled:opacity-60" disabled={pending} onClick={() => void upload()}>
              Upload pack
            </button>
          ) : (
            <div className="mt-2">
              <p className="font-medium text-error">Fix these before uploading:</p>
              <ul className="mt-1 list-disc pl-5 text-error">
                {check.problems.slice(0, 30).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {done && (
        <p className="mt-3 text-sm" role="status">
          Uploaded form <strong>{done.profileId}</strong>.{' '}
          {done.createdTemplateId ? (
            <>
              A draft template was created for the new workflow: <Link href={`/templates/${done.createdTemplateId}`}>review and publish it</Link>.
            </>
          ) : (
            'Open the workflow, create a new version, choose this form under "Authoring form" and publish.'
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
