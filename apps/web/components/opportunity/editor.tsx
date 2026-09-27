'use client';

import { CONTRIBUTION_ROLE_LABELS, CONTRIBUTION_ROLES, OpportunityCriteria, type ContributionRole, type OpportunityBrief, type QuestionPolicy } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export interface OwnerView {
  projectId: string;
  opportunityId: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  draft: { brief: OpportunityBrief; criteria: OpportunityCriteria };
  questionPolicy: QuestionPolicy;
  publishProblems: string[];
  versions: { version: number; publishedAt: string | null }[];
  documents: { id: string; filename: string; status: string; extractedText: string; confirmedText: string | null; createdAt: string }[];
}

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';
const LONG_FIELDS: [keyof OpportunityBrief, string, string][] = [
  ['summary', 'Summary', 'What the work is, in plain language.'],
  ['exampleOutputs', 'Example outputs', 'What a finished task looks like.'],
  ['whyLongHorizon', 'Why these tasks matter', 'Why multi-step tasks are used for RL training.'],
  ['timeCommitment', 'Time commitment', ''],
  ['complexity', 'Complexity and seniority expected', ''],
  ['confidentiality', 'Confidentiality and conflicts', 'Owner-approved requirements only. Never invent legal terms.'],
  ['onboardingSteps', 'Onboarding steps', 'Including any calibration, disclosed up front.'],
  ['whatWeWillAsk', 'What we will ask', 'Required: shown before candidates commit.'],
  ['doNotDisclose', 'What not to disclose', 'Required: e.g. no real customer data.'],
  ['fullDescription', 'Full description', 'Filled from a confirmed imported document, or typed here.'],
];

