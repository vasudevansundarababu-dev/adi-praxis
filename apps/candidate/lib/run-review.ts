/** GET /me/run-reviews: RL Gym run reviews assigned to this SME (D-004). */
export interface AssignedReview {
  ref: string;
  batchId: string;
  runId: string | null;
  projectId: string;
  projectName: string;
  receivedAt: string;
  items: { itemId: string; taskId: string; revision: number; episode: Record<string, unknown>; runId?: string | null; scorePass?: number | null; evidenceSha256?: string; decision: { decision: string; verdict?: string | null; scorePass?: number | null; evidenceSha256?: string | null; rationale: string; criterionId: string | null; decidedBy: string; at: string } | null }[];
}

export const DECISION_LABEL: Record<string, string> = {
  agent_failure: 'Accept: the score stands (agent failure confirmed)',
  task_correction: 'Dispute: the task needs correction',
  rubric_correction: 'Dispute: the rubric needs correction',
  grader_wrong: 'Dispute: the grader is wrong',
  environment_wrong: 'Dispute: the environment is wrong',
  cannot_assess: 'Can’t assess',
};

/** The RL Gym sends `score` as a number or as {score, passed, failed_criteria}. */
export function scoreText(score: unknown): string {
  if (typeof score === 'number') return `Score ${score}`;
  if (!score || typeof score !== 'object') return 'Score —';
  const s = score as { score?: unknown; passed?: unknown; pass_mark?: unknown; failed_criteria?: unknown };
  const parts = [`Score ${typeof s.score === 'number' ? s.score : '—'}${typeof s.pass_mark === 'number' ? ` (pass mark ${s.pass_mark})` : ''}`];
  if (typeof s.passed === 'boolean') parts.push(s.passed ? 'passed' : 'not passed');
  const failed = Array.isArray(s.failed_criteria) ? s.failed_criteria.filter((c): c is string => typeof c === 'string') : [];
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  return parts.join(' · ');
}

/** The RL Gym's path summary as sent; "Failed at …" only when no summary came. */
export function pathText(path: { summary?: string; failed_node?: string; failed_why?: string }): string {
  if (path.summary) return path.summary;
  if (path.failed_node) return `Failed at ${path.failed_node}${path.failed_why ? ` (${path.failed_why})` : ''}`;
  return '';
}

const needsCriterion = (decision: string) => decision === 'grader_wrong' || decision === 'rubric_correction';
export function decideHint(d: { decision: string; rationale: string; criterionId: string }): string {
  const missing = [!d.rationale.trim() && 'a rationale', needsCriterion(d.decision) && !d.criterionId.trim() && 'the criterion it is about'].filter(Boolean);
  return missing.length ? `Type ${missing.join(' and ')} to decide.` : 'Ready to decide. A decision is final.';
}
export const canDecide = (d: { decision: string; rationale: string; criterionId: string }) => !!d.rationale.trim() && (!needsCriterion(d.decision) || !!d.criterionId.trim());
