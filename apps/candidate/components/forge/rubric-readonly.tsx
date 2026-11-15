import { RUBRIC_APPLICABILITY_LABELS, rubricToFinish, type RubricView } from '@praxis/shared';

/**
 * The rubric's internal details, read-only, for the PM/Admin and the task's Reviewer (rubric recommendations plan,
 * section 2): applicability, whole-task failure conditions, sources, "Edited from template default" (D8), coverage and
 * what is still to finish. Kept in ADI Forge; RL Gym does not receive it. The decision buttons do not change.
 */
export function RubricReadOnly({ view, items }: { view: RubricView; items: Record<string, unknown>[] }) {
  const todo = rubricToFinish(view, items);
  const pill = 'inline-flex rounded-full px-2 text-xs font-semibold';
  return (
    <div className="mt-4 space-y-3 text-sm" data-rubric-readonly>
      <p className="flex flex-wrap gap-2">
        <span className={`${pill} ${view.coverage.gaps.length ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
          Coverage: {view.coverage.covered} of {view.coverage.total} required items
        </span>
        <span className={`${pill} ${todo.length ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>{todo.length} still to finish</span>
        <span className="text-xs text-fg-muted">Kept in ADI Forge; RL Gym doesn’t receive these details yet.</span>
      </p>
      <ul className="space-y-2">
        {view.criteria.map((c) => {
          const item = items.find((i) => i.id === c.id) ?? {};
          return (
            <li key={c.id} className="rounded-md border border-line p-3" data-rubric-criterion={c.id}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-fg-muted">{c.id}</span>
                <strong>{String(item.name ?? c.id)}</strong>
                <span className={`${pill} bg-link/15 text-link`}>{RUBRIC_APPLICABILITY_LABELS[c.details.applicability.kind]}</span>
                {item.critical === true && <span className={`${pill} bg-error/15 text-error`}>Whole-task failure</span>}
                {c.changedFromDefault.length > 0 && <span className={`${pill} bg-link/15 text-link`}>Edited from template default: {c.changedFromDefault.join(', ')}</span>}
                {c.sourceChanged && <span className={`${pill} bg-warning/15 text-warning`}>Source changed — check rubric</span>}
                {c.needs.length > 0 && <span className={`${pill} bg-warning/15 text-warning`}>Source link needed</span>}
                {c.aiFields.length > 0 && <span className={`${pill} bg-purple-500/15 text-purple-400`}>AI suggestion</span>}
              </p>
              {c.details.applicability.condition && <p className="mt-1">When it applies: {c.details.applicability.condition}</p>}
              {item.critical === true && <p className="mt-1">Whole-task failure when: {c.details.wholeTaskFailure?.condition || <em className="text-warning">no condition written</em>}</p>}
              {c.links.length > 0 && <p className="mt-1 text-xs text-fg-muted">Derived from: {c.links.map((l) => `${l.label}${l.state === 'OK' ? '' : ' (changed)'}`).join(' · ')}</p>}
              <p className="mt-1 text-xs text-fg-muted">{c.howChecked.text ?? 'Evaluation setup needed.'}</p>
            </li>
          );
        })}
      </ul>
      {view.additions.filter((a) => a.status === 'KEPT').map((a) => (
        <p key={a.id} className="rounded-md border border-dashed border-line p-3">
          <strong>{a.name}</strong> · internal note, not scored by RL Gym · evaluation setup needed
        </p>
      ))}
      {todo.length > 0 && (
        <details>
          <summary className="cursor-pointer">Still to finish ({todo.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {todo.map((t, i) => (
              <li key={i}>
                {t.criterionId ? `${t.criterionId}: ` : ''}
                {t.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