/** Owner side of FLOW2-SME C03: edit the brief and criteria, import a JD document, publish a version. */
export function OpportunityEditor({ initial, candidateAppUrl }: { initial: OwnerView; candidateAppUrl: string }) {
  const [view, setView] = useState(initial);
  const [brief, setBrief] = useState(initial.draft.brief);
  const [criteria, setCriteria] = useState(initial.draft.criteria);
  const [policy, setPolicy] = useState(initial.questionPolicy);
  /** undefined = unchanged, null = reset to the generated default, otherwise the edited policy. */
  const [policyEdit, setPolicyEdit] = useState<QuestionPolicy | null | undefined>(undefined);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; problems?: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingDoc = view.documents.find((d) => d.status === 'PENDING_REVIEW');
  const [docText, setDocText] = useState(pendingDoc?.extractedText ?? '');

  const apply = (v: OwnerView, text: string) => {
    setView(v);
    setBrief(v.draft.brief);
    setCriteria(v.draft.criteria);
    setPolicy(v.questionPolicy);
    setPolicyEdit(undefined);
    setDocText(v.documents.find((d) => d.status === 'PENDING_REVIEW')?.extractedText ?? '');
    setMessage({ kind: 'ok', text });
  };
  async function run(method: 'POST' | 'PUT', path: string, body: unknown, ok: string): Promise<boolean> {
    setPending(true);
    const res = await mutate<OwnerView>(method, path, body);
    setPending(false);
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error!, problems: res.problems });
      return false;
    }
    apply(res.data!, ok);
    return true;
  }
  const save = async (): Promise<boolean> => {
    const parsed = OpportunityCriteria.safeParse(criteria);
    if (!parsed.success) {
      setMessage({ kind: 'error', text: 'Fix the criteria first.', problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return false;
    }
    return run('PUT', `/projects/${view.projectId}/opportunity/draft`, { brief, criteria, ...(policyEdit !== undefined ? { questionPolicy: policyEdit } : {}) }, 'Draft saved.');
  };

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    setPending(true);
    const res = await fetch(`/api/v1/projects/${view.projectId}/opportunity/documents`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: form });
    setPending(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) return setMessage({ kind: 'error', text: body?.message ?? 'Upload failed' });
    apply(body as OwnerView, 'Document imported. Review the extracted text below before using it.');
  }

  const set = <K extends keyof OpportunityBrief>(k: K, v: OpportunityBrief[K]) => setBrief({ ...brief, [k]: v });
  const publicUrl = view.opportunityId ? `${candidateAppUrl}/opportunities/${view.opportunityId}` : null;

  return (
    <div className="max-w-3xl">
      <Link href={`/projects/${view.projectId}`} className="text-sm text-link hover:underline">
        ← Project
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Opportunity page</h1>
      <p className="mt-1 text-sm text-fg-muted">
        What candidates read before applying. Status: <strong>{view.status.toLowerCase()}</strong>
        {view.versions[0] ? ` · published v${view.versions[0].version}` : ''}
        {publicUrl && view.status !== 'DRAFT' && (
          <>
            {' · '}
            <a href={publicUrl} target="_blank" rel="noreferrer" className="text-link underline">
              View public page
            </a>
          </>
        )}
      </p>

      <section className="mt-6 rounded-md border border-line p-4">
        <h2 className="font-semibold">Import a JD document (optional)</h2>
        <p className="text-sm text-fg-muted">PDF or Word (.docx), up to 10 MB. The extracted text is shown for your review and is only used once you confirm it.</p>
        <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={pending || !!pendingDoc} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="mt-2 text-sm" aria-label="JD document" />
        {pendingDoc && (
          <div className="mt-4">
            <label htmlFor="doc-text" className="block text-sm font-medium">
              Extracted from {pendingDoc.filename}: check and correct before confirming
            </label>
            <textarea id="doc-text" rows={10} value={docText} onChange={(e) => setDocText(e.target.value)} className={`${input} font-mono text-xs`} />
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={pending} onClick={() => run('POST', `/projects/${view.projectId}/opportunity/documents/${pendingDoc.id}/confirm`, { text: docText }, 'Text confirmed and added to the full description.')} className="btn btn-primary">
                Confirm text
              </button>
              <button type="button" disabled={pending} onClick={() => run('POST', `/projects/${view.projectId}/opportunity/documents/${pendingDoc.id}/discard`, {}, 'Document discarded.')} className="btn btn-secondary">
                Discard
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {(['title', 'domain', 'specialty'] as const).map((k) => (
            <div key={k} className={k === 'title' ? 'sm:col-span-2' : ''}>
              <label htmlFor={`b-${k}`} className="block text-sm font-medium capitalize">
                {k}
              </label>
              <input id={`b-${k}`} value={brief[k]} onChange={(e) => set(k, e.target.value)} className={input} />
            </div>
          ))}
          <div>
            <label htmlFor="b-juris" className="block text-sm font-medium">
              Jurisdictions (comma separated)
            </label>
            <input id="b-juris" value={brief.jurisdictions.join(', ')} onChange={(e) => set('jurisdictions', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className={input} />
          </div>
          <div>
            <label htmlFor="b-langs" className="block text-sm font-medium">
              Languages of work (comma separated)
            </label>
            <input id="b-langs" value={brief.languages.join(', ')} onChange={(e) => set('languages', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className={input} />
          </div>
          <div>
            <label htmlFor="b-comp" className="block text-sm font-medium">
              Compensation (leave blank if not approved)
            </label>
            <input id="b-comp" value={brief.compensation ?? ''} onChange={(e) => set('compensation', e.target.value.trim() ? e.target.value : null)} className={input} />
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Contribution roles</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {CONTRIBUTION_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={brief.contributionRoles.includes(r)}
                  onChange={(e) => set('contributionRoles', e.target.checked ? [...brief.contributionRoles, r] : brief.contributionRoles.filter((x: ContributionRole) => x !== r))}
                />
                {CONTRIBUTION_ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
        {LONG_FIELDS.map(([k, label, hint]) => (
          <div key={k}>
            <label htmlFor={`b-${k}`} className="block text-sm font-medium">
              {label}
            </label>
            {hint && <p className="text-xs text-fg-muted">{hint}</p>}
            <textarea id={`b-${k}`} rows={k === 'fullDescription' ? 6 : 3} value={(brief[k] as string) ?? ''} onChange={(e) => set(k, e.target.value as never)} className={input} />
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Eligibility criteria</h2>
        <p className="text-sm text-fg-muted">Task-related and approved by a domain owner. The assistant never adds criteria.</p>
        <div className="mt-2 space-y-2">
          {criteria.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[8rem_1fr_8rem_auto]">
              <input aria-label="Criterion id" value={c.id} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
              <input aria-label="Criterion" value={c.text} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
              <select aria-label="Required or preferred" value={c.kind} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'REQUIRED' | 'PREFERRED' } : x)))} className="rounded-md border border-line bg-surface px-2 py-1 text-sm">
                <option value="REQUIRED">Required</option>
                <option value="PREFERRED">Preferred</option>
              </select>
              <button type="button" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} className="text-sm text-link">
                Remove
              </button>
              <input aria-label="Evidence expected" placeholder="Evidence expected (optional)" value={c.evidence} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, evidence: e.target.value } : x)))} className="rounded-md border border-line bg-surface px-2 py-1 text-sm sm:col-span-4" />
            </div>
          ))}
          <button type="button" onClick={() => setCriteria([...criteria, { id: `c-${criteria.length + 1}`, text: '', kind: 'REQUIRED', evidence: '', equivalence: '' }])} className="text-sm text-link">
            + Add criterion
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Questions candidates will be asked</h2>
        <p className="text-sm text-fg-muted">
          {policy.source === 'owner' ? 'Edited by you.' : 'Generated from the brief and criteria.'} The assistant asks one at a time and may only rephrase
          follow-ups; it cannot add questions or criteria. Each criterion keeps its own question when you publish.
        </p>
        <ol className="mt-2 space-y-2">
          {policy.questions.map((q, i) => {
            const update = (patch: Partial<typeof q>) => {
              const next = { ...policy, source: 'owner' as const, questions: policy.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) };
              setPolicy(next);
              setPolicyEdit(next);
            };
            return (
              <li key={q.id} className="rounded-md border border-line p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span>{i + 1}. {q.section}</span>
                  {q.criterionIds.length > 0 && <span>· criterion {q.criterionIds.join(', ')}</span>}
                  <label className="ml-auto flex items-center gap-1">
                    <input type="checkbox" checked={q.required} onChange={(e) => update({ required: e.target.checked })} /> Required
                  </label>
                  <button type="button" onClick={() => { const next = { ...policy, source: 'owner' as const, questions: policy.questions.filter((_, j) => j !== i) }; setPolicy(next); setPolicyEdit(next); }} className="text-link">
                    Remove
                  </button>
                </div>
                <textarea aria-label={`Question ${i + 1}`} rows={2} value={q.text} onChange={(e) => update({ text: e.target.value })} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
                <input aria-label={`Why we ask, question ${i + 1}`} placeholder="Why we ask" value={q.why} onChange={(e) => update({ why: e.target.value })} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs" />
              </li>
            );
          })}
        </ol>
        {policy.source === 'owner' && (
          <button type="button" onClick={() => { setPolicyEdit(null); setMessage({ kind: 'ok', text: 'Questions will reset to the generated default when you save.' }); }} className="mt-2 text-sm text-link">
            Reset to the generated questions
          </button>
        )}
      </section>

      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-6 rounded-md border p-3 text-sm ${message.kind === 'error' ? 'border-error' : 'border-success'}`}>
          <p className={message.kind === 'error' ? 'text-error' : 'text-success'}>{message.text}</p>
          {message.problems && <ul className="mt-1 list-disc pl-5">{message.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={save} className="btn btn-secondary">
          Save draft
        </button>
        {view.status !== 'CLOSED' && (
          <button type="button" disabled={pending} onClick={async () => { if (await save()) await run('POST', `/projects/${view.projectId}/opportunity/publish`, {}, 'Published. Candidates now see this version.'); }} className="btn btn-primary">
            Save and publish
          </button>
        )}
        {view.status === 'PUBLISHED' && (
          <button type="button" disabled={pending} onClick={() => run('POST', `/projects/${view.projectId}/opportunity/close`, {}, 'Closed to new applications.')} className="btn btn-secondary">
            Close to new applications
          </button>
        )}
      </div>
    </div>
  );
}
