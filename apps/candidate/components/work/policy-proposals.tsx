'use client';

import { CATEGORY_LABELS, POLICY_PROPOSAL_CATEGORIES } from '@praxis/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, upload } from '@/lib/client';

export interface MyProposal {
  id: string;
  title: string;
  category: (typeof POLICY_PROPOSAL_CATEGORIES)[number];
  fileName: string;
  status: 'PENDING' | 'ACCEPTED' | 'RETURNED' | 'REJECTED';
  flags: Array<{ code: string; message: string }>;
  decisionReason: string | null;
  createdAt: string;
}

const STATUS_TEXT: Record<MyProposal['status'], string> = {
  PENDING: 'Waiting for review',
  ACCEPTED: 'Accepted: its rules will be reviewed and published by the project',
  RETURNED: 'Returned to you',
  REJECTED: 'Not accepted',
};

/**
 * Wave 3 (handover chapter 07): propose a policy document the task needs. It is not used until an Expert or the PM
 * accepts it and its rules are reviewed and published; the SME never sees other SMEs' proposals.
 */
export function PolicyProposals({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const [items, setItems] = useState<MyProposal[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<MyProposal['category']>('BANK_POLICY');
  const [issuer, setIssuer] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [rights, setRights] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await call<{ items: MyProposal[] }>('GET', `/me/tasks/${taskId}/policy-proposals`);
    if (r.ok && r.data) setItems(r.data.items);
  }, [taskId]);
  useEffect(() => void load(), [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setPending(true);
    setMessage(null);
    const fd = new FormData();
    // Fields before the file: the server reads them from the stream first.
    fd.append('title', title || file.name);
    fd.append('category', category);
    if (issuer) fd.append('issuer', issuer);
    if (versionLabel) fd.append('versionLabel', versionLabel);
    if (effectiveFrom) fd.append('effectiveFrom', effectiveFrom);
    fd.append('reason', reason);
    fd.append('rightsDeclared', String(rights));
    fd.append('file', file);
    const r = await upload<MyProposal & { created: boolean }>(`/me/tasks/${taskId}/policy-proposals`, fd);
    setPending(false);
    if (!r.ok || !r.data) return setMessage({ kind: 'error', text: r.error ?? 'Upload failed.' });
    setMessage({ kind: 'ok', text: r.data.created ? 'Sent for review. You can keep working on your task.' : 'You already proposed this file; it is still waiting for review.' });
    setFile(null);
    setTitle('');
    setReason('');
    setRights(false);
    if (fileRef.current) fileRef.current.value = '';
    await load();
  }

  return (
    <details className="mb-6 rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Propose a policy document <span className="font-normal text-fg-muted">({items.length} proposed)</span>
      </summary>
      <div className="space-y-4 px-4 pb-4 text-sm">
        <p className="text-fg-muted">
          If your task needs a bank or customer policy the project does not have, propose it here. It is not used until an Expert or the project manager accepts it and its rules are reviewed and published. Use a synthetic document: never upload real customer or employer data.
        </p>
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded border border-line" aria-label="Your proposals">
            {items.map((p) => (
              <li key={p.id} className="p-3">
                <p className="font-medium">
                  {p.title} <span className="font-normal text-fg-muted">· {CATEGORY_LABELS[p.category]} · {p.fileName}</span>
                </p>
                <p>{STATUS_TEXT[p.status]}</p>
                {p.decisionReason && <p className="text-fg-muted">Reviewer: {p.decisionReason}</p>}
                {p.status === 'PENDING' && p.flags.length > 0 && <p className="text-xs text-warning">The reviewer will check: {p.flags.map((f) => f.message).join(' ')}</p>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void send(e)}>
            <label className="sm:col-span-2">
              <span className="font-medium">File (PDF, Word, text or Markdown, up to 10 MB)</span>
              <input ref={fileRef} type="file" required accept=".pdf,.docx,.txt,.md" className="mt-1 block" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <label>
              <span className="font-medium">Title</span>
              <input className="mt-1 block w-full rounded border border-line p-1" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" />
            </label>
            <label>
              <span className="font-medium">What kind of document?</span>
              <select className="mt-1 block w-full rounded border border-line p-1" value={category} onChange={(e) => setCategory(e.target.value as MyProposal['category'])}>
                {POLICY_PROPOSAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="font-medium">Issuer (optional)</span>
              <input className="mt-1 block w-full rounded border border-line p-1" value={issuer} maxLength={200} onChange={(e) => setIssuer(e.target.value)} />
            </label>
            <label>
              <span className="font-medium">Version (optional)</span>
              <input className="mt-1 block w-full rounded border border-line p-1" value={versionLabel} maxLength={60} onChange={(e) => setVersionLabel(e.target.value)} />
            </label>
            <label>
              <span className="font-medium">In force from (optional)</span>
              <input type="date" className="mt-1 block w-full rounded border border-line p-1" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </label>
            <label className="sm:col-span-2">
              <span className="font-medium">Why does your task need it?</span>
              <textarea className="mt-1 block w-full rounded border border-line p-2" rows={2} required minLength={10} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="flex items-start gap-2 sm:col-span-2">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
              <span>This document is synthetic, or I am allowed to share it, and it contains no real customer or employer data.</span>
            </label>
            {message && (
              <p role={message.kind === 'error' ? 'alert' : 'status'} className={`sm:col-span-2 ${message.kind === 'error' ? 'text-danger' : ''}`}>
                {message.text}
              </p>
            )}
            <div className="sm:col-span-2">
              <button type="submit" disabled={pending || !file || !rights || reason.trim().length < 10} className="rounded bg-primary px-3 py-1.5 text-on-primary disabled:opacity-50">
                {pending ? 'Sending…' : 'Send for review'}
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
