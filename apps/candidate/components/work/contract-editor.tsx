'use client';
import { useState } from 'react';
import { PRAXIS_STAGED_EXAMPLE, PRAXIS_SYNTHETIC_EXAMPLE, praxisContractIssues } from '@praxis/shared';

const box = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm';
const label = (s: string) => s.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const enums: Record<string, string[]> = { visibility: ['actor', 'private', 'future'], kind: ['json_equals', 'json_number_min', 'json_number_max'] };
function JsonObject({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  return <div><textarea aria-label="JSON object" rows={5} className={box} value={raw} onChange={(e) => { setRaw(e.target.value); try { const v = JSON.parse(e.target.value); if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Enter a JSON object'); onChange(v); setError(''); } catch { onChange(e.target.value); setError('Enter a valid JSON object before continuing.'); } }} />{error && <p role="alert" className="text-error">{error}</p>}</div>;
}
function Fields({ value, prototype, path, staged, onChange }: { value: unknown; prototype: unknown; path: string; staged: boolean; onChange: (v: unknown) => void }) {
  if (Array.isArray(value)) {
    const key = path.split('.').at(-1)!;
    const sample = Array.isArray(prototype) ? prototype[0] : '';
    const maximum = key === 'stages' ? (staged ? 12 : 1) : key === 'deliverables' ? 1 : key === 'evidence' || key === 'evidence_ids' ? 100 : 50;
    return <div className="space-y-3">{value.map((v, i) => <div key={i} className="rounded-md border border-line p-3"><Fields value={v} prototype={sample} staged={staged} path={`${path}.${i}`} onChange={(next) => onChange(value.map((old, j) => i === j ? next : old))} /><button type="button" className="mt-2 text-xs text-error underline" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove {label(key)} {i + 1}</button></div>)}{value.length < maximum && <button type="button" className="text-sm text-link underline" onClick={() => { const next = structuredClone(sample ?? ''); if (next && typeof next === 'object' && 'id' in next) next.id = `${key}-${crypto.randomUUID()}`; onChange([...value, next]); }}>Add {label(key)}</button>}</div>;
  }
  if (value && typeof value === 'object') {
    if (path.endsWith('initial_state') || path.endsWith('reference_output')) return <JsonObject value={value} onChange={onChange} />;
    return <div className="space-y-3">{Object.entries(value).map(([k, v]) => <div className="block" key={k}><span className="text-sm font-medium">{label(k)}</span>{k === 'visibility' && <span className="ml-2 text-xs text-fg-muted">Private material is excluded from the actor package.</span>}<Fields value={v} prototype={(prototype as Record<string, unknown> | undefined)?.[k]} staged={staged} path={`${path}.${k}`} onChange={(next) => { const v = { ...value, [k]: next } as Record<string, unknown>; if (k === 'visibility') { if (next === 'future') v.reveal_stage_id = ''; else delete v.reveal_stage_id; } onChange(v); }} /></div>)}</div>;
  }
  const key = path.split('.').at(-1)!;
  if (key === 'value') return <div><select aria-label="Rule value type" className={box} value={typeof value} onChange={(e) => onChange(e.target.value === 'number' ? 0 : e.target.value === 'boolean' ? false : '')}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option></select>{typeof value === 'boolean' ? <input aria-label="Rule value" type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> : <input aria-label="Rule value" className={box} type={typeof value === 'number' ? 'number' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(typeof value === 'number' ? Number(e.target.value) : e.target.value)} />}</div>;
  if (typeof value === 'boolean') return <input aria-label={label(key)} className="ml-2" type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />;
  if (enums[key] && !(key === 'kind' && String(value) === 'submit_json')) return <select aria-label={label(key)} className={box} value={String(value)} onChange={(e) => onChange(e.target.value)}>{enums[key]!.filter((v) => staged || v !== 'future').map((v) => <option key={v}>{v}</option>)}</select>;
  if (typeof value === 'number') return <input aria-label={label(key)} className={box} type="number" value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  return <textarea aria-label={label(key)} className={box} rows={['content', 'objective', 'description', 'instruction', 'basis'].includes(key) ? 3 : 1} value={String(value ?? '')} readOnly={key === 'schema_version' || key === 'binding' || key === 'classification' || key === 'status' || key === 'reviewer_ref' || key === 'reviewed_revision_id' || key === 'path' || (key === 'kind' && value === 'submit_json') || key === 'completion'} onChange={(e) => onChange(e.target.value)} />;
}
export function ContractEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const issues = praxisContractIssues(value);
  const staged = value.schema_version === 'praxis.anvil.task.v2';
  const prototype = staged ? PRAXIS_STAGED_EXAMPLE : PRAXIS_SYNTHETIC_EXAMPLE;
  const update = (v: Record<string, unknown>) => { const p = v.provenance as Record<string, unknown>; onChange({ ...v, provenance: { ...p, review: { status: 'draft', reviewer_ref: 'not-reviewed', reviewed_revision_id: v.revision_id } } }); };
  return <section className="space-y-4"><p className="rounded-md border border-line p-3 text-sm">Executable support: {staged ? 'two to twelve sequential stages with future evidence reveals and trusted scalar state updates' : 'one decision stage'}. Each stage submits output.json with explicit equality/minimum/maximum checks. External side effects and arbitrary prose execution are unsupported. Evidence, reference answers and grading rules have separate visibility. This synthetic draft carries no human approval or reviewed rights clearance.</p>{Object.entries(value).map(([k, v]) => <details key={k} open={['title', 'objective', 'constraints'].includes(k)} className="rounded-md border border-line p-3"><summary className="cursor-pointer font-medium">{label(k)}</summary><div className="mt-3"><Fields value={v} prototype={(prototype as Record<string, unknown>)[k]} staged={staged} path={k} onChange={(next) => update({ ...value, [k]: next })} /></div></details>)}<div role="status" className="text-sm">{issues.length ? <ul className="list-disc pl-5 text-error">{issues.map((i, n) => <li key={n}>{i.path}: {i.message}</li>)}</ul> : 'Executable contract checks pass. Submit for independent human review.'}</div><p className="text-xs text-fg-muted">After acceptance, an administrator can download the approved record’s versioned contract and import that JSON in Anvil. Keep the source record ID and hash with the import.</p></section>;
}
export function newSyntheticContract(staged = false) {
  const c = structuredClone(staged ? PRAXIS_STAGED_EXAMPLE : PRAXIS_SYNTHETIC_EXAMPLE);
  c.task_id = `SYN-MKT-${crypto.randomUUID()}`;
  c.revision_id = `revision-${crypto.randomUUID()}`;
  c.provenance.review.reviewed_revision_id = c.revision_id;
  return c;
}
