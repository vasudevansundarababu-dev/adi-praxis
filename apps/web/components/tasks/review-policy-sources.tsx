export interface ReviewPolicySourcesData {
  configured: boolean;
  basis: { kind: 'SNAPSHOT' | 'CURRENT_RULE_SET'; version: number | null; digest: string; at: string | null; ruleSetVersion: number } | null;
  changedSinceSnapshot: boolean;
  rules: Array<{
    ruleVersionId: string;
    ruleKey: string;
    version: number;
    title: string;
    requirement: string;
    visibility: string;
    applicability: string | null;
    inForce: boolean;
    linkedSteps: string[];
    sources: Array<{ document: string; category: string | null; documentVersion: number | null; fileName: string | null; origin: string | null; sha256: string; role: string; quote: string; locator: { page?: number | null; lineStart?: number | null; lineEnd?: number | null; section?: string | null } | null }>;
  }>;
  taskChanges: Array<{ id: string; ruleVersionId: string; type: string; requirement: string; reason: string | null }>;
}

function where(l: ReviewPolicySourcesData['rules'][number]['sources'][number]['locator']) {
  if (!l) return 'no page or line recorded';
  const parts = [l.page ? `page ${l.page}` : null, l.lineStart ? `line ${l.lineStart}${l.lineEnd && l.lineEnd !== l.lineStart ? `–${l.lineEnd}` : ''}` : null, l.section ? `section ${l.section}` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no page or line recorded';
}

/**
 * Wave 3: policy sources on the review page. The reviewer checks the task against the exact policy it was written to,
 * with each rule's quoted source; evaluator-only rules are labelled (the SME and the agent never see them).
 */
export function ReviewPolicySources({ d }: { d: ReviewPolicySourcesData }) {
  return (
    <section className="mt-6" aria-labelledby="policy-sources-heading">
      <h2 id="policy-sources-heading" className="text-lg font-semibold">
        Policy sources
      </h2>
      {!d.configured || !d.basis ? (
        <p className="mt-1 text-sm text-fg-muted">This project has no published policy rules. Judge the task on its own evidence; do not expect policy citations.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-fg-muted">
            {d.basis.kind === 'SNAPSHOT' ? `Frozen policy snapshot ${d.basis.version} (project rule set ${d.basis.ruleSetVersion}) taken when the task was submitted.` : `The project's current published rule set ${d.basis.ruleSetVersion}; no snapshot was frozen for this task.`}
          </p>
          {d.changedSinceSnapshot && (
            <p role="note" className="mt-2 rounded border border-warning p-2 text-sm">
              The project has published new rules since this snapshot. Decide whether to return the task, revalidate it, or keep it on the older version.
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {d.rules.map((r) => {
              const changes = d.taskChanges.filter((c) => c.ruleVersionId === r.ruleVersionId);
              return (
                <li key={r.ruleVersionId} className="rounded-md border border-line p-3 text-sm">
                  <p className="font-medium">
                    {r.title} <span className="font-mono text-xs text-fg-muted">{r.ruleKey} v{r.version}</span>
                    {r.visibility === 'evaluator_only' && <span className="ml-2 rounded-full border border-line px-2 text-xs">Evaluator only: hidden from the SME and the agent</span>}
                    {!r.inForce && <span className="ml-2 rounded-full border border-warning px-2 text-xs text-warning">Not in force today</span>}
                  </p>
                  <p className="mt-1">{r.requirement}</p>
                  {r.applicability && r.applicability !== 'Applies as written' && <p className="mt-1 text-xs text-fg-muted">{r.applicability}</p>}
                  {r.linkedSteps.length > 0 && <p className="mt-1 text-xs">Linked by the SME to step {r.linkedSteps.join(', ')}</p>}
                  {changes.map((c) => (
                    <p key={c.id} className="mt-1 text-xs">
                      <span className="font-medium">Task change ({c.type.toLowerCase()}):</span> {c.requirement}
                      {c.reason ? ` Reason: ${c.reason}` : ''}
                    </p>
                  ))}
                  {r.sources.map((s, i) => (
                    <blockquote key={i} className="mt-2 border-l-2 border-line pl-3">
                      <p>“{s.quote}”</p>
                      <footer className="mt-1 text-xs text-fg-muted">
                        {s.document}
                        {s.documentVersion ? ` v${s.documentVersion}` : ''}, {where(s.locator)} · {s.role}
                        {s.origin === 'SME_PROPOSAL' ? ' · proposed by an SME and accepted' : ''} · sha256 <span className="break-all font-mono">{s.sha256.slice(0, 12)}…</span>
                      </footer>
                    </blockquote>
                  ))}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
