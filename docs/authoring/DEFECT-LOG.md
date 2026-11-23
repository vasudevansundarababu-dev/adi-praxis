# Authoring defect and fix log

The master list across apps is the design repo's `DEFECTS.md`. This file records the Authoring side: what was found, what
the owner decided, and what was changed, with commits. Owner's rule (23 Nov 2026): investigate and log, ask for
clarification, and fix only in the agreed window. Fixes are committed to `forge-v2-authoring` and not pushed.

## Related change already made (not a defect fix)

| Date | Commit | Change |
| --- | --- | --- |
| 23 Nov 2026 | 3f991887 | The RL Gym asked for this. Review batches with undecided episodes show as one Home tile per batch and as "N to review" on the project's Benchmark tab. Who can see them is unchanged: Admin, PM, Reviewer. |

## D-004 Authoring: inbox (bell / To do) not working

- **Reported:** 23 Nov 2026 by the owner, with the RL Gym's D-002.
- **Finding:** neither Authoring app had an inbox, bell or To do panel, on this branch, on `main` or on any other branch.
  There is no notification table either. This is a missing feature, not a broken one. The only "waiting for you" view
  is the Home page tiles in the staff console.
- **Owner's requirement (23 Nov 2026):**
  1. The staff console has a bell for **PM and Admin** only.
  2. The SME (candidate) app has a bell for what the SME must act on: **Rework** to fix, and **SME review** of RL Gym runs
     they have been asked to validate.
  3. An RL Gym run's output is verified by **PM/Admin, or by the SME alone**. **PM/Admin assigns the SME** to a review.
  4. (Added the same day.) Only **the SME who authored the task**, or **an SME with the Reviewer role on the project**,
     may review that task's run results.
