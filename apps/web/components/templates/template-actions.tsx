'use client';

import { profilesForWorkflow, type TemplateDto } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/** Admin lifecycle actions: publish a draft, start a new version, retire a published workflow. */
export function TemplateActions({ template: t, hasDraft }: { template: TemplateDto; hasDraft: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  async function run(path: string, then?: (data: TemplateDto) => void) {
    setPending(true);
    setError(null);
    const res = await mutate<TemplateDto>('POST', path);
    setPending(false);
    if (!res.ok) return setError(res.error);
    if (then) then(res.data!);
    else router.refresh();
  }

  const btn = 'btn btn-secondary disabled:opacity-60';
  // Authoring form of this version (owner, 11 Nov 2026): a workflow may offer more than one, e.g. KYC v2 account opening.
  const forms = profilesForWorkflow(t.workflowName);
  const formLabel = (id: string | null) => {
    const p = id ? forms.find((f) => f.profileId === id) : forms[0];
    return p ? (p.handoverName ?? p.catalogWorkflowName) + (id ? '' : ' (default)') : id ? id : 'Default form';
  };
  return (
    <div className="mt-4">
      {forms.length > 1 && (
        <div className="mb-3 text-sm">
          {t.status === 'DRAFT' ? (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Authoring form</span>
              <select
                className="rounded-md border border-line bg-surface px-2 py-1"
                value={t.profileId ?? ''}
                disabled={pending}
                onChange={async (e) => {
                  setPending(true);
                  setError(null);
                  const res = await mutate<TemplateDto>('PATCH', `/templates/${t.id}`, { profileId: e.target.value || null });
                  setPending(false);
                  if (!res.ok) setError(res.error);
                  else router.refresh();
                }}
              >
                {forms.map((f, i) => (
                  <option key={f.profileId} value={i === 0 ? '' : f.profileId}>
                    {formLabel(i === 0 ? null : f.profileId)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              <span className="font-medium">Authoring form:</span> {formLabel(t.profileId)}
            </p>
          )}
          <p className="mt-1 text-xs text-fg-muted">Projects keep the form of the version they were created from.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {t.status === 'DRAFT' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(`/templates/${t.id}/publish`)}
            className="btn btn-primary disabled:opacity-60"
          >
            Publish
          </button>
        )}
        {t.status !== 'DRAFT' && !hasDraft && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(`/templates/${t.id}/versions`, (v) => router.push(`/templates/${v.id}`))}
            className={btn}
          >
            New version
          </button>
        )}
        {t.status === 'PUBLISHED' &&
          (confirmRetire ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(`/templates/${t.id}/retire`)} className={`${btn} border-error text-error`}>
                Confirm retire
              </button>
              <button type="button" onClick={() => setConfirmRetire(false)} className={btn}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRetire(true)} className={btn}>
              Retire
            </button>
          ))}
      </div>
      {t.status === 'DRAFT' && (
        <p className="mt-2 text-xs text-fg-muted">Save your changes before publishing. Published versions can’t be edited.</p>
      )}
      {confirmRetire && (
        <p className="mt-2 text-sm text-fg-muted">
          Retiring hides this workflow from new projects. Projects already using it keep their version.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
