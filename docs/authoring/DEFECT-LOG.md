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
- **Status:** planned, waiting for "go". Nothing changed for D-004 yet.

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
- **Status:** investigated, plan logged, waiting for the owner's choice and "go".

## D-007 (RL Gym) note from Authoring: actor payload has no `assignment` field

- Authoring's actor part (`actorProjection` in `apps/api/src/anvil/generic-package.ts`) is `{sections: S1…S8}` with
  only the public fields, plus `tools` when the template declares tools.
- Neither the export contract (AUTHORING-SNAPSHOT 3.1) nor the generic package agreed for KYC v7/v8 defines an
  `assignment` key. "Assignment, Inputs, Tools, Output" in the RL Gym's SCREENS.md is the RL Gym's own display grouping.
  `PRAXIS-EXPORT-REQUIREMENT.md` asks for "objective, assignment and requested deliverable" as content, which lives in
  the sections.
- The RL Gym reading sections is correct. No Authoring change.