- **Planned fix (F-004), to roll out around 1 PM CST on 23 Nov 2026:**
  - **F-004a Staff bell (PM, Admin).**
    - A bell in the console header with a count. It opens a short list in which each item links to where the work is
      done.
    - Items: tasks awaiting PM approval; RL Gym review batches with no SME assigned; review batches assigned but not yet
      decided; open SME needs.
    - An item disappears when its work is done. There is no separate read or unread state.
    - API: `GET /me/inbox` (staff).
  - **F-004b SME bell (SME app).**
    - A bell in the header with a count.
    - Items: own tasks in Rework (with the reviewer's reason), and run reviews assigned to this SME.
    - Each item links to the task, or to the new run-review page.
    - API: `GET /me/forge/inbox` (candidate).
  - **F-004c Run review assignment and SME decision.**
    - Assignment is **per task within a batch**, because one batch can cover tasks by different authors. Batch smr-0051
      has 2 tasks.
    - On Project → Benchmark → Benchmark review, a PM or Admin picks the SME for each task. Only these SMEs can be
      picked: **the task's author**, or **an SME who is a Reviewer on the project**. The default pick is the author.
    - The pick can be changed until that task's first decision is sent. It is stored in a new append-only assignment
      table (additive migration) and audited.
    - The assigned SME sees those episodes in the SME app, with the same episode view and decision choices as staff, and
      decides. Each decision is final and goes to the RL Gym with `decided_by` set to the SME, exactly as today.
    - PM or Admin can still decide any task's episodes themselves. The server refuses a decision from anyone else.
    - AI hints (`suspected_cause`) stay hints only, and a person decides.
- **Defaults chosen (log; change on request):**
  - Bell counts are open items, not unread items.
  - The staff **Reviewer** role (a console user, not an SME) loses the right to decide run reviews. Today
    `STAFF_REVIEW` allows Admin, PM and Reviewer. The owner named only PM/Admin, the author SME and the SME Reviewer, so
    it becomes Admin and PM only. Staff Reviewers can still read the batches.
- **Status:** FIXED 23 Nov 2026 (owner "go"). Commits 98baabbc (API) and 1730d2b6 (UI). See "Fixes".

## D-012 Authoring: case selectors send `edge_cases: []` for every episode (low)

- **Reported:** 23 Nov 2026, from the run-0228 evidence pack.
- **Finding (investigated, nothing changed):**
  - `caseSelectorOf` in `apps/api/src/anvil/rlgym-export.ts` fills `edge_cases` from two places:
    1. the coverage slot's `edgeCase`;
    2. the Focus edge case the SME picked on the task (package `private.edge_case`).
  - Both are empty for all 4 exported tasks of project f8719e2b ("KYC Customer onboarding for US bank"):
    - The slots carry only the product: adult_joint, individual, teen_joint, custodial.
    - The SME left Focus edge case blank. It is optional today, as are Complexity and Archetype.
  - The last export (23 Nov, 02:32) sent `{application_type: X, edge_cases: []}` for each task. This matches the
    contract: AUTHORING-SNAPSHOT 3.1a and the RL Gym ARCHITECTURE example both allow an empty list. An empty list means
    "no edge-case constraint", not "a standard case".
  - So the RL Gym's sampler was free to draw any case of that product, edge variants included. Which edge case an
    episode got is decided by the RL Gym when it draws the case. Authoring cannot know it per episode. The RL Gym has it
    in its own case catalog (`edge_cases` tags per case) and should record it from there. This follows "RL Gym owns
    input data; Forge declares the case selector".
- **Authoring-side options (plan; nothing built):**
  - **A. No Authoring change.** The RL Gym records each episode's edge case from the case it drew.
  - **B. Make the edge-case choice explicit.** On templates that list edge cases, the task form's Focus edge case gets a
    "None (standard case)" option and becomes required before approval. With None, Authoring sends `edge_cases: []`
    plus a new `standard_case: true`, so the RL Gym can draw only cases without edge tags. Adding that key changes the
    contract, so it needs the RL Gym's agreement.
  - **C. PM sets edge cases on coverage slots.** The project's slot plan can aim some slots at an edge case, so the
    selector carries it without depending on the SME.
  - **Recommendation:** A now. B without the new key (just required, with a None choice) if the owner wants the SME's
    intent always recorded. C later.
- **Status:** resolved 23 Nov 2026 with no contract change (owner "go"), option A. A task with a Focus edge case sends it in `case_selector.edge_cases`; this is proved through the real SME save in commit e4ab41a3. The fields are visible since D-013.

## D-007 (RL Gym) note from Authoring: actor payload has no `assignment` field

- Authoring's actor part (`actorProjection` in `apps/api/src/anvil/generic-package.ts`) is `{sections: S1…S8}` with
  only the public fields, plus `tools` when the template declares tools.
- Neither the export contract (AUTHORING-SNAPSHOT 3.1) nor the generic package agreed for KYC v7/v8 defines an
  `assignment` key. "Assignment, Inputs, Tools, Output" in the RL Gym's SCREENS.md is the RL Gym's own display grouping.
  `PRAXIS-EXPORT-REQUIREMENT.md` asks for "objective, assignment and requested deliverable" as content, which lives in
  the sections.
- The RL Gym reading sections is correct. No Authoring change.

## D-013 Authoring: Rationale box invisible in Benchmark review (high)

- **Reported:** 23 Nov 2026, from the owner's screenshot of batch smr-0051 (run-0228).
- **Finding (investigated, nothing changed):**
  - Every field added on this branch for the RL Gym and Studio link uses `className="input"`. That class is not defined
    in any stylesheet: not in `apps/web/app/globals.css`, `apps/candidate`, or `packages/shared/theme/theme.css`.
  - Tailwind's reset removes a plain input's border and background, so text boxes and text areas render with no visible
    box. Selects still show the browser's arrow.
  - The rest of the console uses `rounded-md border border-line bg-surface px-2 py-1 text-fg`.
  - Fields affected:
    - **Staff console, `apps/web/components/projects/rlgym-panel.tsx`:**
      - Benchmark review: Rationale and Criterion.
      - SME needs: Summary for Studio and Reject reason. This is the real cause of the earlier "Send to Studio is
        always disabled" report. The 97415d59 hint only explains the rule; the box itself is still invisible.
    - **SME app, `apps/candidate/components/work/benchmark-fields.tsx`:**
      - Focus edge case, the expected-result slot fields and the extra state-check fields.
      - Raise an edge case: Context and Twist.
      - These may also be why the 4 run-0228 tasks have no Focus edge case, Complexity or Archetype. See D-012.
- **Planned fix:**
  - Define `.input` once as a component class with the console's field style, in each app's globals, so every
    existing use is fixed together.
  - Add a hint under Decide while it is disabled: "Type a rationale to decide", and, for "Grader was wrong" or
    "Rubric correction", also a criterion.
  - Test: render the panels and the SME benchmark fields and assert that every text control carries a defined,
    bordered class.
- **Status:** FIXED 23 Nov 2026 (owner "go", Benchmark review screen), commit below. See "Fixes".

## D-014 Authoring: "score [object Object]" on review items (medium)

- **Finding:**
  - The panel prints `String(e.score)`. In batch smr-0051 the RL Gym sends `score` as an object:
    `{score: 42.86, passed: false, failed_criteria: [account_agreements, identification_verification, screening,
    state_rule_selection]}`.
  - Authoring's test fixture had a plain number (`score: 40`), so the test missed it. There is no pass mark in the
    payload.
- **Planned fix:**
  - Show "Score 42.86 · not passed · failed: account_agreements, identification_verification, screening,
    state_rule_selection".
  - Keep accepting a plain number.
  - Show the pass mark only if the RL Gym ever sends one.
  - Test with the real shape.
- **Status:** FIXED 23 Nov 2026 (owner "go", Benchmark review screen), commit below. See "Fixes".

## D-015 Path line contradicts itself and repeats the failure (low; split between the RL Gym and Authoring)

- **Finding:** the episode's `path` from the RL Gym is:
  - `summary`: "Took 3 of 8 steps; failed at account (criterion account_agreements fail); not reached: verify, screen,
    account, state, act";
  - `failed_node`: "account";
  - `failed_why`: "criterion account_agreements fail";
  - `order`: [intake, identify, decide].
- **RL Gym's part:** the summary string is the RL Gym's, shown verbatim. Listing "account" as both failed and not
  reached is in the RL Gym's text, and so is "failed at account" when only intake, identify and decide ran.
- **Authoring's part:** the panel appends " · failed at {failed_node} ({failed_why})" after the summary, which repeats
  the failure.
- **Planned fix (Authoring):** show the RL Gym's summary alone when there is one. Build "Failed at … (…)" only when no
  summary is sent.
- **Status:** FIXED 23 Nov 2026 (owner "go", Benchmark review screen), commit below. See "Fixes". The contradictory summary text is for the RL Gym to fix.

## Fixes

| Date | Defects | Commit | What changed |
| --- | --- | --- | --- |
| 23 Nov 2026 | D-013, D-014, D-015 (Authoring's part) | see git log: "Benchmark review: visible fields, score, path, Decide hint" | See the notes below. |

- **D-013:**
  - `.input` is defined once in `packages/shared/theme/theme.css`, which both apps import. Every field that used the
    class now shows its box, in the console and in the SME app.
  - A hint under Decide says why it is off: "Type a rationale to decide.", plus "the criterion it is about" for "Grader is
    wrong" and "Rubric needs correction", since the API refuses those without one.
  - Decide now also stays off until the criterion is typed.
- **D-014:** the score reads "Score 42.86 · not passed · failed: …". A plain number still works, and a pass mark shows
  if the RL Gym sends one.
- **D-015:** the RL Gym's path summary is shown once. "Failed at …" is built only when no summary is sent.
- **Tests:** `apps/web/test/benchmark-review-panel.test.tsx` (4 tests). The web suite (222 tests) and the SME app suite
  (119 tests) pass, and both typechecks are clean.
- **Checked live** on 3100 (batch smr-0051) and 3101.
| 23 Nov 2026 | Task correction path (owner's first priority) | e4ab41a3 | No code change was needed. A new test covers the whole path through the real routes. |
| 23 Nov 2026 | D-012 | e4ab41a3 | Test only. |
| 23 Nov 2026 | D-004 | 98baabbc, 1730d2b6 | Run-review assignment per task, SME decisions, and the two bells. Migration 20261205000000 (one new empty table) applied to the dev database. |

- **Task correction, end to end** (test "task correction end to end"):
  1. A PM chooses "Task needs correction" in Benchmark review. The task goes to Rework with the rationale.
  2. The SME (sourced and assigned) saves the Focus edge case and the form, confirms authorship for the revision, and
     resubmits.
  3. A person approves the task in the console.
  4. Re-export sends revision 2 with `corrects_revision` 1, `sme_batch_id` and `case_selector.edge_cases` holding the
     focus edge case.
  - Staff cannot edit a task directly on an SME → PM project. The only staff edit is the Expert edit, on SME → Expert
    → PM projects, so the correction goes through the SME.
- **D-004, as built:**
  - `RunReviewAssignment` is append-only, one assignment per task in a batch. Only the task's author or an SME Reviewer
    on the project can be assigned. SME Reviewers exist only on SME → Expert → PM projects, so on the live SME → PM
    project only the author can be picked.
  - The assignment can change until the task's first decision. Every assignment is audited.
  - Decisions can be made by PM or Admin (console), or by the assigned SME (SME app, **Run reviews**). The staff
    Reviewer role can read batches but no longer decides.
  - Bells: the console bell is for PM and Admin. It lists tasks to approve, run-review tasks with no reviewer or not
    yet decided, and open SME needs. The SME bell lists own Rework with the reason, and assigned run reviews.
