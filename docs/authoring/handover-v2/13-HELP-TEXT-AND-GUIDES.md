# 13 Detailed help copy and role operating guides

## Instruction PDF structure for every template

Keep six sections in each domain specification: 1 Task anatomy; 2 Synthetic/test-data rules; 3 Expected solution and rubric; 4 Author workbench; 5 Automated checks and review; 6 Example, acceptance criteria and open questions. These are specification chapters, not the same as the eight navigation sections. Each template PDF must explain what the user will produce, what each field means, what to enter, an illustrative example, validation expectations, what remains private and how corrections work. Review pages must explain the Expert/PM's actions separately.

Do not use “fictional” in SME-facing copy. Use authorised test-data guidance without implying that real personal/confidential data is automatically allowed. Instructions should explain real professional judgement and realistic case complexity. Examples teach the structure; they are not insertable current-task answers.

## Exact reusable help copy

| Location | Suggested text |
|---|---|
| Welcome | “Create one complete benchmark task. Supply the case, evidence, expected work and grading guidance in your own words. Your work saves to this assigned task.” |
| Classic/Chatbot switch | “Both views use the same task. Confirmed fields and your unsent chat answer are retained when you switch.” |
| Save in progress | “Saving your latest changes. Please wait before leaving this view.” |
| Failed save | “Your answer is still here, but the server has not confirmed the save. Retry before switching or leaving.” |
| Stale revision | “This task changed in another session. Review the saved version and reconcile your unsaved wording before continuing.” |
| Empty records | “No items recorded yet. Choose Add to open the fields for an evidence record, response or criterion.” |
| Chat role | “I can ask task-specific questions and organise your wording. You must supply the substantive case and reference answer.” |
| Off-topic | “I can help with this assigned task. Please answer the current field or select another task section.” |
| Generate-answer request | “Please write your own assessment. I can explain the field and identify missing information, but I cannot author the answer for you.” |
| Missing identifier | “Which jurisdiction and customer category apply? Identify the approved rule or exception before treating this identifier as required.” |
| Policy selection | “Select an approved rule and explain which step it applies to, including scope and exceptions.” |
| Policy upload pending | “This document is pending review. Its rules cannot yet be used as project authority.” |
| Non-policy upload | “This appears to be supporting material rather than a policy. Explain its purpose or submit an appropriate policy for review.” |
| Proposal | “Review the supplied wording, its field placement and affected dependencies. Confirming updates this task revision; it does not approve the task.” |
| Graph | “This is the process the benchmark agent should follow. It is not a record of an executed run.” |
| Human node | “This business reviewer belongs to the case. Expert review and PM approval of your authored task are separate.” |
| Loop | “Specify the return destination, exit condition and maximum cycles. State what happens if the issue remains unresolved.” |
| Agent view | “Inspect only what the benchmark agent will receive. Private reference answers and grading must not appear here.” |
| Similarity | “These matches need human interpretation. Shared policy quotations and templates may be legitimate. A match does not prove misconduct.” |
| Submit | “Submit this saved revision for the configured human review. Unresolved blockers must be corrected first.” |
| Approved, not executable | “Task approved. Executable benchmark export is blocked until the required contract/adapter is supplied.” |

## SME quick guide

Read the assignment and instruction PDF. Check template mode and project editor availability. Author the case before the reference answer; create stable evidence IDs and explicit gaps. Link only approved project rules. Supply each allowed recorded tool response and expected step yourself. Define supported findings, recommendation, uncertainty and rubric anchors. Inspect the horizontal graph, any human/loop conditions and View as Agent. Resolve cross-field changes and save warnings. Declare your own work for the current revision and submit. On rework, open pinned comments and resubmit the same task after corrections.

## Expert quick guide

Check exact submission and policy versions. Read the original evidence/policy, not only the model extraction. Verify applicability, exceptions, source locators, findings, tools, graph routing, human authority, loop limits and grading alternatives. Resolve automated blockers; interpret similarity/authorship signals with judgement. Name fields/criteria/nodes in correction comments. Record edits and reasons. Complete expert review for that revision or return it. Do not imply final PM approval or a successful benchmark run.

## PM/Admin quick guide

Prepare template/project/JD/policies/qualification/assignments. Review authority and pay terms before publishing work. At final review check Expert completion where required, the exact version, open blockers, policy approvals, coverage and export status. Approve or return; preserve the existing earning/payout process. Close intake deliberately at target/date and export only approved eligible records with version/hash evidence. Missing execution mappings remain blocked, not replaced by a demo result.

## Help content maintenance

Version help with the template contract. Store field key, user label, definition, requiredness, conditional rule, approved example, common mistake and reviewer check. The same help registry feeds Classic tooltips, chat explanations and PDF generation. Domain owners review changes. A wording change must not silently alter an enum, schema or scoring rule. Keep a change log and regenerate affected guides after a schema revision.
