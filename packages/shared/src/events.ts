/** Domain event names emitted through the outbox (SPEC: API surface). */
export const DOMAIN_EVENTS = [
  'project.ready_for_staffing',
  'project.staffed',
  'project.completed',
  'project.coverage_met',
  'candidate.approved',
  'candidate.assigned',
  'task.submitted',
  'task.reclaimed',
  'task.accepted',
  'task.duplicate_flagged',
  'task.draft.requested',
  'slot.filled',
  'rl_review.requested',
  'rl_review.completed',
  // FLOW 2 (SME candidate flow)
  'enrollment.submitted',
  'enrollment.decided',
  // Internal-user administration (M0)
  'user.created',
  'user.roles_changed',
  'user.status_changed',
] as const;
export type DomainEventName = (typeof DOMAIN_EVENTS)[number];
