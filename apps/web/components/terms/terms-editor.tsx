'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req, RequiredNote } from '@/components/required';

export type TermsItem = { key: string; current: { id: string; title: string; version: number; placeholder: boolean; body: string } | null };

export function TermsEditor({ items }: { items: TermsItem[] }) {
  return (
    <ul className="mt-6 space-y-4">
      {items.map((i) => (
        <TermsDoc key={i.key} item={i} />
      ))}
    </ul>
  );
}

function TermsDoc({ item }: { item: TermsItem }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.current?.title ?? '');
  const [body, setBody] = useState(item.current?.placeholder ? '' : (item.current?.body ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const c = item.current;
  return (
    <li className="card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{c?.title ?? item.key}</h2>
        {c && <span className="text-fg-muted">v{c.version}</span>}
        {c?.placeholder && <span className="rounded-full border border-warning px-2 text-xs text-warning">Placeholder</span>}
        <button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing} className="ml-auto text-link">
          Publish new version
        </button>
      </div>
      {c && !editing && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-fg-muted">{c.body}</p>}
      {editing && (
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const res = await mutate('POST', '/terms', { key: item.key, title, body });
            setPending(false);
            if (!res.ok) return setError(res.error);
            setEditing(false);
            router.refresh();
          }}
        >
          <RequiredNote />
          <label className="block">
            Title
            <Req />
            <input required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="block">
            Approved text
            <Req />
            <textarea required minLength={20} value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <button type="submit" disabled={pending} className="btn btn-primary disabled:opacity-50">
            Publish version {(c?.version ?? 0) + 1}
          </button>
          {error && <p role="alert" className="text-error">{error}</p>}
        </form>
      )}
    </li>
  );
}
