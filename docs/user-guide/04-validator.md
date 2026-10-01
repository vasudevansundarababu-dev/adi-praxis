# 4. Validator

A Validator is the person who decides. AI gives recommendations; you make every selection, task acceptance, RL
verdict, grade and certification decision. You see the review queues of projects you are assigned to.

Home shows "Applications to decide", "Tasks to review", "RL reviews" and "Certification reviews".

> If you know a candidate or author, declare a conflict. You will not see their applications or tasks.

## 4.1 Decide applications

1. **Reviews → Applications**. Filters: Waiting for review, More information requested, Selected, Not selected.
2. Open an application and read:
   - **Criteria and assessment**: each criterion as met, partially met, not met or unknown, with the reason and the
     profile items it cites. "A recommendation only; check the cited profile items." If the assessment failed, choose
     **Retry assessment** or **Review without a recommendation**.
   - **Submitted profile** and **Roles**.
   - **Credentials and evidence**: **Review claim** → Level \* (document supported, independently verified,
     inconclusive, contradicted, expired) and **How you checked \*** → **Save**. Files open only when the virus scan
     is clean; opening one is recorded in the audit log.
3. Under **Your decision** choose an outcome:

| Outcome | You also fill |
| --- | --- |
| **Select for this pool** | **Approved scope**: Domain \*, Specialty, Jurisdictions, Languages, **Task roles \***, Re-review by |
| **Ask for more information** | **The one thing you need to know \*** |
| **Not selected for this pool** | Optionally the related criterion |

4. Always fill **Reason (task-related, for the record) \*** and **Message to the candidate \***: "Respectful and
   specific to this pool. Never a judgement of the person."
5. Select **Record decision**.

When a candidate asks for a review of a "not selected" decision, you see their request and **Reconsider**: **Reopen for
decision** or **Ask for more information**. The earlier decision stays on record.

**Declare a conflict**: open "Declare a conflict", enter **Details \*** and select **Declare conflict**. The application
leaves your queue.

## 4.2 Identity reviews and conflicts

- **Reviews → Identity reviews**: candidates who could not use the automated check. **Record decision** → **Alternative
  method used \***, Notes (never ID numbers) → **Verified by alternative process** or **Not verified**.
- **Reviews → Conflicts**: conflicts candidates declared in onboarding. They cannot be proposed for work until
  resolved. **Resolve** → **How it was resolved \*** → **Mark resolved**.

## 4.3 Requisition submissions

On **Projects → Requisitions** → a requisition → **Submissions**, the requirement screen marks some candidates "May not
meet". Only you can confirm it.

1. Tick rows (or **Select all recommended "not met"**).
2. Enter **Note for the record (task-related) \***.
3. **Confirm not met (n)** (the partner and candidate are told) or **Mark as meeting (n)**.

## 4.4 Review a task

**Reviews → Task reviews** lists submitted tasks. Likely duplicates and possible real data come first. You never see
your own tasks.

1. Open a task. Check:
   - **How this task was made**: which sections were AI-drafted and whether the author edited them ("Sections left
     unchanged from the draft deserve a closer look"), the files and interview it was drafted from.
   - **Automated checks** and **Possible real data, explained by the author**.
   - **Similar tasks**: side-by-side with the closest match, with text and structure similarity.
   - **Task**: W02 Scenario, W03 Evidence and tool calls, W04 Reference trajectory, W05 Rubric and failure modes.
   - After rework: "Changed since the last version: …".
2. Answer every **Checklist \*** item Yes or No: Realistic; Correct; Covers the slot's edge case and tags are accurate;
   Difficulty rating is fair; Distinct from the closest tasks; Rubric would catch the listed failure modes.
3. Choose a **Decision \***:

| Decision | Rule |
| --- | --- |
| **Accept** (or **Accept as distinct** for a likely duplicate) | Every checklist item must be Yes. For an open slot, confirm the tags and the **Edge case \***. Writes the task to the Approved Task Dataset |
| **Request rework** | Add at least one comment pinned to a section (W01–W06). The author sees them in the workbench |
| **Reject** | **Reason \***: Duplicate, Not realistic, Incorrect, or "Contains real data (quarantine)" |

4. Optionally add **Notes**, then **Record decision**.

## 4.5 RL reviews

RL Gym sends results that need a human verdict.

1. **Reviews → RL reviews** (Open). Open one and select **Claim this review**.
2. Compare the **Original approved task**, the **Trajectory** (use **Comment on this step**) and the **Automated evals**
   (Agree or Disagree; Disagree needs **Why \***).
3. Choose a **Verdict \***: pass, fail, or Needs an expert. Add comments with a reason code. A fail needs at least one
   comment.
4. **Submit verdict**. It is permanent (append-only) and sent to RL Gym. The page shows the delivery status.

## 4.6 Certification reviews

**Certification → Certification reviews**. The model grades written answers as a recommendation only; nobody is
refused on a model's score alone.

- **Written answers to grade**: read the stem, rubric and answer, and the "Recommendation — you decide". Enter **Your
  grade (0 to 1) \*** (or **Start from the recommendation**) → **Confirm grade**. Some answers need a second person.
- **Certifications that need a decision**: **Certify**, **Allow another retake** or **Not certified**, with a
  **Reason \*** that is shared with the candidate → **Record decision**. Certify stays disabled until a required
  licence is confirmed.
- **Licences to check**: open the certificate, check it (for example against the issuing body's register), enter a
  **Note \*** → **Confirm licence** or **Reject licence**.

You can also open **Certification → Guidelines** to read courses and blueprints, and **Approve family** for Expert-tier
item families.

## 4.7 Pay holds

If you find a dispute or a fraud concern about an SME, ask Finance to place a pay hold (see the [Finance
chapter](05-finance.md#52-earnings-and-holds)). The API lets a Validator place holds, but the Payments pages are not
in the Validator menu in release 1.1.
