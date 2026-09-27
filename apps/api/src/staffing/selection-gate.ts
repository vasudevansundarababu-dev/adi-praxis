import type { Db, Tx } from '../db';
import { assignmentEligibility } from '../candidate/onboarding-service';

export type GateResult =
  | { ok: true; enrollmentId: string | null; snapshot: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Whether a candidate may be proposed for (or accept) work on a project: selected by a human reviewer, onboarded,
 * identity eligible, scope current, no unresolved conflicts (FLOW2 section 9).
 */
export interface SelectionGate {
  check(tx: Db | Tx, args: { candidateId: string; projectId: string }): Promise<GateResult>;
}

/** The real gate (M4c). */
export const dbSelectionGate: SelectionGate = {
  async check(tx, args) {
    const c = await tx.candidate.findUnique({ where: { id: args.candidateId } });
    if (!c) return { ok: false, reason: 'candidate not found' };
    return assignmentEligibility(tx, { smeUserId: c.smeUserId, projectId: args.projectId });
  },
};

/**
 * TEST DOUBLE for staffing tests that exercise matching and capacity without the candidate journey. Everyone passes,
 * with no enrollment, so assignments are recorded as direct (already accepted). Never used by the running app.
 */
export const stubSelectionGate: SelectionGate = {
  async check() {
    return { ok: true, enrollmentId: null, snapshot: {} };
  },
};
