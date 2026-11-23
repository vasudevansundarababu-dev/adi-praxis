'use client';

import { useEffect, useState } from 'react';

/** GET /me/tasks/:id/policy-clauses (E-002 §4.1.5). */
export interface TaskClause {
  clauseId: string;
  version: number;
  title: string;
  condition: unknown;
  conditionText: string;
  status: 'available' | 'setup_needed';
  missingFacts: string[];
}

/**
 * E-002 §4.1.5: in S4, the project's approved clauses with when each applies, in plain words. A clause whose condition
 * uses a fact the template does not supply is shown as "Setup needed", never hidden. The SME cites clauses; they never
 * change a condition. Shown only when the project has clauses with conditions, so other tasks look as before.
 */
export function ClauseNotes({ taskId, initial = null }: { taskId: string; initial?: TaskClause[] | null }) {
  const [items, setItems] = useState<TaskClause[] | null>(initial);
  useEffect(() => {
    if (initial) return;
    void fetch(`/api/v1/me/tasks/${taskId}/policy-clauses`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setItems((d as { items: TaskClause[] }).items));
  }, [taskId, initial]);
  const shown = (items ?? []).filter((c) => c.condition !== null);
  if (!shown.length) return null;
  return (
    <section aria-labelledby={`clauses-${taskId}`} className="mb-4 rounded-md border border-line p-3 text-sm" data-clause-notes>
      <h3 id={`clauses-${taskId}`} className="font-medium">
        When the project’s clauses apply
      </h3>
      <p className="text-xs text-fg-muted">Set by your project manager. Cite the clauses your case needs; you can’t change when a clause applies.</p>
      <ul className="mt-2 space-y-1">
        {shown.map((c) => (
          <li key={`${c.clauseId}-${c.version}`}>
            <span className="font-medium">
              {c.clauseId} v{c.version}
            </span>{' '}
            {c.title}: <span className="text-fg-muted">applies when {c.conditionText}</span>
            {c.status === 'setup_needed' && (
              <span className="ml-1 rounded-full bg-warning/15 px-2 text-xs text-warning">Setup needed: the template doesn’t supply {c.missingFacts.join(', ')} yet</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
