'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { locatorText } from './locator';

interface SnapshotRule {
  rule_key: string;
  rule_version_id: string;
  version: number;
  title: string;
  requirement: string;
  requirement_type: string;
  visibility: 'agent_visible' | 'evaluator_only';
  applicability_label: string;
  exceptions: { kind: string; items: Array<{ statement: string }> };
  evidence_needs: string[];
  sources: Array<{ sha256: string; quote: string; field: string; role: string; locator: { page?: number | null; lineStart?: number | null; lineEnd?: number | null; section?: string | null } }>;
}
interface Change {
  id: string;
  ruleVersionId: string;
  type: 'CLARIFICATION' | 'STRICTER' | 'EXEMPTION';
  requirement: string;
  reason: string;
}
export type TaskPolicyData =
  | { configured: false; anvil: string }
  | {
      configured: true;
      citations: Array<{ id: string; ruleVersionId: string; role: string; quote: string }>;
      ruleSet: { id: string; version: number; digest: string };
      rules: SnapshotRule[];
      changes: Change[];
      rubricVersion: string;
      effectiveDigest: string;
      snapshot: { id: string; version: number; digest: string; createdAt: string; current: boolean } | null;
      readiness: { published: boolean; sourcesComplete: boolean; anvil: string };
    };

const TYPE_LABEL = { CLARIFICATION: 'Clarification', STRICTER: 'Stricter constraint', EXEMPTION: 'Source-authorised exemption' } as const;

