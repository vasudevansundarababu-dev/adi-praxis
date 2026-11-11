'use client';

import { exportStatusLine, KYC_SECTIONS, responseArguments, type ExportStatusView, type KycTask, type TaskCheck } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { TemplateInstructions } from './template-instructions';
import { Req, RequiredNote } from '@/components/required';
import { anchorOf, StageActions, StageSummary, type PinnedComment, type StageData } from './stage-review';

export interface TaskReviewData extends Partial<StageData> {
  id: string;
  status: string;
  revision: number;
  taskType: string;
  definition: string;
  project: { id: string; name: string; workflow: string; verificationCriteria: string | null; humanGate: string | null; tptMinutes: number | null };
  slot: { brief: string; isOpen: boolean; tags: Record<string, string>; edgeCase: string | null } | null;
  author: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  coverageTags: { tags: Record<string, string>; edgeCase: string | null } | null;
  coverageDimensions: { key: string; label: string; values: string[] }[];
  activeSeconds: number;
  reworkCount: number;
  checks: TaskCheck[];
  /** Anvil export readiness of a template-profile task, compiled at submission. */
  exportStatus?: ExportStatusView | null;
  flags: { id: string; kind: string; path: string; excerpt: string; explanation?: string }[];
  embeddingModel: string | null;
  similar: { taskId: string; embeddingScore: number; structuredScore: number; flagged: boolean; status: string | null; project: string | null; brief: string | null; text: string | null }[];
  text: string;
  versions: { version: number; submittedAt: string }[];
  previousOutput: Record<string, unknown> | null;
  reviews: { decision: string; comments: PinnedComment[]; notes: string | null; at: string; version: number; stage?: string | null }[];
  checklist: { key: string; label: string }[];
  /** M9: how the task was made (null for annotation tasks). */
  drafting: Drafting | null;
}

interface Drafting {
  authorship?: {mode:string;consent?:{version:string;at:string};declaration?:{revision:number;at:string};limitations:string} | null;
  sources: { id: string; kind: 'DOCUMENT' | 'TRANSCRIPT'; fileName: string; sizeBytes: number; sha256: string; textChars: number; flags: { kind: string; line: number; preview: string }[]; uploadedAt: string }[];
  interview: { turns: { id: string; speaker: string; questionId: string; content: string; redacted: boolean }[]; answered: number; total: number };
  runs: { id: string; section: string | null; status: string; sections: string[]; model: string | null; problems: string[]; notes: string | null; error: string | null; createdAt: string }[];
  sections: Record<string, { draftedAt: string; confirmedAt: string | null; editedAfterDraft: boolean }>;
}

