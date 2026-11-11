# Q4 Global Paid Search Query Clustering - template instructions

## Authoring

### 1. Assignment and brief
Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief.

### 2. Case inputs and evidence
Input means the material the agent can inspect: query dataset, product brief, locale and channel constraints. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

### 3. Tools and recorded responses
A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred.

### 4. Policy applicability
Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active.

### 5. Expected work and result
Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: clusters, query assignments, intent labels, exclusions, ambiguous queries, rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

### 6. Allowed outcomes and values
Use the template pick lists rather than new labels. Current proposed labels: intent: informational, commercial, transactional, navigational, unclear; assignment: assigned, excluded, needs_review. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

### 7. Grading criteria
For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100.

### 8. Final checks and submission
Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again.

## Field reference

### Task title / brief
Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer.

### Trigger / as-of date / scope
Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope.

### Evidence ID / source / date
Give each record a unique identifier, its origin and relevant date so findings can cite it precisely.

### Tool / arguments / response
Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary.

### Policy rule / version / source locator
Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions.

### Steps / dependencies
Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details.

### Findings / evidence references
State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps.

### Rationale / human handoff
Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next.

### Criterion / weight / critical flag
Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules.

### Partial credit / common errors / acceptable variations
Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording.

### Reviewer comment / decision
Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both.

### Cluster / query assignment
Group queries by shared intent; assign each query ID to a cluster or explain exclusion.

### Intent / ambiguity
Choose a permitted intent and identify queries that require clarification rather than forcing an unsupported label.

## Expert review and PM approval

### 1. Brief and scope
Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer.

### 2. Evidence quality
Open the supplied inputs: query dataset, product brief, locale and channel constraints. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption.

### 3. Tool behaviour
Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected.

### 4. Policy and added documents
Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules.

### 5. Reference solution
Check the steps and supported conclusions against the evidence. Required result: clusters, query assignments, intent labels, exclusions, ambiguous queries, rationale. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions.

### 6. Graph and agent view
Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading.

### 7. Rubric and validation
Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct.

### 8. Review decision and PM approval
Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required.