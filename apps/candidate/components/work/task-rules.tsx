export interface TaskRulesView {
  configured: boolean;
  readOnly: true;
  snapshot_id?: string | null;
  rules: Array<{ rule_version_id: string; rule_key: string; title: string; requirement: string; applicability_label: string; exceptions: { kind: string; items: Array<{ statement: string }> } }>;
  task_changes: Array<{ id: string; rule_version_id: string; type: string; requirement: string }>;
}

/** OD9: the agent-visible rules of the SME's own task, read-only. Nothing here can be edited. */
export function TaskRules({ policy }: { policy: TaskRulesView }) {
  if (!policy.configured || policy.rules.length === 0) return null;
  return (
    <details className="mb-6 rounded-md border border-line bg-surface" open>
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Rules for this task <span className="font-normal text-fg-muted">({policy.rules.length}, read-only)</span>
      </summary>
      <p className="px-4 text-sm text-fg-muted">Set by the project from its policy documents. Your task must follow them; ask your project manager if one looks wrong.</p>
      <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
        {policy.rules.map((r) => {
          const changes = policy.task_changes.filter((c) => c.rule_version_id === r.rule_version_id);
          return (
            <li key={r.rule_version_id} className="px-4 py-3">
              <p className="font-medium">
                {r.title} <span className="font-mono text-xs text-fg-muted">{r.rule_key}</span>
              </p>
              <p className="mt-1">{r.requirement}</p>
              {r.applicability_label !== 'Applies as written' && <p className="mt-1 text-xs text-fg-muted">{r.applicability_label}</p>}
              {r.exceptions.items.length > 0 && <p className="mt-1 text-xs text-fg-muted">Exceptions: {r.exceptions.items.map((e) => e.statement).join(' ')}</p>}
              {changes.map((c) => (
                <p key={c.id} className="mt-1 text-xs">
                  <span className="font-medium">For this task:</span> {c.requirement}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
