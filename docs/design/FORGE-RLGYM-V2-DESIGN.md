# ADI Forge changes for the new RL Gym and Studio: design

22 November 2026 · Status: **design agreed with the owner, not built.** Code starts only on the owner's yes, one part at a time.

**Input:** `adi-labs-design` → `praxis/AUTHORING-SNAPSHOT.md` (22 Nov 2026) and its `CHANGES.md` (F-01..F-11). Section
numbers such as §3.1 a refer to the snapshot.

## Principles

- **The author experience does not change.** The workbench, AI assist, suggestions, drafting, checks and submit stay
  as they are. The one addition is **Send a need to PM** (part 4).
- Projects, staffing, assignment, the SME task form, reviewer decisions, idempotency, error bodies and JCS hashing do
  not change.
- **The old RL Gym is decommissioned.** Forge talks only to the new RL Gym. Its outbound path is removed, not kept
  behind a flag.
- The new RL Gym and Studio are **not deployed in GCP yet**; both run locally. Forge reaches them through settings, and
  shows "not connected" when a setting is empty (QA today).
- AI never decides. RL Gym's `suspected_cause` is a hint; a Reviewer makes every decision.
- New records (packages, export runs, review batches, decisions, needs) are append-only in the database; every
  mutation is authorised, idempotent and audited.
- Tests use Forge's own mocks of RL Gym and Studio, built from the snapshot contracts. Forge does not run RL Gym's
  `forge_stub.py`.

## Owner decisions (22 Nov 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Can authors raise needs? | Yes, **to the PM only**. Reviewers can too. Only the PM sends needs to Studio. |
| 2 | How a corrected task comes back | **Normal Rework**, with the reviewer's rationale as the rework note |
| 3 | Who reviews benchmark batches | The project's **Reviewers and its PM** |
| 4 | Old export path | **Drop it.** Old RL Gym decommissioned; new RL Gym only |
| 5 | Export cadence | **PM presses Export / Re-export.** No automatic export |

## Authoring experience is protected (owner, 22 Nov 2026)

The SME screens for **Policy** and **Authoring** keep all their AI assist. This work does not edit, move, remove or
gate any of it:

| SME screen | AI assist that stays exactly as built | Code (not touched by this work) |
|---|---|---|
| Authoring | Drafting assist, suggested text, field help and tutorials, rubric recommendations, assistant chat | `routes/drafting.ts`, `routes/suggestions.ts`, `routes/forge-help.ts`, `routes/rubric.ts`, `routes/conversation.ts`, `forge/task-help.ts` |
| Policy | Document reading and extraction, policy annotations, rule assistant, policy proposals | `routes/policy.ts`, `routes/policy-proposals.ts`, `policy/*` (`rule-assistant.ts`, `annotations.ts`, `extraction/`, ...) |

Rules for every part of this build:

1. **No change** to those files, their routes, their prompts, model settings (`SUGGESTION_*`, `PROFILE_MODEL`, ...) or
   their AI caps. If a part seems to need one, stop and ask the owner.
2. The submit checks authors see, including the "RL Gym export" package checks in `tasks/revalidation.ts`, are Forge's
   own and stay. Removing the old RL Gym client (part 2) touches only `routes/project-export.ts`, `anvil/export-client.ts`,
   the validator wiring in `app.ts` / `config.ts`, and the PM's project page.
3. The only new author-facing element is **Send a need to PM** (part 4): one action on the task page that opens a small
   form. It does not change the workbench layout, and no AI step depends on it.
4. Rework from benchmark review uses the existing Rework path, so a corrected task opens in the same workbench with
   the same AI assist.
5. **Regression gate:** each part's PR must pass, unchanged, the existing API and Playwright tests for authoring, AI
   assist (drafting, suggestions, rubric, help) and Policy, plus a new e2e that walks an SME through a task with AI
   assist on and a policy annotation, before and after the change. A part with any failure there is not merged.
6. QA sign-off: after each deploy, the owner's live session checks AI assist on the Authoring and Policy screens before
   the part is called done.

## Part 1. Packages by hash (§3.1 a)

- Today packages exist only as multi-task export ZIPs (`apps/api/src/anvil/generic-package.ts`).
- New table `authored_task_package`: one row per approved revision, keyed by `package_sha256`, holding the canonical
  JSON (`praxis.authored-task-package.v1`). Written when a revision is approved. Append-only, enforced in the database.
- Route `GET /api/v1/packages/{package_sha256}` at the path RL Gym already uses. ANVIL keys only. 404 for an unknown
  hash. Returns JCS bytes.

## Part 2. Project export and re-export (§3.2 a)

- New `RlGymProjectClient`: JSON, `Authorization: Bearer <RL Gym key for Forge>`, `Idempotency-Key = export_sha256`.
  Reply and error handling follow the existing client's rules (business results kept apart from auth, transport and
  availability errors; the key is never logged).
