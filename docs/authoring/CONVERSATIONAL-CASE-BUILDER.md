# Conversational authoring implementation

Owner request: replace a scripted per-field preview with a persistent, policy-grounded case conversation across authoring templates. This is one local implementation slice, not a deployment or an assertion of benchmark acceptance.

## Architecture

Candidate conversation -> authorised/idempotent message command -> saved TaskInterviewTurn -> queued TaskDraftRun (section CHAT) -> existing outbox -> configured Vertex assistant outside a DB transaction -> strict proposal validation -> persisted pending proposal -> SME confirms/discards -> atomic task revision -> dependency map and rubric read from that revision.

The complete conversation (up to 300 turns), full current task, unresolved questions, assignment/slot and template definition plus the current published project rule set are sent as model context. Limits fail explicitly; history is not silently dropped. Every proposal includes a single follow-up question. There are no tool calls or autonomous operational decisions in the authoring assistant. Existing fixed interview and KYC drafter remain available in the detailed editor.

The shared engine is exposed for every AUTHORING template. It uses that project's template instructions/schema and current task, not a KYC prompt for marketing. Specific non-KYC Anvil export adapters are not fabricated: existing executable contracts are preserved and changes require a dedicated adapter. Generic authoring is not synonymous with runtime-qualified benchmarking. KYC deterministic checks refuse newly introduced errors while allowing incomplete drafts to develop.

## Policy and provenance

Project-level published rule sets are retrieved server-side. No raw additional task document is promoted to policy. Rule links must reference known published rule versions and actual investigation step IDs. Source version/hash/page/clause, exceptions and applicability are supplied with the rules and displayed to SMEs. Chat cannot rewrite project rules. Evaluator-only policy context requires separate visibility review before executor-facing changes can apply. Bank/customer document qualification, extraction and publication stay in the existing project policy workflow; this slice does not implement a new authenticity detector or bypass review.

Task revision and effective-policy digest are checked both before/after generation and at confirmation. Confirmation pins that policy digest in conversation state. Submission refuses drift from the pinned policy. Confirmation invalidates prior AI-section confirmations and requires author reconciliation. Unresolved questions block the conversation-review acknowledgment and submission. Human Reviewer acceptance stays unchanged and separate.

## Safety limits

Input sensitive-pattern checks run before content storage/model calls. Model output is schema-checked; potential sensitive output is discarded. Unknown policy/step references, direct final approve/reject dispositions, new KYC check failures and unsafe JSON keys block application. Schema validation, evidence-ID validity and model instructions do not prove semantic truth. Human review is mandatory; there is no claim to detect all hallucination, adversarial text, real PII or source authenticity. The executor preview is a server-side field projection, excluding reference solution, grading, document defect annotations, generic author notes and recorded responses. Visibility selection is not an execution sandbox.

All model calls in tests are mocked. The production adapter uses the existing assistantMode/Vertex settings and model constant; no new credentials, deployment or paid call has been performed. Local mock mode explicitly returns no generated edits. RUNNING jobs are not reclaimed for automatic paid retries; after a worker crash they need operator investigation. A stale or failed response preserves the task.

## Endpoints and UI

- GET `/me/tasks/:id/conversation`: saved conversation, task revision, pending proposal, unresolved questions, published policy and latest run.
- POST `/me/tasks/:id/conversation/messages`: expectedRevision + answer; returns202 and run ID.
- POST `/me/tasks/:id/conversation/decision`: runId + accept; exact pending proposal only.
- POST `/me/tasks/:id/conversation/review`: author acknowledges reconciliation at expectedRevision with no pending/unresolved items.
- GET `/me/tasks/:id/agent-preview`: executor field projection and agent-visible published rules.

Every command uses platform idempotency and audit infrastructure. Reads/writes enforce task ownership and current assignment/identity/onboarding eligibility. Read-only tasks cannot mutate. No remote branch changes, push or merge are implied.

The candidate task page defaults to conversation for authoring. Detailed editor remains at `?editor=form`; it owns full typed editing, rubric and submission. Dependency map uses solution.steps/dependsOn, and each node opens the corresponding reference/tool/rule details. Chat displays proposed per-section changes before confirmation; invalid proposals can only be discarded. Example guidance is workflow-specific, with KYC identifier-policy clarification as the explicit pilot. Future work: richer examples per individual question and a dedicated diff editor instead of proposal JSON.

## Demonstration scenario

SME adds missing Tax ID/SSN. Assistant receives previous answers and current case, observes identifier absence, asks jurisdiction/customer-category and approved-rule applicability, and proposes coordinated scenario/evidence/step/finding/rubric updates only where supported. It must not infer that SSN is mandatory from absence alone. Model quality on this scenario is a live acceptance test still to be performed by the owner; deterministic tests use controlled providers.

## Validation receipt (local)

2026-11-10: 45 focused API/database/SDK-contract/browser and existing drafting/policy tests pass. Shared-package suite:192 tests pass including four new conversation contract tests. All workspace type checks and candidate production build pass. The Chrome journey used the actual candidate app/API and controlled model response: answer -> pending proposal -> confirmation -> changed map/rubric -> reload/resume -> private-free agent preview. All12 template names exercise the persistent conversation route; this is not a claim of independent domain review or full Anvil acceptance for each. No live provider call, production change or remote branch update occurred.

## Current approval revision
The human-only facilitator requirements in CHATBOT-REQUIREMENTS.md supersede earlier generative-drafting language. Chat extracts SME wording and asks clarification; examples are read-only. See ARCHITECTURE.md, EXISTING-CAPABILITY-AUDIT.md and VALIDATION-REPORT.md for current controls and limitations.
