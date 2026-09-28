'use client';

import { useState } from 'react';

/** A secret shown once, with a copy button. Only a hash (or an encrypted copy, for webhook signing) is kept. */
export function SecretOnce({ title, label, value, extra, onDone }: { title: string; label: string; value: string; extra?: React.ReactNode; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="rounded-md border border-warning p-4 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-fg-muted">Copy it now and store it safely. It will not be shown again; if you lose it, rotate or create a new one.</p>
      {extra}
      <p className="mt-3 text-xs font-medium tracking-wide text-fg-muted uppercase">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <code className="block min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 break-all">{value}</code>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button type="button" className="mt-3 text-link" onClick={onDone}>
        I have stored it — hide
      </button>
    </div>
  );
}
