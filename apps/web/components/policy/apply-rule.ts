'use client';

import { mutate, type MutationResult } from '@/lib/client-api';

export interface ApplyTarget {
  ruleId: string;
  contentHash: string;
  definitionProblems: string[];
  evidenceProblems: string[];
}

export type ApplyOutcome =
  | { kind: 'done'; applied: boolean; warnings: string[] }
  | { kind: 'confirm'; target: ApplyTarget; problems: string[] }
  | { kind: 'error'; text: string };

type Mutate = <T>(method: 'POST' | 'PUT', path: string, body?: unknown) => Promise<MutationResult<T>>;

/**
 * Ticks or unticks Apply to project for one rule (PRD PR-M04..M06). The PM's tick is the review. Before applying, a rule
 * with definition gaps is first defined with AI (a draft edit), and a rule with unverified evidence comes back as
 * "confirm" until the PM confirms they checked the source. The AI never ticks anything.
 */
export async function setRuleApplied(projectId: string, t: ApplyTarget, applied: boolean, opts: { acceptUnverifiedEvidence?: boolean; onStage?: (s: string) => void; call?: Mutate } = {}): Promise<ApplyOutcome> {
  const call = opts.call ?? (mutate as Mutate);
  let target = t;
  if (applied && target.definitionProblems.length > 0) {
    opts.onStage?.('Defining with AI…');
    const d = await call<{ contentHash: string; definitionProblems: string[]; evidenceProblems: string[] }>('POST', `/projects/${projectId}/policy/rules/${t.ruleId}/define`, { expectedContentHash: t.contentHash });
    if (!d.ok) return { kind: 'error', text: d.error ?? 'Could not define this rule.' };
    target = { ruleId: t.ruleId, contentHash: d.data!.contentHash, definitionProblems: d.data!.definitionProblems, evidenceProblems: d.data!.evidenceProblems };
  }
  if (applied && target.evidenceProblems.length > 0 && !opts.acceptUnverifiedEvidence) return { kind: 'confirm', target, problems: target.evidenceProblems };
  opts.onStage?.(applied ? 'Applying…' : 'Removing…');
  const r = await call<{ applied: boolean; warnings: string[] }>('PUT', `/projects/${projectId}/policy/rules/${t.ruleId}/applied`, { applied, expectedContentHash: target.contentHash, ...(opts.acceptUnverifiedEvidence ? { acceptUnverifiedEvidence: true } : {}) });
  if (!r.ok) return { kind: 'error', text: r.error ?? 'Could not save.' };
  return { kind: 'done', applied: r.data!.applied, warnings: r.data!.warnings };
}
