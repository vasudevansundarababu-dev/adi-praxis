# 02 System and chatbot architecture

## Platform boundaries

Praxis owns project setup, staffing, authoring, policy review, task acceptance, payable eligibility and immutable accepted records. Anvil owns benchmark execution, environment qualification, assessment and benchmark receipts. The authoring chatbot is a facilitator in Praxis; it is not the benchmark agent or a task approver.

Application flow: PM/Admin project setup -> assigned SME -> shared authoring workspace -> authenticated Praxis API -> canonical task/revision service -> check/submit -> Expert/PM decision -> immutable dataset -> contract-qualified export -> Anvil. Existing payment services consume eligible acceptance events, not chatbot responses.

Chat flow: typed answer -> ownership/consent/scope checks -> persist turn -> durable job -> context assembly -> model adapter -> schema/source/visibility checks -> pending proposal -> SME confirmation -> atomic task revision -> map/rubric/readiness refresh. Provider work happens outside the database transaction. An uncertain request must not be paid-retried automatically.

## Reusable modules

| Module | Responsibility | Boundary |
|---|---|---|
| Template registry | Versioned fields, enums, requiredness, tools, examples, output/rubric/graph contracts and adapter capabilities. | Drives both editors; no template-specific chatbot forks. |
| Shared draft service | Optimistic revisions, complete canonical output, autosave, field provenance and edit invalidation. | One task record; chat draft text is not confirmed output. |
| Classic renderer | Renders configured controls, repeated records, help and validation. | Optional domain plug-ins operate through the same draft service. |
| Chat facilitator | Requests missing SME content and proposes placement of supplied words. | No case-answer generation, policy publication or arbitrary tool use. |
| Context builder | Joins approved policy, current case, relevant turns and unresolved dependencies. | Enforces tenant/project/task/visibility before retrieval or model input. |
| Grounding/guard layer | Validates schema, references, source spans, dependencies and deterministic rules. | Model confidence is never an approval signal. |
| Policy service | Document versions, extraction, candidate rules, expert review and published sets. | An uploaded document is untrusted until approved. |
| Projection service | Builds full-SME, Expert/PM and per-role agent views. | Private rubric and hidden answers never enter an agent package. |
| Review engine | Immutable submission decisions, rework, role authority, approval invalidation. | Business human nodes are separate from platform review stages. |
| Export service | Dataset packages, contract adapters, compatibility and blocking reasons. | A graph visualisation is not executable qualification. |

## Persistent memory design

Store raw author turns, confirmed structured fields, current field provenance, unresolved issues, rule-version links, pending proposals, review comments and declared revision. Scope all memory to tenant, project and task; do not mix cases because the same SME works on both. A user deleting or correcting a fact creates an audited supersession, not silent retention as current truth.

Current code uses TaskInterviewTurn, TaskDraftRun and TaskInstance output/drafting metadata, with bounded direct context. The current implementation can fail at the history/context limit; it does not provide an unlimited ChatGPT-style memory guarantee. A reviewed summary store and permission-filtered RAG are proposed extensions. Raw history remains the source of truth; summaries must identify covered turn IDs, source spans, outstanding contradictions, version and superseded facts.

## Dependency reconciliation

An SME adding a missing identifier affects the scenario, evidence-gap inventory, relevant tool responses, reference findings, applicable rule links and rubric criteria. Compute an affected-field graph from the template; show proposed changes and unresolved dependencies. Do not silently fabricate a tool response, expected conclusion or grading weight. When the SME changes a fact, invalidate the prior reconciliation/declaration and any affected expert decision. Auto-updating a map from confirmed structured steps is safe; inventing new substantive steps is not.

## Provider abstraction

Use an internal ConversationAssistant interface, not an LLM-specific page. Input contains a versioned task/context snapshot and allowed field contract. Output contains proposed changes, source links, clarification targets and unresolved issues; only allowed sections are writable. A new Vertex MaaS adapter is a replacement behind this interface, with provider-specific schema translation, token accounting, timeout/error classification and contract tests.

Keep the existing Vertex Claude adapter for compatibility until a reviewed migration. Current tests use controlled/mock providers. Do not claim that adaptive live-model quality, native multi-agent execution, large-library RAG or new MaaS access is validated by those tests.
