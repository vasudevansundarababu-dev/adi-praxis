/**
 * The three top-level task states of handover v2.1 (ch. 17 §2, ch. 18): Authoring, Review/Approval Pending and
 * Approved, derived from the stored task status. Pending names the responsible stage. Rework returns to Authoring.
 * Rejected is terminal and shown separately; it is not one of the three working states.
 */
export const TASK_PHASES = ['AUTHORING', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];
export const PENDING_STAGES = ['EXPERT_REVIEW', 'PM_APPROVAL'] as const;
export type PendingStage = (typeof PENDING_STAGES)[number];

export interface TaskPhaseView {
  phase: TaskPhase;
  stage: PendingStage | null;
  label: string;
}

export function taskPhase(status: string, opts: { reviewRoute?: 'SME_PM' | 'SME_EXPERT_PM'; pendingStage?: PendingStage | null } = {}): TaskPhaseView {
  switch (status) {
    case 'SUBMITTED': {
      const stage: PendingStage = opts.pendingStage ?? (opts.reviewRoute === 'SME_EXPERT_PM' ? 'EXPERT_REVIEW' : 'PM_APPROVAL');
      return { phase: 'PENDING', stage, label: stage === 'EXPERT_REVIEW' ? 'Review pending: Expert review' : 'Approval pending: PM approval' };
    }
    case 'ACCEPTED':
      return { phase: 'APPROVED', stage: null, label: 'Approved' };
    case 'REJECTED':
      return { phase: 'REJECTED', stage: null, label: 'Not accepted' };
    case 'REWORK':
      return { phase: 'AUTHORING', stage: null, label: 'Authoring: returned for rework' };
    default:
      return { phase: 'AUTHORING', stage: null, label: 'Authoring' };
  }
}
