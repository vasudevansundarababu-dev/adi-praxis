# Task definition and workbench - Compliance Monitoring

Handover draft, 10 November 2026. Template ID BK06. Reuses the common Classic renderer and common Chatbot. This document is a template-specific authoring specification, not a claim of executable validation or a published schema. Published agent mode must be confirmed by the domain owner.

## 1 Task anatomy

The SME supplies the following in order. Requiredness must be encoded in the versioned profile and checked at submission; draft saving remains possible with incomplete fields.

### 1. Assignment and brief

Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief.

### 2. Case inputs and evidence

Input means the material the agent can inspect: defined monitoring scope, records, obligations and monitoring period. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

### 3. Tools and recorded responses

A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred.

### 4. Policy applicability

Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active.

### 5. Expected work and result

Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: obligation-to-evidence assessment, exceptions, severity, proposed follow-up. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

### 6. Allowed outcomes and values

Use the template pick lists rather than new labels. Current proposed labels: result: compliant, noncompliant, insufficient_evidence, not_applicable; severity: low, medium, high, critical, undetermined. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

### 7. Grading criteria

For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100.

### 8. Final checks and submission

Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again.

Exact non-KYC canonical field names, enums and outcome adapter need domain approval. Do not copy banking field names into this workflow or invent a finished TypeScript schema from prose.

## 2 Synthetic data rules

Use realistic, authorised test data. Exclude actual personal identifiers, credentials, private customer records and unauthorised confidential material. Supplied public/approved project policy is authority only in its approved scope. Mark unknown values and absent evidence explicitly. Do not fabricate provenance, a real tool execution, a policy requirement or a successful action. SME-facing language explains authorised test data without the word “fictional”.

## 3 Expected solution and rubric

Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: obligation-to-evidence assessment, exceptions, severity, proposed follow-up. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

Use the template pick lists rather than new labels. Current proposed labels: result: compliant, noncompliant, insufficient_evidence, not_applicable; severity: low, medium, high, critical, undetermined. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100.

Reference material stays private. Criterion anchors, weights, critical failure semantics, common errors and acceptable variations need explicit author judgement. KYC weights total 100; the domain profile must state its own rule. Optional human involvement is a business case interaction, separate from Praxis Expert/PM task approval.

## 4 Author workbench

One shared template-driven workspace. Project determines Classic/Chatbot/Both; template determines agent mode. Classic renders the approved field profile. Chatbot uses that same profile, remembers scoped prior answers and asks for SME-authored content. Confirmed changes update the same output and rubric. Instructions/examples and server-projected View as Agent are common. The connected horizontal Flow preview is BELOW both editors, with compact reflow on smaller screens. Decisions, human interactions and bounded return paths require the versioned graph contract.

## 5 Automated checks and review

Required fields; enum/tool/argument validity; stable IDs; evidence/rule references; policy applicability; visibility; rubric totals/critical semantics; contradiction/dependency checks; consent/revision; safe graph reachability/joins/loop limits; export adapter compatibility. Existing KYC checks can be reused only for KYC. Missing non-KYC checks and executable adapters remain qualification blockers, not pass-through acceptance. Expert reviews source correctness and task judgement; authorised PM/Admin accepts the exact submission version according to the configured route. Rework returns the same task.

## 6 Example, acceptance criteria and open questions

Teaching evidence example: Input means the material the agent can inspect: defined monitoring scope, records, obligations and monitoring period. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

This is guidance for authoring the domain evidence, not a fully authored gold task. The domain owner must supply/review an actual pilot case and its reference/rubric before live acceptance.

Acceptance: both editors show the same fields and retained data, previous answers inform clarification, rules cite approved versions, reference/private grading are excluded from agent view, and applicable checks/export capability are real. Reject unrelated model requests and unsupported generated answers. Open questions: exact field/outcome contract outside KYC, published agent mode, qualified tool catalog/environment, critical-failure scoring and executable Anvil mapping. See the common handover for source impact and test plan.