- `POST {RLGYM_BASE_URL}/api/v1/workspaces/{ws}/projects/{project_id}/exports` with `rlgym.project-export.v1`, built from
  the project's current approved records (`currentRecords` in `routes/project-export.ts`):
  - `case_selector` comes from the task's coverage slot (`CoverageSlot.coverageTags`) and the template's case
    dimensions. **The author does not pick it**; the slot brief already tells them which case to write.
  - Revisions above 1 carry `corrects_revision` and `sme_batch_id`. Unchanged tasks are sent again; RL Gym recognises
    them by hash.
  - The package itself is not in the body; RL Gym fetches it from part 1.
  - Tasks waiting on a `new_case_kind` need (part 4) are held out.
- The Forge readiness checks before export (D18 revalidation) stay; they are Forge's own.
- Each export run is kept append-only with RL Gym's receipt per task (imported, superseding, unchanged, blocked).
- Project page: **Export for benchmark**, **Re-export**, export history with receipts, and "In RL Gym" on task rows.
- **Removed:** the old ZIP `validate` / `resolve` client (`anvil/export-client.ts`), the ZIP project export, and the
  project **Validate** button, including multi-select Validate (PR #102). The new contract has no Validate.
- **Kept:** routes RL Gym and Studio call into Forge (`/integrations/anvil/templates/validate`, `proposals`,
  `proposals/{id}`, `qualifications`), and the offline export job for handing RL Gym a package by hand until it is
  deployed.

## Part 3. Benchmark review (§3.1 b, §3.2 b)

- `POST /api/v1/projects/{project_id}/run-reviews` (ANVIL keys) accepts `rlgym.sme-review-package.v1` and replies
  `202 {"forge_batch_ref"}`. Idempotent by `batch_id`. Stored append-only. Reference answers are never in a batch.
- New project tab **Benchmark review**, for the project's Reviewers and PM: batches; per episode the rubric, path,
  timeline, final output and evidence hashes; RL Gym's suspected cause shown as a hint.
- A decision needs a rationale and the reviewer's name, and `criterion_id` for `grader_wrong` and
  `rubric_correction`. One decision per item, enforced in the database.
- Decisions go to `POST /sme-review-batches/{batch_id}/decisions` (`rlgym.sme-decisions.v1`) through the outbox, so a
  failed send retries safely.
- `task_correction` sends the task to **Rework** through the existing path (`reworkForValidation`), with the rationale as
  the rework note. The author fixes it in the same workbench and it is approved as usual. The next re-export carries
  the new revision.
- `grader_wrong`, `rubric_correction`, `environment_wrong`: recorded in Forge; RL Gym handles what follows, including
  any Studio inbox item.

## Part 4. SME needs to Studio (§3.3)

- **Authors:** one **Send a need to PM** action on the task page: type (More data, New edge case) and a short note.
  Nothing else on the author screen changes.
- **Reviewers** can raise a need from Benchmark review.
- Project page **SME needs**: the PM merges, sends or rejects. Only the PM sends.
- Sending goes through the outbox to `POST {STUDIO_BASE_URL}/api/v1/inbox-items` (`kind`, `source: "adi-forge"`,
  `template_id`, `version`, `project_id`, `summary`, `evidence`, `needed_by`). Unknown fields are not sent.
- Status: Forge reads `GET /api/v1/inbox-items/{id}`. Studio's status webhook has no sender yet and is not built.
- This keeps the rule that every template change is a Studio release; Forge only sends requests.

## Part 5. Keys and settings (§3.4 Admin)

- `RLGYM_BASE_URL`, `RLGYM_WORKSPACE`, `STUDIO_BASE_URL`: names in `.env.example`. Locally they point at the local
  RL Gym and Studio; in QA they are empty until both are deployed.
- RL Gym's key for Forge and Forge's key for Studio live in Secret Manager or local env, never in the database, chat,
  logs or the browser. Admin → API clients shows only whether each is set.
- When a URL or key is missing, the project page says "RL Gym isn't connected yet" (or Studio) and the buttons are off.
- The template version shows Studio's Template ID (display only).
- Lands with part 2.

## Open items

| # | Item | Default until decided |
|---|---|---|
| 1 | Production key for Forge → Studio inbox | A Forge service key issued by Studio; stubbed until Studio decides |
| 2 | Review deadline | None; show each batch's age |
| 3 | Inbound calls in QA | Only once RL Gym and Studio are deployed and can reach Forge |

Not in scope now: F-01..F-09 and the Studio status webhook (§3.5).

## Build order

1. Part 1: package store and fetch route.
2. Part 2 with part 5: export / re-export, removal of the old path, settings.
3. Part 3: benchmark review.
4. Part 4: SME needs, including **Send a need to PM**.

Each part: tests for its acceptance criteria against mocks only, and the existing author tests pass unchanged.
