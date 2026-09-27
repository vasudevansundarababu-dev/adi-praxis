import type { CoverageDimensions, EdgeCaseCatalog, TemplateDto } from '@praxis/shared';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-fg-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Read-only template, for published/retired versions and for PMs. */
export function TemplateView({ template: t }: { template: TemplateDto }) {
  const matrix = t.coverageDimensions as CoverageDimensions;
  const edgeCases = t.edgeCaseCatalog as EdgeCaseCatalog;
  return (
    <dl className="space-y-5">
      <Field label="Primary work">{dash(t.primaryWork)}</Field>
      <Field label="Verification / reward">{dash(t.verificationCriteria)}</Field>
      <Field label="Human gate">{dash(t.humanGate)}</Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Default TPT">{t.defaultTptMinutes ? `${t.defaultTptMinutes} minutes` : '—'}</Field>
        <Field label="Task modes">{t.taskModes.map((m) => m.toLowerCase()).join(', ') || '—'}</Field>
        <Field label="Skills">{t.skills.join(', ') || '—'}</Field>
        <Field label="Distinct-task target">{t.defaultDistinctTarget}</Field>
        <Field label="Max tasks per expert">{t.defaultMaxPerExpert}</Field>
        <Field label="Open-slot share">{Math.round(t.openSlotShare * 100)}%</Field>
        <Field label="Similarity threshold">{t.similarityThreshold}</Field>
      </div>
      <Field label="Coverage dimensions">
        {matrix.dimensions.length === 0 ? (
          '—'
        ) : (
          <ul className="list-disc pl-5">
            {matrix.dimensions.map((d) => (
              <li key={d.key}>
                {d.label}: {d.values.join(', ') || <em className="text-fg-muted">no values yet</em>}
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Required coverage cells">
        {matrix.cells.length === 0 ? (
          '—'
        ) : (
          <ul className="list-disc pl-5">
            {matrix.cells.map((c, i) => (
              <li key={i}>
                {Object.entries(c.tags)
                  .map(([k, v]) => `${k} = ${v}`)
                  .join(', ')}{' '}
                · quota {c.quota} · {c.required ? 'required' : 'optional'}
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Edge-case catalog">
        {edgeCases.length === 0 ? (
          '—'
        ) : (
          <ul className="list-disc pl-5">
            {edgeCases.map((e) => (
              <li key={e.name}>
                <span className="font-medium">{e.name}</span> · quota {e.quota} · {e.required ? 'required' : 'optional'}
                {e.description && <span className="block text-sm text-fg-muted">{e.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </Field>
    </dl>
  );
}
