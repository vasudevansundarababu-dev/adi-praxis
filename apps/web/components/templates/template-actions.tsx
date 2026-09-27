'use client';

import type { TemplateDto } from '@praxis/shared';
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
  return (
    <div className="mt-4">
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
