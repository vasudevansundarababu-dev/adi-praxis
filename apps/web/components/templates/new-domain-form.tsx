'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req, RequiredNote } from '@/components/required';

export function NewDomainForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await mutate('POST', '/domains', { name });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setName('');
    setError(null);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 flex flex-wrap items-end gap-3 border-t border-line pt-6">
      <RequiredNote className="w-full" />
      <div>
        <label htmlFor="domain-name" className="block text-sm font-medium">
          Add a domain
          <Req />
        </label>
        <input
          id="domain-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 rounded-md border border-line bg-surface px-3 py-2"
        />
      </div>
      <button type="submit" disabled={pending || !name.trim()} className="btn btn-secondary disabled:opacity-60">
        Add domain
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-error">
          {error}
        </p>
      )}
    </form>
  );
}
