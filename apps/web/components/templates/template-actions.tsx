'use client';

import { profileForWorkflow, profilesForWorkflow, type TemplateDto } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/** An authoring form a template version may choose (built-in or uploaded golden task pack), from the API. */
export interface FormOption {
  profileId: string;
  name: string;
  source: 'builtin' | 'uploaded';
  isDefault: boolean;
}

/** Admin lifecycle actions: publish a draft, start a new version, retire a published workflow. */
export function TemplateActions({ template: t, hasDraft, forms: fromApi }: { template: TemplateDto; hasDraft: boolean; forms?: FormOption[] }) {
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
  // The API lists uploaded forms too; the built-in registry is the fallback. The workflow default comes first.
  const builtinDefault = profileForWorkflow(t.workflowName);
  const forms: FormOption[] = fromApi ?? profilesForWorkflow(t.workflowName).map((p) => ({ profileId: p.profileId, name: p.handoverName ?? p.catalogWorkflowName, source: 'builtin' as const, isDefault: builtinDefault.status === 'ok' && builtinDefault.profile.profileId === p.profileId }));
  const fallback = forms.find((f) => f.isDefault);
  const alternates = forms.filter((f) => !f.isDefault);
  const formLabel = (id: string | null) => {
    if (!id) return fallback ? `${fallback.name} (default)` : 'Default form';
    const p = forms.find((f) => f.profileId === id);
    return p ? p.name + (p.source === 'uploaded' ? ' (uploaded)' : '') : id;
  };
  return (
    <div className="mt-4">
      {alternates.length > 0 && (
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
                <option value="">{formLabel(null)}</option>
                {alternates.map((f) => (
                  <option key={f.profileId} value={f.profileId}>
                    {formLabel(f.profileId)}
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
