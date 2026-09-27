'use client';

import { CreateJobDescriptionRequest, LOCATION_TYPES, type JobDescriptionDto } from '@praxis/shared';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';

/** Step 5: pick an existing JD or create one inline (SPEC FLOW 1). */
export function JobDescriptionStep({
  jobDescriptions,
  selectedId,
  onSelect,
  onCreated,
}: {
  jobDescriptions: JobDescriptionDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreated: (jd: JobDescriptionDto) => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>(jobDescriptions.length ? 'existing' : 'new');
  const [form, setForm] = useState({ title: '', responsibilities: '', skills: '', wagePerTask: '', wageCurrency: 'USD', locationType: 'REMOTE', location: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const selected = jobDescriptions.find((j) => j.id === selectedId);

  async function create() {
    const parsed = CreateJobDescriptionRequest.safeParse({
      ...form,
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      wagePerTask: Number(form.wagePerTask),
      location: form.location.trim() || null,
    });
    if (!parsed.success) return setErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'Form'}: ${i.message}`));
    setPending(true);
    const res = await mutate<JobDescriptionDto>('POST', '/job-descriptions', parsed.data);
    setPending(false);
    if (!res.ok) return setErrors([res.error!]);
    setErrors([]);
    onCreated(res.data!);
    setMode('existing');
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="jdMode" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={!jobDescriptions.length} />
          Use an existing job description
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="jdMode" checked={mode === 'new'} onChange={() => setMode('new')} />
          Create a new one
        </label>
      </div>

      {mode === 'existing' ? (
        <div>
          <label htmlFor="jd" className="block text-sm font-medium">
            Job description
          </label>
          <select id="jd" value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value || null)} className={input}>
            <option value="">Choose…</option>
            {jobDescriptions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} — {j.wagePerTask} {j.wageCurrency}/task
              </option>
            ))}
          </select>
          {selected && (
            <div className="mt-3 rounded-md border border-line p-3 text-sm">
              <p className="whitespace-pre-wrap">{selected.responsibilities}</p>
              <p className="mt-2 text-fg-muted">
                Skills: {selected.skills.join(', ')} · {selected.locationType.toLowerCase()}
                {selected.location ? ` · ${selected.location}` : ''}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {(
            [
              ['title', 'Title'],
              ['skills', 'Required skills (comma separated)'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label htmlFor={`jd-${k}`} className="block text-sm font-medium">
                {label}
              </label>
              <input id={`jd-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={input} />
            </div>
          ))}
          <div>
            <label htmlFor="jd-resp" className="block text-sm font-medium">
              Responsibilities
            </label>
            <textarea id="jd-resp" rows={3} value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} className={input} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="jd-wage" className="block text-sm font-medium">
                Wage per task
              </label>
              <input id="jd-wage" type="number" min={0.01} step={0.01} value={form.wagePerTask} onChange={(e) => setForm({ ...form, wagePerTask: e.target.value })} className={input} />
            </div>
            <div>
              <label htmlFor="jd-cur" className="block text-sm font-medium">
                Currency (ISO code)
              </label>
              <input id="jd-cur" maxLength={3} value={form.wageCurrency} onChange={(e) => setForm({ ...form, wageCurrency: e.target.value.toUpperCase() })} className={input} />
            </div>
            <div>
              <label htmlFor="jd-lt" className="block text-sm font-medium">
                Location type
              </label>
              <select id="jd-lt" value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value })} className={input}>
                {LOCATION_TYPES.map((l) => (
                  <option key={l} value={l}>
                    {l[0] + l.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="jd-loc" className="block text-sm font-medium">
                Location {form.locationType === 'REMOTE' ? '(optional)' : ''}
              </label>
              <input id="jd-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={input} />
            </div>
          </div>
          {errors.length > 0 && (
            <ul role="alert" className="list-disc rounded-md border border-error p-3 pl-8 text-sm">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <button type="button" disabled={pending} onClick={create} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-60">
            {pending ? 'Creating…' : 'Create job description'}
          </button>
        </div>
      )}
    </div>
  );
}
