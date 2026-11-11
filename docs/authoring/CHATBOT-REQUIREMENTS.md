# Conversational SME authoring — requirement specification

Scope: add only the adaptive chatbot/workbench connections to existing Praxis. Reuse project/template/JD/staffing, project policy, submission, review/rework, dataset, payment and export modules. Baseline and gaps: EXISTING-CAPABILITY-AUDIT.md. Demo uses existing Admin final acceptance. Multi-agent view is a design preview, not implemented runtime.

| ID | Requirement / acceptance |
|---|---|
| CHAT-01 | Load the assigned authoring task and actual project template after current eligibility/ownership checks. Reject another candidate's task and submitted/read-only mutation. |
| CHAT-02 | Persist previous messages, confirmed case revision and unresolved questions. Refresh resumes them; context limit is explicit, never silently loses facts. Include reviewer rework comments. |
| CHAT-03 | Ask one contextual follow-up grounded in prior answers/current task and approved project rules. Treat missing identifiers as observations until applicability is established. |
| CHAT-04 | Supply examples for scenario, evidence/checks, rule applicability, expected recommendation and grading. Examples are drafts and never silently committed as answers. |
| CHAT-05 | Model returns typed proposed COMPLETE section changes, reasons, rule links and uncertainties; it cannot mutate approval, payout, rights or reviewer provenance. |
| CHAT-06 | SME sees and confirms/discards the coordinated proposal. Atomic save updates scenario/evidence/reference/map/rubric together; any task or policy change makes old proposals stale. |
| CHAT-07 | Reuse published project policy with exact rule-version IDs and source locators/quotes. No direct policy edits or automatic promotion of candidate source uploads. |
| CHAT-08 | Map reads the saved solution.steps/dependsOn. Selecting a node shows input, recorded-response reference, expected result, rationale and rule links. This is not an execution trace. |
| CHAT-09 | View as agent uses server-side field projection; excludes solution/rubric/defect annotations/author notes/recorded outputs and evaluator-only rules. Matching runtime calls receive fixtures separately. |
| CHAT-10 | Before storage/model dispatch check sensitive patterns and explicit instruction override attempts. Validate output schema, known rule/evidence/step references, scoring and human gate; run existing KYC checks. Never claim perfect hallucination detection. |
| CHAT-11 | Never send model output to human acceptance or payment directly. Author confirmation and final Reviewer/Admin acceptance are separate. |
| CHAT-12 | Generation runs outside DB transactions with claim-once jobs and no automatic paid retry of uncertain RUNNING calls. Failure preserves task; mock mode must not impersonate a live LLM. |
| CHAT-13 | Reuse check/submit/rework and dataset export. Flag missing executable Anvil contract as blocker; don't equate dataset export, replay bundle and actual Anvil acceptance. |
| CHAT-14 | Browser tests use actual UI/API with controlled model; integration checks cover12 template names. Domain live-model evaluation is a distinct owner acceptance gate. |

## Planned, not implemented by this slice

Provider-neutral OpenAI adapter; permission-filtered vector retrieval for large approved policy libraries; reviewed long-history summarisation; candidate project-policy submission bridge; semantic policy qualification; role-based multi-agent proposals and visibility previews; two-stage Reviewer→PM approvals; missing per-workflow Anvil adapters. These are dependency/gap flags, not justification to rebuild already existing platform modules.

## Shared multi-agent design

Same chat/examples/policy/map/preview shell. Group steps inside collapsible role nodes; typed handoff edges, parallel joins, conditional routing, limits and overall+role rubric. Agent preview chooses one role and server-enforced permitted artifacts. Human reviewer is a distinct gate, not an AI role. Template declares supported modes. Mutating a role/handoff invalidates affected references and rubric for SME review. Independent repeated cases remain single-agent trials.

## Human-authorship controls — superseding generative drafting assumptions

| ID | Requirement / acceptance |
|---|---|
| HUMAN-01 | Versioned consent before chat; declare own work, no external LLM authorship and authorised sources for the exact reviewed revision. A changed revision needs another declaration. |
| HUMAN-02 | Facilitate and extract SME wording. Do not invent substantive case evidence, reference answers, rationale or rubric. Reject unsupported additions and do not show free-form model answers as guidance. |
| HUMAN-03 | Section examples remain teaching material with no insert-as-answer action. Block paste/cut/text-drop in authoring inputs; retain legitimate uploads and annotation behaviour. |
| HUMAN-04 | Human-only enrolment disables legacy model drafting/redrafting for that task. Preserve legacy provenance; do not relabel earlier AI-generated material as human-authored. |
| HUMAN-05 | Show similarity findings and authorship declarations to human review. Neither typing controls, declarations nor similarity prove absence of external LLM use. Do not use detector scores as automatic misconduct/payment decisions. |
| HUMAN-06 | Record provenance separately for facilitation and substantive legacy generation. Keep future non-chat authoring possible through the same structured task contract. |

Approval concerns the shared UX and scoped integration. Existing API roles, missing executable contracts, candidate policy publication and multi-agent execution remain explicit gaps in the capability audit.

## UI revision 1.1 - template-defined workflow and instructions

- Agent mode is a versioned template property, fixed before assignment. Authoring and review screens display it read-only; no mode selector. The mockup shows separate assigned single/multi examples, not an SME choice.
- Three task states: Authoring; Review / Approval Pending; Approved. Pending responsibility tracks expert review or PM approval. The same authorised person may perform both responsibilities, with both decisions auditable. This is a required workflow change, not a claim that current API roles already implement it.
- Graph nodes describe benchmark work only. Remove authoring/review/approval process nodes. Domain task outcomes that require authorised operational handoff remain part of the task's reference solution when appropriate.
- Show section number and total (8 authoring sections / 8 review checks) separately from the count of investigation steps and agent roles. Do not present navigation as completion evidence.
- Template instructions define what to expect, each field's meaning, what to enter or inspect, and how to submit or return corrections. Provide the versioned PDF in both authoring and reviewing; 14 template guides and editable source text accompany this revision.
- Remove the word 'fictional' from SME-facing instructional copy. Preserve authorised test-data, privacy and provenance requirements.
- Layout reflows rather than overlaps. Check 1024, 736, 390 and 320px widths; use normal document flow for instructions rather than an overlay.

## Project authoring experience - revision 1.3

[AUTHORING-EXPERIENCE.md](AUTHORING-EXPERIENCE.md) is authoritative for the new Classic / Chatbot / Both setting. It supersedes universal chat-default and unrestricted detailed-editor assumptions. Required project choice is independent of the template's fixed agent mode. Both views share task/draft/revision, validation, map, agent preview, policy/rubric and submission. Only BOTH permits an SME switch. API enforcement, migration and shared unsaved-draft handling are required future implementation; the mockup demonstrates the behaviour locally.

## Revision 1.4 implementation status
Classic/Chatbot/Both project configuration and shared human-only authoring are now implemented locally. AUTHORING-EXPERIENCE.md and IMPLEMENTATION-EXPERIENCE-HANDOFF.md supersede the earlier project-mode gap statement. Paid MaaS selection, cloud rollout, two-stage approvals and remaining executable benchmark adapters are not included.
