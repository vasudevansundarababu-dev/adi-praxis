# Review routes: SME → PM and SME → Expert → PM (authoring v2.1 Wave 2)

Source: handover ch. 08, ch. 14 (review routes), ch. 17 §2, §4 and §12, ch. 18; plan §4 Wave 2. Decisions: `docs/DECISIONS.md`,
"Authoring v2.1 Wave 2: Expert → PM review route".

A project chooses its route when it is created (`Project.reviewRoute`). The route is frozen once the project has tasks
(409 `REVIEW_ROUTE_FROZEN`). Platform review is never a node inside the authored workflow graph.

## SME → PM (default, unchanged)

Submit → Pending (PM approval) → a Validator assigned to the project, or an Admin, accepts, returns for rework or
rejects with `POST /review/tasks/:id/decision`. Nothing about this route changed; existing data keeps `stage = NULL`.

## SME → Expert → PM

| Step | Who | What happens |
|---|---|---|
| Submit | Author | New immutable submission version, checks run, task `SUBMITTED` with `reviewStage = EXPERT_REVIEW`. |
| Pass | Expert | Checklist all "yes" (and duplicate / open-slot confirmation as before). Binds to the version and its content hash. Stage becomes `PM_APPROVAL`. Not an approval: no record, no earning. |
| Return | Expert or PM | At least one comment pinned to a section, a graph node or a field. Same task back to Authoring (`REWORK`); `reworkCount` + 1. |
| Reject | Expert | As the one-step reject (slot released; real data quarantined). The PM cannot reject; it approves or returns. |
| Edit | Expert (at either stage) | Whole edited output plus a required reason and an explicit "material?" answer. Creates a new version, re-runs the task checks (author attestations excepted) and the duplicate search, recompiles the export contract, and voids every earlier pass. Minor edit: back to Expert review. Material edit: back to the author (Authoring) to reconfirm by resubmitting; not counted as author rework. |
| Approve | PM of the project, or Admin | Only for the version the Expert passed, with the same content hash. Writes the `ApprovedTaskRecord` and emits `task.accepted` (the single earning) in the same transaction. |

Who may act:

- **Expert**: a Validator assigned to the project (`ProjectReviewer`). Admins too, but only when assigned. Never the
  author (matched by email, Admins included on this route), never with an open conflict declaration. Otherwise 403
  `NOT_PROJECT_EXPERT`, or 404 for someone with no role on the project.
- **PM approval**: the project's owning PM, or an Admin. Otherwise 403 `NOT_PROJECT_PM`.
- **Same person**: allowed. A PM who is also an assigned Validator passes and then approves; that is two `TaskReview`
  rows and two audit events (`task.expert_passed`, responsibility `EXPERT`; `task.accepted`, responsibility `PM`,
  `samePersonAsExpert: true`). The screen tells them they hold both responsibilities.

Binding and staleness. Every stage request carries `expectedVersion` (the submission version shown) and
`expectedRevision`. A decision for an older version gets 409 `STALE_STAGE_DECISION` with `expectedVersion` and
`currentVersion`; a decision for the wrong stage gets 409 `WRONG_STAGE`. A pass is in force only while its version is
the latest and its content hash matches; the reviewer screen marks earlier passes "void". The one-step decision endpoint
refuses two-stage tasks (409 `STAGE_DECISION_REQUIRED`) so no responsibility can be skipped.

## Data

- `TaskInstance.reviewStage` (`EXPERT_REVIEW` | `PM_APPROVAL` | null).
- `TaskReview` (append-only, unchanged trigger) gains `stage`, `contentHash`, `editReason`, `material`, and the decisions
  `PASS` and `EDIT`. PM approval is stored as `ACCEPT` with `stage = PM_APPROVAL`.
- An Expert edit is a `TaskSubmission` version like any other (same policy snapshot as the version it replaced), plus
  an `EDIT` review row with the reason.

## Audited

`task.submitted` (with `stage`), `task.expert_passed`, `task.expert_edited` (from/to version and hash, reason, material,
changed field paths, voided decision ids), `task.rework_requested` (with `stage` and `responsibility`), `task.rejected`,
`task.accepted` (version, content hash, Expert id and time, `samePersonAsExpert`). Every command is idempotent
(`Idempotency-Key`) and runs under a row lock.

## Screens

- Console review page (`/review/tasks/:id`): route and current stage, who passed which version, stage history with
  void decisions, the diff from the previous version, pinned comments, and only the actions the viewer may take. The
  Expert edit is a JSON editor with reason and materiality (a field-level editor is left for later).
- Review queue: Expert-review tasks for assigned Validators, PM-approval tasks for the project's PM; a stage pill.
- SME task view: "Review pending: Expert review" / "Approval pending: PM approval" from the stored stage; a material
  edit shows its reason as the latest review.
