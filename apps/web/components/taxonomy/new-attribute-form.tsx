'use client';

import { CreateDemographicAttributeRequest, DEMOGRAPHIC_TYPES, type DemographicType } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

const EXAMPLES: Record<DemographicType, unknown> = {
  SINGLE_SELECT: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
  MULTI_SELECT: [{ value: 'CAMS', label: 'CAMS' }, { value: 'ICA', label: 'ICA Diploma' }],
  NUMBER_RANGE: { min: 0, max: 40, unit: 'years' },
  GEO_RADIUS: { maxRadiusKm: 200 },
  LANGUAGE_PROFICIENCY: { languages: [{ value: 'en', label: 'English' }], levels: [{ value: 'C1', label: 'C1' }] },
};

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2';

/** Admin: add a taxonomy attribute. Allowed values are entered as JSON in the shape the type needs. */
export function NewAttributeForm() {
  const router = useRouter();
  const [type, setType] = useState<DemographicType>('MULTI_SELECT');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [values, setValues] = useState(JSON.stringify(EXAMPLES.MULTI_SELECT, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let allowedValues: unknown;
    try {
      allowedValues = JSON.parse(values);
    } catch {
      return setErrors(['Allowed values are not valid JSON']);
    }
    const parsed = CreateDemographicAttributeRequest.safeParse({ key, label, type, allowedValues });
    if (!parsed.success) return setErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'Form'}: ${i.message}`));
    setPending(true);
    const res = await mutate('POST', '/demographic-attributes', parsed.data);
    setPending(false);
    if (!res.ok) return setErrors([res.error!]);
    setErrors([]);
    setKey('');
    setLabel('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-3 border-t border-line pt-6" noValidate>
      <h2 className="text-lg font-semibold">Add an attribute</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="attr-label" className="block text-sm font-medium">
            Label
          </label>
          <input id="attr-label" value={label} onChange={(e) => setLabel(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="attr-key" className="block text-sm font-medium">
            Key (lower_snake_case)
          </label>
          <input id="attr-key" value={key} onChange={(e) => setKey(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="attr-type" className="block text-sm font-medium">
            Type
          </label>
          <select
            id="attr-type"
            value={type}
            onChange={(e) => {
              const t = e.target.value as DemographicType;
              setType(t);
              setValues(JSON.stringify(EXAMPLES[t], null, 2));
            }}
            className={input}
          >
            {DEMOGRAPHIC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="attr-values" className="block text-sm font-medium">
          Allowed values (JSON)
        </label>
        <textarea id="attr-values" rows={6} value={values} onChange={(e) => setValues(e.target.value)} className={`${input} font-mono text-xs`} />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-error p-3 pl-8 text-sm">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-60">
        Add attribute
      </button>
    </form>
  );
}
