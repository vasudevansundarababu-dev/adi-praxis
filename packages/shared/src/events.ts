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
  // M10 (SME supply): identity verified for an SME user; partner webhook fan-out
  'sme.identity_verified',
  'guidelines.generate',
  'cert.certified',
  // Internal-user administration (M0)
  'user.created',
  'user.roles_changed',
  'user.status_changed',
  'user.password_reset',
  // Templates Meta-Compiler (docs/architecture/ARCH-TEMPLATES-META-COMPILER.md section 6 and 7)
  'compiler.generation_requested',
  'compiler.verification_requested',
  'studio.task_committed',
  // Post-commit LLM judge: enqueued when per-task verification has recorded measured scores.
  'studio.task_verified',
  // Policy Rules (docs/architecture/ARCH-POLICY-RULES.md section 4): one event per extraction job.
  'policy.extraction_requested',
] as const;
export type DomainEventName = (typeof DOMAIN_EVENTS)[number];
