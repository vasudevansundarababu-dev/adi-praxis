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
    - On Project → Benchmark → Benchmark review, a PM or Admin picks one SME of the project for a batch. The pick can be
      changed until the first decision is sent. It is stored in a new append-only assignment table (additive migration)
      and audited.
    - The assigned SME sees the batch in the SME app, with the same episode view and decision choices as staff, and
      decides. Each decision is final and goes to the RL Gym with `decided_by` set to the SME, exactly as today.
    - PM or Admin can still decide any batch themselves.
    - AI hints (`suspected_cause`) stay hints only, and a person decides.
- **Defaults chosen (log; change on request):**
  - Assignment is per batch, one SME at a time. The default choice is the SME who wrote the batch's tasks, when there
    is exactly one.
  - Bell counts are open items, not unread items.
- **Open question for the owner:** the Reviewer role can decide run reviews today. Does it keep that, or is it now only
  PM/Admin and the assigned SME?
- **Status:** planned, waiting for "go". Nothing changed for D-004 yet.
