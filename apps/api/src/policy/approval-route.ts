import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import { templateBoundFacts } from './fact-catalog';
import { ruleQueueFlags } from './review-queue';

/**
 * D-091 (owner, 26 Nov 2026): one approval route. A project that builds a policy library (KYC Judgment: its template
 * binds the environment's facts, `policy_bindings.facts`) approves rules through the review queue only; the server
 * refuses to mark a flagged rule Reviewed by any route, with the same check as Confirm selected. Every other project
 * (a fact catalog alone, for clause conditions, does not count) keeps the Apply to project tick exactly as it was.
 */
export type ApprovalRoute = 'review_queue' | 'apply_tick';

export async function approvalRoute(tx: Db | Tx, projectId: string): Promise<ApprovalRoute> {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { template: { select: { anvilSpec: true } } } });
  return (templateBoundFacts(project?.template?.anvilSpec ?? null)?.facts.length ?? 0) > 0 ? 'review_queue' : 'apply_tick';
}

/** Refuses to approve a flagged rule in a policy-library project (409 RULE_FLAGGED, the batch's wording). */
export async function assertApprovable(tx: Db | Tx, input: { clientId: string; projectId: string; ruleId: string; ruleKey: string }) {
  if ((await approvalRoute(tx, input.projectId)) !== 'review_queue') return;
  const flags = await ruleQueueFlags(tx, input.clientId, input.projectId, input.ruleId);
  if (flags.length) throw new AppError(409, 'RULE_FLAGGED', `${input.ruleKey} is flagged (${flags.map((f) => f.code).join(', ')}): open it and review it on its own, then confirm it in the review queue.`, { flags });
}
