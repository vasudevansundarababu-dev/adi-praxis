'use client';

import { useState } from 'react';

/**
 * A temporary password an Admin just issued, shown once. The Admin passes it on through a password manager; the
 * person must choose their own password when they sign in.
 */
export function TemporaryPassword({ email, password, signInAt, onDone }: { email: string; password: string; signInAt: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="rounded-lg border-2 border-warning bg-surface p-4 text-sm">
      <p className="font-semibold">Temporary password for {email}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-bg px-3 py-1.5 font-mono text-base tracking-wide select-all">{password}</code>
        <button type="button" onClick={copy} className="btn btn-secondary">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-fg-muted">
        <li>Copy it now: it is not shown again. If it is lost, reset the password.</li>
        <li>Pass it on through your password manager (for example 1Password), never by email or chat.</li>
        <li>
          They sign in at <span className="font-mono">{signInAt}</span> and must choose their own password straight away.
        </li>
      </ul>
      <button type="button" onClick={onDone} className="mt-3 text-link underline">
        I have stored it — hide
      </button>
    </div>
  );
}
