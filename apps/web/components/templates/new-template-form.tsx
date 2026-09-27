'use client';

import type { DomainDto, TemplateDto } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export function NewTemplateForm({ domains }: { domains: DomainDto[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await mutate<TemplateDto>('POST', '/templates', {
      domainId: form.get('domainId'),
      workflowName: form.get('workflowName'),
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push(`/templates/${res.data!.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="domainId" className="block text-sm font-medium">
          Domain
        </label>
        <select id="domainId" name="domainId" required className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2">
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="workflowName" className="block text-sm font-medium">
          Workflow name
        </label>
        <input id="workflowName" name="workflowName" required className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 font-medium text-on-primary disabled:opacity-60">
        {pending ? 'Creating…' : 'Create draft'}
      </button>
    </form>
  );
}