/** Task view (S1 T02–T12): inherited rules read-only, task changes, effective snapshot and readiness. */
export function TaskPolicy({ projectId, taskId, data }: { projectId: string; taskId: string; data: TaskPolicyData }) {
  const router = useRouter();
  const [form, setForm] = useState({ ruleVersionId: '', type: 'CLARIFICATION' as Change['type'], requirement: '', reason: '', exceptionIndex: '', sourceCitationId: '' });
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (!data.configured) {
    return (
      <div role="status" className="mt-4 card p-4 text-sm">
        <p>
          <strong>Policy: Not configured.</strong> This project has no published rule set, so this task has no inherited policy and nothing about it changes.
        </p>
        <Link href={`/projects/${projectId}/policy`} className="mt-2 inline-block text-link hover:underline">
          Set up project policy rules
        </Link>
      </div>
    );
  }
  const d = data;
  const selected = d.rules.find((r) => r.rule_version_id === form.ruleVersionId);
  const exemptionAllowed = selected?.exceptions.kind === 'listed' && selected.exceptions.items.length > 0;

  async function add() {
    setPending(true);
    const r = await mutate('POST', `/tasks/${taskId}/policy/changes`, { ruleVersionId: form.ruleVersionId, type: form.type, requirement: form.requirement, scope: {}, reason: form.reason, sourceCitationId: form.sourceCitationId || null, exceptionIndex: form.exceptionIndex === '' ? null : Number(form.exceptionIndex) });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not add the change.' });
    setMsg({ kind: 'ok', text: 'Change added. Publish a new snapshot to freeze it.' });
    setForm({ ...form, requirement: '', reason: '' });
    router.refresh();
  }
  async function remove(id: string) {
    const res = await fetch(`/api/v1/tasks/${taskId}/policy/changes/${id}`, { method: 'DELETE', headers: { 'idempotency-key': crypto.randomUUID() } });
    if (!res.ok) setMsg({ kind: 'error', text: 'Could not remove the change.' });
    router.refresh();
  }
  async function snapshot() {
    setPending(true);
    const r = await mutate<{ version: number; created: boolean }>('POST', `/tasks/${taskId}/policy/snapshot`, {});
    setPending(false);
    setMsg(r.ok ? { kind: 'ok', text: r.data!.created ? `Published snapshot version ${r.data!.version}.` : 'The current snapshot already matches; nothing changed.' } : { kind: 'error', text: r.error ?? 'Could not publish the snapshot.' });
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-6 text-sm">
      <section aria-label="Policy summary" className="card p-4">
        <p>
          Inherits <strong>project rule set v{d.ruleSet.version}</strong> · {d.rules.length} rule{d.rules.length === 1 ? '' : 's'} · {d.changes.length} task change{d.changes.length === 1 ? '' : 's'} · rubric {d.rubricVersion} (unchanged)
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-3">
          <li>Snapshot: {d.snapshot ? (d.snapshot.current ? `v${d.snapshot.version} published, up to date` : `v${d.snapshot.version} published, out of date`) : 'not published'}</li>
          <li>Sources: {d.readiness.sourcesComplete ? 'complete' : 'incomplete'}</li>
          <li>Anvil test: {d.readiness.anvil}</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={pending || !!d.snapshot?.current} onClick={snapshot} className="btn btn-primary disabled:opacity-50">
            Publish task snapshot
          </button>
          {d.snapshot && (
            <a href={`/api/v1/tasks/${taskId}/policy/snapshots/${d.snapshot.id}/export`} className="btn btn-secondary">
              Download policy sidecar (v{d.snapshot.version})
            </a>
          )}
        </div>
        <p className="mt-1 text-xs text-fg-muted">A new snapshot is also taken automatically whenever a new version of this task is submitted.</p>
        {msg && (
          <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 ${msg.kind === 'error' ? 'text-error' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
      </section>

      <section aria-labelledby="inh-h" className="card p-4">
        <h2 id="inh-h" className="font-semibold">
          Inherited rules (read-only)
        </h2>
        <ul className="mt-2 space-y-3">
          {d.rules.map((r) => (
            <li key={r.rule_version_id} className="rounded border border-line p-2">
              <p>
                <span className="font-mono text-xs">{r.rule_key}</span> v{r.version} — <strong>{r.title}</strong>
                {r.visibility === 'evaluator_only' && <span className="ml-2 rounded bg-bg px-1 text-xs">evaluator-only</span>}
              </p>
              <p>{r.requirement}</p>
              <p className="text-xs text-fg-muted">{r.applicability_label}</p>
              {r.evidence_needs.length > 0 && <p className="text-xs">Evidence: {r.evidence_needs.join(', ')}</p>}
              {r.sources[0] && (
                <blockquote className="mt-1 border-l-2 border-line pl-2 text-xs text-fg-muted">
                  “{r.sources[0].quote}” — {locatorText(r.sources[0].locator)}, sha {r.sources[0].sha256.slice(0, 8)}
                </blockquote>
              )}
              {d.changes
                .filter((c) => c.ruleVersionId === r.rule_version_id)
                .map((c) => (
                  <div key={c.id} className="mt-1 rounded bg-bg p-1 text-xs">
                    <strong>{TYPE_LABEL[c.type]}:</strong> {c.requirement} <span className="text-fg-muted">— {c.reason}</span>
                    <button type="button" onClick={() => remove(c.id)} className="ml-2 text-error hover:underline">
                      Remove
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="chg-h" className="card p-4">
        <h2 id="chg-h" className="font-semibold">
          Add a task change
        </h2>
        <div className="mt-2 grid max-w-2xl gap-2">
          <label className="flex flex-col">
            <span className="font-medium">Rule</span>
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={form.ruleVersionId} onChange={(e) => setForm({ ...form, ruleVersionId: e.target.value })}>
              <option value="">Choose a rule</option>
              {d.rules.map((r) => (
                <option key={r.rule_version_id} value={r.rule_version_id}>
                  {r.rule_key} — {r.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="font-medium">Type</span>
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Change['type'] })}>
              <option value="CLARIFICATION">Clarification</option>
              <option value="STRICTER">Stricter constraint</option>
              <option value="EXEMPTION" disabled={!exemptionAllowed}>
                Source-authorised exemption{selected && !exemptionAllowed ? ' (this rule defines no exception)' : ''}
              </option>
            </select>
          </label>
          {form.type === 'EXEMPTION' && selected && (
            <label className="flex flex-col">
              <span className="font-medium">Exception in the source</span>
              <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={form.exceptionIndex} onChange={(e) => setForm({ ...form, exceptionIndex: e.target.value })}>
                <option value="">Choose</option>
                {selected.exceptions.items.map((x, i) => (
                  <option key={x.statement} value={i}>
                    {x.statement}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col">
            <span className="font-medium">What changes for this task</span>
            <textarea className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} />
          </label>
          <label className="flex flex-col">
            <span className="font-medium">Reason</span>
            <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          {form.type !== 'CLARIFICATION' && (
            <label className="flex flex-col">
              <span className="font-medium">Policy source</span>
              <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={form.sourceCitationId} onChange={(e) => setForm({ ...form, sourceCitationId: e.target.value })}>
                <option value="">Choose the quote that supports this change</option>
                {d.citations
                  .filter((c) => (form.type === 'EXEMPTION' ? c.ruleVersionId === form.ruleVersionId && c.role === 'exception' : true))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {d.rules.find((r) => r.rule_version_id === c.ruleVersionId)?.rule_key}: “{c.quote.slice(0, 90)}”
                    </option>
                  ))}
              </select>
              <span className="text-xs text-fg-muted">{form.type === 'EXEMPTION' ? 'An exemption must cite the exception text of the same rule.' : 'Any quote from this project’s policy documents.'}</span>
            </label>
          )}
          <button type="button" disabled={pending || !form.ruleVersionId || !form.requirement.trim() || !form.reason.trim() || (form.type !== 'CLARIFICATION' && !form.sourceCitationId)} onClick={add} className="btn btn-primary w-fit disabled:opacity-50">
            Add change
          </button>
        </div>
      </section>
    </div>
  );
}
