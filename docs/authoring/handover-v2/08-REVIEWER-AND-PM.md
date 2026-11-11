# 08 Expert reviewer and PM screens

## Review workspace

Open a frozen submission version. Header shows task/project/template, submission revision, policy snapshot, assigned Expert and approval responsibility. Authoring view used by the SME is provenance, not a separate review record. The Expert can inspect the same task regardless of Classic/Chatbot selection. Keep the horizontal graph below the evidence/assessment workspace, with nodes linked to field-specific comments and rubric/rule bindings.

| Field/control | What the Expert does | Guard / help |
|---|---|---|
| Submitted revision and policy snapshot | Verify exactly what was submitted and which rules apply. | Read-only identity; never approve a moving draft. |
| Case brief and evidence | Check requested work, dates, source rights, gaps and consistency. | Agent brief must not expose the reference answer. |
| Original uploaded policy | Inspect actual pages and declared bank/customer authority. | Extraction/classifier output is only a proposal. |
| Rule/source comparison | Verify faithful requirement, scope, exceptions, effective date and locator. | A valid rule ID does not prove correct applicability. |
| Reference solution | Check supported steps, findings, recommendation and uncertainty. | No fabricated evidence or mandatory SSN/TIN assumption. |
| Tools and responses | Check schema, argument/result consistency, permissions and missing/error behaviour. | Recorded response is a fixture, not a live check receipt. |
| Graph nodes and routes | Inspect role work, joins, decisions, human interaction and bounded loops. | Missing runtime/export contract is an explicit blocker. |
| Rubric | Check observable full/partial/zero anchors, total weights, critical semantics and valid alternatives. | Grade correctness rather than identical prose. |
| Automated findings | Resolve blocking checks; explain accepted warnings where allowed. | Human override cannot silently waive schema/rights/export integrity. |
| Authorship/similarity signals | Review declaration and matched passages with context. | Never claim proven AI use or automatically reject/payhold from a score. |
| Field/node comment | Name the defect, expected correction and relevant evidence/rule. | Required for return; preserve exact target ID and revision. |
| Expert edit | Make an authorised correction with reason and before/after diff. | Audit reviewer identity; material changes invalidate downstream acceptance and require revalidation/author confirmation policy. |
| Return for correction | Send task back to Authoring with actionable comments. | Preserve same task; do not create a second payable task. |
| Complete expert review | Record review of this revision and route to PM. | Not final task approval; no immediate payment command. |

## Example review comment

“Reference step S3 asserts that both identifiers are mandatory. Link the published rule and establish the applicant category/jurisdiction or change this to an unresolved applicability finding. Update criterion C2 so it does not reward an unsupported requirement.” This is actionable and names the dependent fields. “Bad quality” is not an adequate correction request.

## PM final approval screen

Show the reviewed revision/hash, Expert decision, unresolved comments, policy document/rule approvals, final validation run/version, export readiness, coverage contribution and earning eligibility. PM may approve the exact eligible revision or return it. The UI must not say a benchmark ran or a payment was sent merely because a task was approved. Display “Approved; export adapter missing” when acceptance exists but executable readiness does not.

If Expert and PM are the same authorised person, record both responsibilities and the same actual actor; do not fabricate another reviewer. A project review route must state whether this is allowed. The demo can use the existing authorised Admin review route while the new two-stage engine is unimplemented.

## Additional policy review

Review the SME document separately from the task. A task can be returned because the proposed policy is unreadable, unrelated or unsupported; the policy must not enter authoritative retrieval during the wait. Expert qualification/rule review and final publication authority remain distinct. If a task depends on the pending document, submission/approval is blocked with a linked reason rather than silently using the upload as authority.

## Target stage transitions

SME submits -> Pending/Expert -> Expert completes review -> Pending/PM -> PM approves -> Approved. Either responsible stage can return to Authoring. Resubmission creates a new immutable submission version and renews required checks. Editing an approved case creates a new revision requiring a new review path; never mutate an exported accepted record.

## Existing permission gap

Current TaskReview supports append-only ACCEPT/REWORK/REJECT decisions, with REVIEWER/ADMIN endpoints and checklist/comments. Plain PM final acceptance and a configurable two-stage engine are not established by that model. Add explicit stage/authority/version checks and migration tests. Preserve existing review, payment and dataset behaviour rather than renaming statuses and assuming equivalent semantics.
