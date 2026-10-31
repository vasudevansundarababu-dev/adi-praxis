'use client';

import { roleLabel } from '@praxis/shared';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import { fmtDateTime, StatePill } from '@/components/supply/ui';
import type { FamilyDto } from './types';

const CHECKS = [
  ['rule', 'Key from rule'],
  ['solver', 'Independent solve agrees'],
  ['citation', 'Cited section supports it'],
  ['difficulty', 'Difficulty in band'],
] as const;

const keyText = (k: FamilyDto['samples'][number]['key']) => (k === null ? 'Written answer: graded against the rubric by people' : Array.isArray(k) ? k.join(', ') : k);
const json = (v: unknown) => JSON.stringify(v, null, 2);

function Sample({ s, n }: { s: FamilyDto['samples'][number]; n: number }) {
  const v = s.validation;
  return (
    <li className="rounded-md border border-line p-3">
      <p className="text-xs font-medium text-fg-muted">
        Sample {n} · {fmtDateTime(s.createdAt)}
      </p>
      <p className="mt-1 whitespace-pre-line">{s.stem}</p>
      {s.content?.options && (
        <ul className="mt-2 space-y-0.5">
          {s.content.options.map((o) => (
            <li key={o} className={(Array.isArray(s.key) ? s.key.includes(o) : s.key === o) ? 'font-semibold text-success' : 'text-fg-muted'}>
              {(Array.isArray(s.key) ? s.key.includes(o) : s.key === o) ? '✓ ' : '○ '}
              {o}
            </li>
          ))}
        </ul>
      )}
      {s.content?.steps && (
        <ol className="mt-2 space-y-0.5">
          {s.content.steps.map((st) => (
            <li key={st.id} className={Array.isArray(s.key) && s.key.includes(st.id) ? 'font-semibold text-warning' : ''}>
              <span className="font-mono text-xs text-fg-muted">{st.id}</span> {st.text}
            </li>
          ))}
        </ol>
      )}
      {s.content?.rubric && (
        <ul className="mt-2 list-disc pl-5 text-xs text-fg-muted">
          {s.content.rubric.map((r) => (
            <li key={r.criterion}>
              {r.criterion} ({r.weight})
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2">
        <span className="font-medium">Derived key:</span> {keyText(s.key)}
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        Variables: <code>{Object.entries(s.variables).map(([k, x]) => `${k}=${Array.isArray(x) ? `[${x.join(',')}]` : String(x)}`).join(' · ')}</code>
      </p>
      {v && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Validation checks">
          {CHECKS.map(([k, label]) => (
            <span key={k} className={`pill ${v[k] ? 'pill-success' : 'pill-error'}`}>
              {v[k] ? '' : 'Failed: '}
              {label}
              {k === 'difficulty' && v.estimatedDifficulty !== undefined ? ` (est. ${v.estimatedDifficulty})` : ''}
            </span>
          ))}
          {v.nearCopy && <span className="pill pill-error">Near-copy of an earlier item</span>}
          {v.model && <span className="text-xs text-fg-muted">worded by {v.model}</span>}
        </div>
      )}
    </li>
  );
}

function FamilyEditor({ f, onDone }: { f: FamilyDto; onDone: () => void }) {
  const a = useAction();
  const [stem, setStem] = useState(f.stemPattern);
  const [options, setOptions] = useState(f.options.join('\n'));
  const [min, setMin] = useState(f.difficultyMin);
  const [max, setMax] = useState(f.difficultyMax);
  const [critical, setCritical] = useState(f.critical);
  const [schema, setSchema] = useState(json(f.variableSchema));
  const [rule, setRule] = useState(json(f.answerRule));
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <form
      className="mt-3 space-y-3 border-t border-line pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        let variableSchema: unknown, answerRule: unknown;
        try {
          variableSchema = JSON.parse(schema);
          answerRule = JSON.parse(rule);
        } catch {
          return setParseError('The variable schema or answer rule is not valid JSON. Fix it and save again.');
        }
        setParseError(null);
        const res = await a.run('PATCH', `/item-families/${f.id}`, { stemPattern: stem, options: options.split('\n').map((o) => o.trim()).filter(Boolean), difficultyMin: min, difficultyMax: max, critical, variableSchema, answerRule }, { success: 'Family saved. Its samples were set aside; generate a new sample, then approve again.' });
        if (res.ok) onDone();
      }}
    >
      <RequiredNote />
      <label className="block">
        Stem pattern
        <Req />
        <textarea required rows={4} value={stem} onChange={(e) => setStem(e.target.value)} className={input} />
      </label>
      <label className="block">
        Options (one per line)
        <textarea rows={4} value={options} onChange={(e) => setOptions(e.target.value)} className={input} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          Difficulty from
          <Req />
          <input required type="number" min={1} max={5} value={min} onChange={(e) => setMin(Number(e.target.value))} className="mt-1 block w-20 rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <label className="block">
          to
          <Req />
          <input required type="number" min={1} max={5} value={max} onChange={(e) => setMax(Number(e.target.value))} className="mt-1 block w-20 rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
          Tests a critical rule
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="block">
          Variable schema (JSON)
          <Req />
          <textarea aria-required="true" rows={8} value={schema} onChange={(e) => setSchema(e.target.value)} className={`${input} font-mono text-xs`} spellCheck={false} />
        </label>
        <label className="block">
          Answer rule (JSON)
          <Req />
          <textarea aria-required="true" rows={8} value={rule} onChange={(e) => setRule(e.target.value)} className={`${input} font-mono text-xs`} spellCheck={false} />
        </label>
      </div>
      {parseError && (
        <p role="alert" className="text-error">
          {parseError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={a.pending || min > max} className="btn btn-primary">
          Save family
        </button>
        <button type="button" onClick={onDone} className="btn btn-secondary">
          Cancel
        </button>
      </div>
      <ActionMessages error={a.error} problems={a.problems} />
    </form>
  );
}

/** One item family: template, rule, approvals and samples with the derived key and the four checks. */
export function FamilyCard({ family: f, competencyName, expertTier, isAdmin, userId }: { family: FamilyDto; competencyName: string; expertTier: boolean; isAdmin: boolean; userId: string }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const approvals = f.approvals ?? [];
  const mine = approvals.some((x) => x.userId === userId);
  const flagged = f.status === 'FLAGGED';
  const hasAdmin = approvals.some((x) => x.role === 'ADMIN');
  const stats = f.stats ?? {};

  return (
    <article className="card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{competencyName}</h3>
        <StatePill state={f.status} />
        <span className="pill pill-info">{f.itemType.toLowerCase().replace(/_/g, ' ')}</span>
        {f.critical && <span className="pill pill-error">Critical rule</span>}
        <span className="text-xs text-fg-muted">
          Difficulty {f.difficultyMin}–{f.difficultyMax} · {f.cognitiveLevel} · cites <span className="font-mono">{f.citation}</span>
        </span>
      </div>
      {flagged && <p className="mt-2 text-error">Flagged after repeated validation failures. Edit or regenerate this family before it can be approved.</p>}
      <p className="mt-3 whitespace-pre-line">{f.stemPattern}</p>
      {f.options.length > 0 && <p className="mt-2 text-fg-muted">Options: {f.options.join(' · ')}</p>}
      {f.distractorRationale && <p className="mt-1 text-xs text-fg-muted">Why the wrong options are tempting: {f.distractorRationale}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-link">Variables and answer rule</summary>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <pre className="overflow-x-auto rounded-md border border-line bg-surface p-2 text-xs">{json(f.variableSchema)}</pre>
          <pre className="overflow-x-auto rounded-md border border-line bg-surface p-2 text-xs">{json(f.answerRule)}</pre>
        </div>
      </details>
      <p className="mt-2 text-xs text-fg-muted">
        Served {stats.served ?? 0} · correct {stats.correct ?? 0} · validation failures {stats.validationFailures ?? 0} (in a row: {stats.consecutiveFailures ?? 0})
      </p>

      <div className="mt-3">
        <h4 className="font-medium">Approvals</h4>
        {expertTier && (
          <ul className="mt-1 flex flex-wrap gap-2">
            <li className={`pill ${hasAdmin ? 'pill-success' : ''}`}>Admin {hasAdmin ? 'approved' : 'needed'}</li>
            <li>Admin decision is sufficient for every tier.</li>
          </ul>
        )}
        <ul className="mt-1 text-xs text-fg-muted">
          {approvals.map((x) => (
            <li key={x.userId}>
              {roleLabel(x.role)} {x.userId === userId ? '(you)' : ''} {x.at ? `· ${fmtDateTime(x.at)}` : ''}
            </li>
          ))}
          {approvals.length === 0 && <li>None yet.</li>}
        </ul>
      </div>

      <div className="mt-3">
        <h4 className="font-medium">Samples ({f.samples.length})</h4>
        {f.samples.length === 0 ? (
          <p className="mt-1 text-fg-muted">No valid sample yet.{isAdmin ? ' Generate one to review before approving.' : ''}</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {f.samples.map((s, i) => (
              <Sample key={s.id} s={s} n={i + 1} />
            ))}
          </ol>
        )}
      </div>

      {f.status !== 'REJECTED' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="block min-w-56 flex-1">
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          </label>
          <button type="button" disabled={a.pending || flagged || f.samples.length === 0 || (mine && !isAdmin) || f.status === 'APPROVED'} onClick={() => a.run('POST', `/item-families/${f.id}/decision`, { decision: 'APPROVE', note: note.trim() }, { success: 'Approval recorded.' })} className="btn btn-primary">
            {mine ? 'You approved' : 'Approve family'}
          </button>
          {isAdmin && (
            <>
              <button type="button" disabled={a.pending} onClick={() => a.run('POST', `/item-families/${f.id}/decision`, { decision: 'REJECT', note: note.trim() }, { success: 'Family rejected. It will not be used.' })} className="btn btn-secondary">
                Reject
              </button>
              <button type="button" disabled={a.pending || flagged} onClick={() => a.run('POST', `/item-families/${f.id}/samples`, undefined, { success: 'A new sample is being generated. Refresh in a moment.' })} className="btn btn-secondary">
                Generate another sample
              </button>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className="btn btn-secondary">
                  Edit family
                </button>
              )}
            </>
          )}
          <div className="w-full">
            <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
          </div>
        </div>
      )}
      {editing && <FamilyEditor f={f} onDone={() => setEditing(false)} />}
    </article>
  );
}