/** TASK-DRAFTING section 6: sources (opening one is audited), the interview, drafts and what the author changed. */
function HowMade({ taskId, d }: { taskId: string; d: Drafting }) {
  const drafted = Object.entries(d.sections).sort(([a], [b]) => a.localeCompare(b));
  if (!d.authorship && !d.sources.length && !d.interview.answered && !d.runs.length) {
    return (
      <section aria-labelledby="made-h" className="card p-4 text-sm">
        <h2 id="made-h" className="font-semibold">How this task was made</h2>
        <p className="text-fg-muted">Written by hand in the workbench. No files, interview or AI draft.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="made-h" className="card space-y-3 p-4 text-sm">
      <h2 id="made-h" className="font-semibold">How this task was made</h2>
      {d.authorship && <section className="rounded border border-line p-3"><h3 className="font-semibold">Human-authorship review</h3><p>Consent: {d.authorship.consent ? `${d.authorship.consent.version} · ${d.authorship.consent.at}` : 'Missing'}</p><p>Own-work / no external LLM declaration: {d.authorship.declaration ? `Revision ${d.authorship.declaration.revision} · ${d.authorship.declaration.at}` : 'Missing'}</p><p className="text-xs text-fg-muted">{d.authorship.limitations} Compare flagged similarities and hear the author's explanation before deciding. No detector alone should determine rejection or payment.</p></section>}
      {drafted.length > 0 && (
        <div>
          <p className="font-medium">AI-drafted sections</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {drafted.map(([k, v]) => (
              <li key={k} className={`pill ${v.editedAfterDraft ? 'pill-info' : 'pill-warning'}`} title={`Drafted ${new Date(v.draftedAt).toLocaleString()}${v.confirmedAt ? `, confirmed ${new Date(v.confirmedAt).toLocaleString()}` : ''}`}>
                {k} {v.editedAfterDraft ? 'edited by the author' : 'unchanged from the draft'}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-fg-muted">Sections left unchanged from the draft deserve a closer look for realism and correctness.</p>
        </div>
      )}
      {d.sources.length > 0 && (
        <div>
          <p className="font-medium">Files the author drafted from</p>
          <ul className="mt-1 space-y-1">
            {d.sources.map((s) => (
              <li key={s.id}>
                <a href={`/api/v1/review/tasks/${taskId}/sources/${s.id}/file`} className="text-link underline">
                  {s.fileName}
                </a>{' '}
                <span className="text-xs text-fg-muted">
                  {s.kind === 'DOCUMENT' ? 'document' : 'transcript'} · {Math.max(1, Math.round(s.sizeBytes / 1024))} KB · SHA-256 {s.sha256.slice(0, 12)}…
                </span>
                {s.flags.length > 0 && <span className="pill pill-warning ml-2">{s.flags.length} possible real identifier(s)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-fg-muted">Opening a file is recorded in the audit log. Files never go into the dataset.</p>
        </div>
      )}
      {d.interview.answered > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">AI interview ({d.interview.answered} answers)</summary>
          <dl className="mt-2 space-y-2">
            {d.interview.turns.filter((t) => t.speaker === 'AUTHOR').map((a) => (
              <div key={a.id}>
                <dt className="text-fg-muted">{d.interview.turns.find((q) => q.speaker === 'ASSISTANT' && q.questionId === a.questionId)?.content}</dt>
                <dd>
                  {a.content}
                  {a.redacted && <span className="ml-1 text-xs text-warning">(redacted)</span>}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {d.runs.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Drafts ({d.runs.length})</summary>
          <ul className="mt-2 space-y-1">
            {d.runs.map((r) => (
              <li key={r.id}>
                {new Date(r.createdAt).toLocaleString()} · {r.section ?? 'all sections'} · {r.status.toLowerCase()}
                {r.model ? ` · ${r.model}` : ''}
                {r.sections.length ? ` · wrote ${r.sections.join(', ')}` : ''}
                {r.error && <span className="block text-xs text-error">{r.error}</span>}
                {r.problems.length > 0 && <span className="block text-xs text-fg-muted">{r.problems.join('; ')}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const KYC_PARTS: [string, string[]][] = [
  ['W01', ['header']],
  ['W02', ['scenario', 'customerFile']],
  ['W03', ['evidence', 'environment', 'policy']],
  ['W04', ['solution']],
  ['W05', ['rubric']],
];
const secTitle = (id: string) => KYC_SECTIONS.find((s) => s.id === id)?.title ?? id;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function KycView({ t }: { t: KycTask }) {
  const s = t.solution ?? {};
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="font-semibold">W02 Scenario and customer file</h3>
        <p>{t.scenario?.businessContext}</p>
        <p className="text-fg-muted">{[t.scenario?.trigger, t.scenario?.customerType, t.scenario?.product, t.scenario?.channel].filter(Boolean).join(' · ')}</p>
        <ul className="mt-1 list-disc pl-5">
          {(t.customerFile?.parties ?? []).map((p) => (
            <li key={p.id}>
              {p.id} {p.name} · {p.role.toLowerCase()} · {p.kind.toLowerCase()} {p.identifiers?.map((i) => `· ${i.type} ${i.value}`).join(' ')}
            </li>
          ))}
        </ul>
        {(t.customerFile?.ownership ?? []).length > 0 && <p className="mt-1">Ownership: {(t.customerFile?.ownership ?? []).map((o) => `${o.ownerId} → ${o.ownedId} ${o.percent}%`).join('; ')}</p>}
      </section>
      <section>
        <h3 className="font-semibold">W03 Evidence and tool responses</h3>
        <ul className="list-disc pl-5">
          {(t.evidence?.documents ?? []).map((d) => (
            <li key={d.id}>
              {d.id} {d.type} {d.issueDate ? `issued ${d.issueDate}` : ''} {d.expiryDate ? `expires ${d.expiryDate}` : ''} {(d.defects ?? []).length ? `· defects: ${d.defects!.join('; ')}` : ''}
            </li>
          ))}
        </ul>
        <ul className="mt-1 list-disc pl-5">
          {(t.environment?.responses ?? []).map((r) => (
            <li key={r.id}>
              {r.id} <span className="font-mono">tools/call {r.tool}</span> {JSON.stringify(responseArguments(r))} ({r.kind.toLowerCase()}) → {r.response}
            </li>
          ))}
        </ul>
        {(t.policy?.rules ?? []).length > 0 && <p className="mt-1">Policy: {(t.policy?.rules ?? []).map((r) => `${r.id} ${r.text}`).join(' ')}</p>}
      </section>
      <section>
        <h3 className="font-semibold">W04 Reference trajectory</h3>
        <ol className="list-decimal pl-5">
          {(s.steps ?? []).map((x) => (
            <li key={x.id}>
              {x.action === 'TOOL' ? `${x.tool} (${x.responseId})` : 'Reasoning'}: {x.expectedResult} <span className="text-fg-muted">— {x.why}{x.dependsOn?.length ? ` · after ${x.dependsOn.join(', ')}` : ''}</span>
            </li>
          ))}
        </ol>
        <ul className="mt-1 list-disc pl-5">
          {(s.findings ?? []).map((f) => (
            <li key={f.id}>
              {f.id} [{f.severity?.toLowerCase()}] {f.description} <span className="text-fg-muted">cites {(f.evidenceRefs ?? []).join(', ')}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1">
          <span className="font-medium">Outcome:</span> {s.disposition?.toLowerCase().replace(/_/g, ' ')} · risk {s.riskRating?.toLowerCase()} · {s.rationale}
        </p>
        {s.humanHandoff && <p><span className="font-medium">Hand-off:</span> {s.humanHandoff}</p>}
      </section>
      <section>
        <h3 className="font-semibold">W05 Rubric and failure modes</h3>
        <ul className="list-disc pl-5">
          {(t.rubric?.criteria ?? []).map((c) => (
            <li key={c.id}>
              {c.id} {c.name} · {c.weight}%{c.critical ? ' · critical' : ''} — {c.passCondition}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-fg-muted">Common errors: {(t.rubric?.commonErrors ?? []).map((e) => `${e.description} (${e.caughtBy})`).join('; ')}</p>
      </section>
    </div>
  );
}

/** TASK-KYC R02 and R03: read-only task, check results, similarity side by side, checklist and decision. */
export function TaskReview({ data: d }: { data: TaskReviewData }) {
  const router = useRouter();
  const [checklist, setChecklist] = useState<Record<string, boolean | undefined>>({});
  const [decision, setDecision] = useState<'ACCEPT' | 'REWORK' | 'REJECT'>('ACCEPT');
  const [rejectReason, setRejectReason] = useState('');
  const [comments, setComments] = useState<{ section: string; text: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<Record<string, string>>(d.coverageTags?.tags ?? {});
  const [edgeCase, setEdgeCase] = useState(d.coverageTags?.edgeCase ?? '');
  const [compare, setCompare] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const flaggedDup = d.similar.some((m) => m.flagged);
  const kyc = d.definition === 'kyc-onboarding-v1' && d.output;
  const changed = d.previousOutput ? (kyc ? KYC_PARTS.filter(([, keys]) => keys.some((k) => !same(d.previousOutput![k], d.output?.[k]))).map(([id]) => id) : ['content']) : [];
  const answered = d.checklist.every((c) => checklist[c.key] !== undefined);
  const allTrue = d.checklist.every((c) => checklist[c.key] === true);
  const canDecide = d.status === 'SUBMITTED';
  const twoStage = d.reviewRoute === 'SME_EXPERT_PM';
  const graphNodes = ((d.output?.workflowGraph as { nodes?: { id?: unknown }[] } | undefined)?.nodes ?? []).map((n) => n.id).filter((x): x is string => typeof x === 'string');
  const valid = answered && (decision !== 'ACCEPT' || allTrue) && (decision !== 'REJECT' || rejectReason) && (decision !== 'REWORK' || comments.some((c) => c.text.trim()));
  const match = d.similar[compare];

  async function decide() {
    setPending(true);
    setError(null);
    const res = await mutate('POST', `/review/tasks/${d.id}/decision`, {
      decision,
      expectedRevision: d.revision,
      checklist,
      ...(decision === 'REJECT' ? { rejectReason } : {}),
      ...(flaggedDup ? { duplicateDecision: decision === 'ACCEPT' ? 'ACCEPT_AS_DISTINCT' : decision === 'REWORK' ? 'REWORK' : rejectReason === 'DUPLICATE' ? 'REJECT_DUPLICATE' : undefined } : {}),
      comments: comments.filter((c) => c.text.trim()),
      notes: notes || undefined,
      ...(decision === 'ACCEPT' && d.slot?.isOpen ? { confirmedCoverage: { tags: Object.fromEntries(Object.entries(tags).filter(([, v]) => v)), edgeCase } } : {}),
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push('/review/tasks');
    router.refresh();
  }

  return (
    <div className="max-w-6xl">
      <TemplateInstructions workflow={d.project.workflow} audience="reviewer" />
      <Link href="/review/tasks" className="text-sm text-link hover:underline">
        ← Task reviews
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{(d.output?.header as { title?: string } | undefined)?.title ?? d.slot?.brief ?? 'Task'}</h1>
      <p className="text-sm text-fg-muted">
        {d.project.name} · {d.project.workflow} · by {d.author ?? 'expert'} · version {d.versions.at(-1)?.version ?? 1} · active {Math.round(d.activeSeconds / 60)} min (TPT {d.project.tptMinutes ?? '—'})
      </p>
      {d.exportStatus && (
        <p role="status" className={`mt-2 text-sm ${d.exportStatus.status === 'blocked' ? 'text-warning' : 'text-fg-muted'}`}>
          {exportStatusLine(d.status === 'ACCEPTED' ? 'Approved' : d.status.charAt(0) + d.status.slice(1).toLowerCase(), d.exportStatus)}
        </p>
      )}
      {d.slot && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Slot:</span> {d.slot.brief}
          {d.coverageTags && (
            <span className="text-fg-muted">
              {' '}
              · tags {Object.entries(d.coverageTags.tags).map(([k, v]) => `${k}=${v}`).join(', ')}
              {d.coverageTags.edgeCase ? ` · edge case: ${d.coverageTags.edgeCase}` : ''}
            </span>
          )}
        </p>
      )}
      {changed.length > 0 && !twoStage && (
        <p role="status" className="mt-2 rounded-md border border-line p-2 text-sm">
          Resubmitted after rework. Changed since the last version: {changed.map((c) => (c === 'content' ? c : `${c} ${secTitle(c)}`)).join(', ')}.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {twoStage && <StageSummary d={d as StageData} status={d.status} />}
          {d.drafting && <HowMade taskId={d.id} d={d.drafting} />}
          <section aria-labelledby="checks-h" className="card p-4 text-sm">
            <h2 id="checks-h" className="font-semibold">Automated checks</h2>
            <p className="text-fg-muted">{d.checks.every((c) => c.ok || c.severity === 'warning') ? 'All automated checks passed at submission.' : 'Some checks did not pass.'} Duplicate check: {d.embeddingModel ?? 'not run'}.</p>
            {d.flags.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-warning">Possible real data, explained by the author</p>
                <ul className="list-disc pl-5">
                  {d.flags.map((f) => (
                    <li key={f.id}>
                      <span className="font-mono">{f.excerpt}</span> ({f.kind.toLowerCase().replace(/_/g, ' ')}, {f.path}): “{f.explanation}”
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="sim-h" className="card p-4 text-sm">
            <h2 id="sim-h" className="font-semibold">Similar tasks {flaggedDup && <span className="text-warning">· likely duplicate</span>}</h2>
            {d.similar.length === 0 ? (
              <p className="text-fg-muted">No similar tasks in this workflow.</p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.similar.map((m, i) => (
                    <button key={m.taskId} type="button" onClick={() => setCompare(i)} aria-pressed={compare === i} className={`rounded-full border px-3 py-1 ${m.flagged ? 'border-warning' : 'border-line'} ${compare === i ? 'bg-surface font-medium' : ''}`}>
                      {Math.round(m.embeddingScore * 100)}% text · {Math.round(m.structuredScore * 100)}% structure
                    </button>
                  ))}
                </div>
                {match && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="font-medium">This task</p>
                      <pre tabIndex={0} aria-label="This task text" className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line p-2 text-xs">{d.text}</pre>
                    </div>
                    <div>
                      <p className="font-medium">
                        Closest match · {match.project} · {match.status?.toLowerCase()}
                      </p>
                      <pre tabIndex={0} aria-label="Closest match text" className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-line p-2 text-xs">{match.text ?? '(content unavailable)'}</pre>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="task-h" className="card p-4">
            <h2 id="task-h" className="font-semibold">Task</h2>
            {kyc ? <KycView t={d.output as KycTask} /> : <pre tabIndex={0} aria-label="Task JSON" className="mt-2 max-h-[40rem] overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(d.taskType === 'ANNOTATION' ? { input: d.input, output: d.output } : d.output, null, 2)}</pre>}
          </section>

          {d.reviews.length > 0 && !twoStage && (
            <section className="card p-4 text-sm">
              <h2 className="font-semibold">Earlier decisions</h2>
              <ul className="mt-1 space-y-1">
                {d.reviews.map((r, i) => (
                  <li key={i}>
                    v{r.version} {r.decision.toLowerCase()} · {new Date(r.at).toLocaleString()} {r.comments.map((c) => `· ${anchorOf(c)}: ${c.text}`).join(' ')}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {twoStage ? (
          <StageActions d={d as StageData} task={{ id: d.id, revision: d.revision, output: d.output, checklist: d.checklist, flaggedDuplicate: flaggedDup, openSlot: !!d.slot?.isOpen, coverageTags: d.coverageTags, nodeIds: graphNodes }} />
        ) : canDecide ? (
          <aside className="space-y-4 text-sm" aria-label="Decision">
            <RequiredNote />
            <fieldset className="card p-4">
              <legend className="px-1 font-semibold">
                Checklist
                <Req />
              </legend>
              {d.checklist.map((c) => (
                <div key={c.key} className="mt-2">
                  <p>{c.label}</p>
                  <div role="radiogroup" aria-label={c.label} aria-required="true" className="flex gap-3">
                    <label className="flex items-center gap-1">
                      <input type="radio" name={c.key} checked={checklist[c.key] === true} onChange={() => setChecklist({ ...checklist, [c.key]: true })} /> Yes
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name={c.key} checked={checklist[c.key] === false} onChange={() => setChecklist({ ...checklist, [c.key]: false })} /> No
                    </label>
                  </div>
                </div>
              ))}
            </fieldset>
            <fieldset className="space-y-2 card p-4">
              <legend className="px-1 font-semibold">
                Decision
                <Req />
              </legend>
              {(['ACCEPT', 'REWORK', 'REJECT'] as const).map((x) => (
                <label key={x} className="flex items-center gap-2">
                  <input type="radio" name="decision" checked={decision === x} onChange={() => setDecision(x)} />
                  {x === 'ACCEPT' ? (flaggedDup ? 'Accept as distinct' : 'Accept') : x === 'REWORK' ? 'Request rework' : 'Reject'}
                </label>
              ))}
              {decision === 'ACCEPT' && !allTrue && answered && <p className="text-warning">Every checklist item must be “Yes” to accept.</p>}
              {decision === 'ACCEPT' && d.slot?.isOpen && (
                <div className="space-y-2 rounded-md border border-line p-2">
                  <p className="font-medium">Confirm the open-slot tags</p>
                  {d.coverageDimensions.filter((x) => x.values.length).map((dim) => (
                    <label key={dim.key} className="block">
                      {dim.label}
                      <select value={tags[dim.key] ?? ''} onChange={(e) => setTags({ ...tags, [dim.key]: e.target.value })} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1">
                        <option value="">—</option>
                        {dim.values.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label className="block">
                    Edge case
                    <Req />
                    <input aria-required="true" value={edgeCase} onChange={(e) => setEdgeCase(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
                  </label>
                </div>
              )}
              {decision === 'REJECT' && (
                <label className="block">
                  Reason
                  <Req />
                  <select aria-required="true" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1">
                    <option value="">Choose…</option>
                    <option value="DUPLICATE">Duplicate</option>
                    <option value="NOT_REALISTIC">Not realistic</option>
                    <option value="INCORRECT">Incorrect</option>
                    <option value="REAL_DATA">Contains real data (quarantine)</option>
                  </select>
                </label>
              )}
              {decision === 'REWORK' && (
                <div className="space-y-2">
                  {comments.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <label>
                        <span className="sr-only">Section</span>
                        <select value={c.section} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)))} className="rounded-md border border-line bg-surface px-1 py-1">
                          {KYC_SECTIONS.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex-1">
                        <span className="sr-only">Comment</span>
                        <input aria-required={i === 0 ? 'true' : undefined} value={c.text} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="w-full rounded-md border border-line bg-surface px-2 py-1" />
                      </label>
                    </div>
                  ))}
                  <button type="button" onClick={() => setComments([...comments, { section: 'W04', text: '' }])} className="text-link">
                    Add a comment pinned to a section
                  </button>
                </div>
              )}
              <label className="block">
                Notes (optional)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
              </label>
              {decision === 'ACCEPT' && <p className="text-xs text-fg-muted">Accepting writes the task into the Approved Task Dataset (append-only).</p>}
              <button type="button" disabled={pending || !valid} onClick={decide} className="w-full btn btn-primary disabled:opacity-50">
                Record decision
              </button>
              {error && <p role="alert" className="text-error">{error}</p>}
            </fieldset>
          </aside>
        ) : (
          <p className="text-sm">This task is {d.status.toLowerCase()}.</p>
        )}
      </div>
    </div>
  );
}
