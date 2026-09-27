'use client';

import {
  TASK_MODES,
  UpdateTemplateRequest,
  type CoverageDimensions,
  type EdgeCaseCatalog,
  type TaskMode,
  type TemplateDto,
} from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

interface DimRow {
  key: string;
  label: string;
  values: string;
}
interface CellRow {
  tags: string;
  quota: number;
  required: boolean;
}
interface EdgeRow {
  name: string;
  description: string;
  quota: number;
  required: boolean;
}

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';
const small = 'rounded-md border border-line bg-surface px-2 py-1';
const splitList = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** "customer_type=corporate; risk_level=high" <-> { customer_type: 'corporate', risk_level: 'high' } */
const tagsToText = (tags: Record<string, string>) =>
  Object.entries(tags)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
function textToTags(s: string): Record<string, string> {
  return Object.fromEntries(
    s
      .split(';')
      .map((p) => p.split('=').map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][],
  );
}

/** Draft editor. Validates with the same shared schema as the API before saving. */
export function TemplateEditor({ template: t }: { template: TemplateDto }) {
  const router = useRouter();
  const matrix = t.coverageDimensions as CoverageDimensions;

  const [workflowName, setWorkflowName] = useState(t.workflowName);
  const [primaryWork, setPrimaryWork] = useState(t.primaryWork ?? '');
  const [verificationCriteria, setVerificationCriteria] = useState(t.verificationCriteria ?? '');
  const [humanGate, setHumanGate] = useState(t.humanGate ?? '');
  const [tpt, setTpt] = useState(t.defaultTptMinutes?.toString() ?? '');
  const [skills, setSkills] = useState(t.skills.join(', '));
  const [modes, setModes] = useState<TaskMode[]>(t.taskModes);
  const [distinctTarget, setDistinctTarget] = useState(String(t.defaultDistinctTarget));
  const [maxPerExpert, setMaxPerExpert] = useState(String(t.defaultMaxPerExpert));
  const [openSlotPct, setOpenSlotPct] = useState(String(Math.round(t.openSlotShare * 100)));
  const [similarity, setSimilarity] = useState(String(t.similarityThreshold));
  const [dims, setDims] = useState<DimRow[]>(matrix.dimensions.map((d) => ({ ...d, values: d.values.join(', ') })));
  const [cells, setCells] = useState<CellRow[]>(matrix.cells.map((c) => ({ ...c, tags: tagsToText(c.tags) })));
  const [edges, setEdges] = useState<EdgeRow[]>((t.edgeCaseCatalog as EdgeCaseCatalog).map((e) => ({ ...e })));
  const [taskSchema, setTaskSchema] = useState(JSON.stringify(t.taskDefinitionSchema, null, 2));
  const [collectionSchema, setCollectionSchema] = useState(JSON.stringify(t.collectionSchema, null, 2));

  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function parseJson(label: string, text: string, problems: string[]) {
    try {
      return JSON.parse(text || '{}') as unknown;
    } catch {
      problems.push(`${label} is not valid JSON`);
      return undefined;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    const payload = {
      workflowName,
      primaryWork: primaryWork.trim() || null,
      verificationCriteria: verificationCriteria.trim() || null,
      humanGate: humanGate.trim() || null,
      defaultTptMinutes: tpt ? Number(tpt) : null,
      skills: splitList(skills),
      taskModes: modes,
      defaultDistinctTarget: Number(distinctTarget),
      defaultMaxPerExpert: Number(maxPerExpert),
      openSlotShare: Number(openSlotPct) / 100,
      similarityThreshold: Number(similarity),
      coverageDimensions: {
        dimensions: dims.map((d) => ({ key: d.key.trim(), label: d.label.trim(), values: splitList(d.values) })),
        cells: cells.map((c) => ({ tags: textToTags(c.tags), quota: Number(c.quota), required: c.required })),
      },
      edgeCaseCatalog: edges.map((e) => ({ ...e, quota: Number(e.quota) })),
      taskDefinitionSchema: parseJson('Task definition schema', taskSchema, problems),
      collectionSchema: parseJson('Collection schema', collectionSchema, problems),
    };
    const parsed = UpdateTemplateRequest.safeParse(payload);
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((i) => `${i.path.join(' › ') || 'Form'}: ${i.message}`));
    }
    if (problems.length > 0) {
      setErrors(problems);
      setSaved(false);
      return;
    }
    setPending(true);
    const res = await mutate<TemplateDto>('PATCH', `/templates/${t.id}`, parsed.data);
    setPending(false);
    if (!res.ok) {
      setErrors([res.error!]);
      setSaved(false);
      return;
    }
    setErrors([]);
    setSaved(true);
    router.refresh();
  }

  const update = <T,>(list: T[], set: (v: T[]) => void, i: number, patch: Partial<T>) =>
    set(list.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const remove = <T,>(list: T[], set: (v: T[]) => void, i: number) => set(list.filter((_, j) => j !== i));

  return (
    <form onSubmit={save} onChange={() => setSaved(false)} className="space-y-8" noValidate>
      <section className="space-y-4">
        <div>
          <label htmlFor="workflowName" className="block text-sm font-medium">
            Workflow name
          </label>
          <input id="workflowName" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} className={input} />
        </div>
        {(
          [
            ['primaryWork', 'Primary work', primaryWork, setPrimaryWork],
            ['verificationCriteria', 'Verification / reward', verificationCriteria, setVerificationCriteria],
            ['humanGate', 'Human gate (decisions workers must not make)', humanGate, setHumanGate],
          ] as const
        ).map(([id, label, value, set]) => (
          <div key={id}>
            <label htmlFor={id} className="block text-sm font-medium">
              {label}
            </label>
            <textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} className={input} />
          </div>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tpt" className="block text-sm font-medium">
            Default TPT (minutes, 1–480)
          </label>
          <input id="tpt" type="number" min={1} max={480} value={tpt} onChange={(e) => setTpt(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="skills" className="block text-sm font-medium">
            Skills (comma separated)
          </label>
          <input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} className={input} />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Task modes</legend>
          <div className="mt-2 flex gap-4">
            {TASK_MODES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={modes.includes(m)}
                  onChange={(e) => setModes(e.target.checked ? [...modes, m] : modes.filter((x) => x !== m))}
                />
                {m === 'AUTHORING' ? 'Authoring' : 'Annotation'}
              </label>
            ))}
          </div>
        </fieldset>
        <div />
        {(
          [
            ['distinctTarget', 'Distinct-task target', distinctTarget, setDistinctTarget],
            ['maxPerExpert', 'Max tasks per expert', maxPerExpert, setMaxPerExpert],
            ['openSlot', 'Open-slot share (%)', openSlotPct, setOpenSlotPct],
            ['similarity', 'Similarity threshold (0–1)', similarity, setSimilarity],
          ] as const
        ).map(([id, label, value, set]) => (
          <div key={id}>
            <label htmlFor={id} className="block text-sm font-medium">
              {label}
            </label>
            <input id={id} type="number" step="any" value={value} onChange={(e) => set(e.target.value)} className={input} />
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-semibold">Coverage dimensions</h2>
        <p className="text-sm text-fg-muted">Key in lower_snake_case; allowed values comma separated.</p>
        <div className="mt-2 space-y-2">
          {dims.map((d, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input aria-label="Dimension key" placeholder="customer_type" value={d.key} onChange={(e) => update(dims, setDims, i, { key: e.target.value })} className={`${small} w-40`} />
              <input aria-label="Dimension label" placeholder="Customer type" value={d.label} onChange={(e) => update(dims, setDims, i, { label: e.target.value })} className={`${small} w-40`} />
              <input aria-label="Allowed values" placeholder="individual, corporate" value={d.values} onChange={(e) => update(dims, setDims, i, { values: e.target.value })} className={`${small} min-w-60 flex-1`} />
              <button type="button" onClick={() => remove(dims, setDims, i)} className="text-sm text-link">
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setDims([...dims, { key: '', label: '', values: '' }])} className="text-sm text-link">
            + Add dimension
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Coverage cells</h2>
        <p className="text-sm text-fg-muted">Combinations a project must cover, e.g. customer_type=corporate; risk_level=high</p>
        <div className="mt-2 space-y-2">
          {cells.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label="Cell tags" value={c.tags} onChange={(e) => update(cells, setCells, i, { tags: e.target.value })} className={`${small} min-w-60 flex-1`} />
              <label className="flex items-center gap-1 text-sm">
                Quota
                <input type="number" min={1} value={c.quota} onChange={(e) => update(cells, setCells, i, { quota: Number(e.target.value) })} className={`${small} w-16`} />
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={c.required} onChange={(e) => update(cells, setCells, i, { required: e.target.checked })} />
                Required
              </label>
              <button type="button" onClick={() => remove(cells, setCells, i)} className="text-sm text-link">
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setCells([...cells, { tags: '', quota: 1, required: true }])} className="text-sm text-link">
            + Add cell
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Edge-case catalog</h2>
        <div className="mt-2 space-y-3">
          {edges.map((e, i) => (
            <div key={i} className="space-y-1 rounded-md border border-line p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Edge case name" placeholder="Name" value={e.name} onChange={(ev) => update(edges, setEdges, i, { name: ev.target.value })} className={`${small} min-w-60 flex-1`} />
                <label className="flex items-center gap-1 text-sm">
                  Quota
                  <input type="number" min={1} value={e.quota} onChange={(ev) => update(edges, setEdges, i, { quota: Number(ev.target.value) })} className={`${small} w-16`} />
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={e.required} onChange={(ev) => update(edges, setEdges, i, { required: ev.target.checked })} />
                  Required
                </label>
                <button type="button" onClick={() => remove(edges, setEdges, i)} className="text-sm text-link">
                  Remove
                </button>
              </div>
              <input aria-label="Edge case description" placeholder="Description" value={e.description} onChange={(ev) => update(edges, setEdges, i, { description: ev.target.value })} className={`${small} w-full`} />
            </div>
          ))}
          <button type="button" onClick={() => setEdges([...edges, { name: '', description: '', quota: 1, required: true }])} className="text-sm text-link">
            + Add edge case
          </button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="taskSchema" className="block text-sm font-medium">
            Task definition schema (JSON)
          </label>
          <textarea id="taskSchema" rows={6} value={taskSchema} onChange={(e) => setTaskSchema(e.target.value)} className={`${input} font-mono text-xs`} />
        </div>
        <div>
          <label htmlFor="collectionSchema" className="block text-sm font-medium">
            Collection schema (JSON)
          </label>
          <textarea id="collectionSchema" rows={6} value={collectionSchema} onChange={(e) => setCollectionSchema(e.target.value)} className={`${input} font-mono text-xs`} />
        </div>
        <p className="text-xs text-fg-muted sm:col-span-2">Defined by the per-workflow task spec; stored as-is in v1.</p>
      </section>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-error p-3 text-sm">
          <p className="font-medium text-error">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary disabled:opacity-60">
          {pending ? 'Saving…' : 'Save draft'}
        </button>
        {saved && (
          <span role="status" className="text-sm text-success">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
