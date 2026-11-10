# Proposed project-to-benchmark product flow

Owner direction,2026-11-10. Design proposal; multi-agent runtime, additional policy qualification, payments changes and OpenAI adapter are not implemented by the current conversational-authoring slice.

## Project lifecycle

PM/Admin chooses a versioned workflow template and a supported execution pattern (single executor, coordinated multiple executors). The template declares supported patterns; changing a toggle must not pretend a single-agent definition is an executable multi-agent definition. Independent repeated cases remain single-agent trials, not multi-agent workflows.

Set accepted-task target, coverage quotas, difficulty mix, dates, rework grace period, acceptance rubric, compensation and budget. Add authorised project-level public regulations/guidance, bank policies and customer policies. Require source classification, version/hash, scope, dates, provenance, permitted use and visibility. Do not cap extraction at the first20pages: process the actual allowed document and show missing/OCR pages. Extract candidate rules and retain page/clause/quote and exceptions; publication requires authorised review. Format detection, malware scanning and semantic policy qualification are distinct checks; no model alone can authenticate a bank policy. Additional SME-supplied policy stays pending and unavailable for binding until approved. Confidential policy handling is separate from synthetic case data; prohibit real customer records.

Generate an editable SME JD from template skills, actual case work, expected output, qualifications, work/payment terms and target; PM approves it. Project creation precedes matching and assignment. Matching considers evidence-backed qualification, domain/jurisdiction, availability/capacity, conflicts and current approvals. It recommends candidates; PM/Admin assigns. Existing eligibility, identity, onboarding and assignment acceptance gates remain enforced.

SME authors through a conversational interface with section examples, task memory, dependency map and executor preview. Policy-grounded follow-ups propose coordinated edits with origin and citations. SME confirms each proposal. Submitting freezes a revision, runs checks and queues review. PM/Admin acts as an explicitly authorised Reviewer; keep conflict rules and audit records. They can review source documents/rules but policy approval and task acceptance are separate records. If personnel require self-review, require an explicit product policy rather than silently bypassing conflict checks.

Decisions: Accept, Request rework, Reject. Rework returns the same task with section-level feedback and immutable previous submissions; resubmission runs the same checks. Terminal rejection is distinct from correctable rework. No paid-model assistant can accept its own task. Acceptance produces an append-only accepted dataset record with exact task/policy/template versions, human decision, rights and validation receipts.

## Acceptance, compensation and export

Pay for accepted contracted units, not every submission or resubmission. Acceptance creates one idempotent payable keyed to the accepted unit; no double payment for retries/rework. Separate earned/payable/payment processing/paid/failed states. A proposed multi-agent case is one paid unit unless commissioning terms explicitly split stages. Existing payment infrastructure must be inspected before changing payout behaviour.

Stop new allocation when accepted-task count AND required coverage are achieved, or intake end date is reached. Pending/rework work follows a disclosed grace policy; do not reject it automatically. End-date closure may be incomplete. Completion should not count rejected drafts or revisions twice. Export authorised accepted, contract-valid records; retain draft/failed acceptance reasons and clear shortfall reports. Packaging/export validation is distinct from actual Anvil import, environment replay and evaluator qualification. Use separate statuses so accepted content is never misrepresented as benchmark-ready. Freeze an immutable export manifest with provenance and hashes; never silently upgrade policy versions. Actual Anvil feedback goes through the established rework/version process, not mutation of accepted records.

## Single and multi-agent authoring

Common task anatomy, policy retrieval, memory, review, compensation and export provenance. Multi-agent extension adds named executor roles with instructions, tools and visibility; typed input/output artifacts; dependency edges; parallel join conditions; routing; retry/timeout/cancellation semantics; human handoffs; stage rubric and overall workflow rubric. Distinguish human reviewers from AI roles. The same chat asks an SME about real work and produces a proposed graph for confirmation; the SME does not write orchestration code. Every handoff must name its producer, recipient, schema, allowed visibility and evaluation. Runtime adapters and isolated tool permissions require separate engineering and qualification; this design is not evidence that current Harbor/LangGraph execution already supports it.

## LLM, retrieval and memory

One provider interface returns schema-validated change proposals plus grounded questions; provider selection must not alter the task contract. Current implementation has the existing Vertex Claude adapter and explicit local mock. OpenAI and future open-weight endpoints need their own adapters, contract/security tests and measured acceptance evaluations. No live model call is part of the local implementation verification.

Memory has durable conversation events, current structured case, provenance/confirmed facts, unresolved questions, rejected/superseded proposals and versioned dependencies. Long histories require a loss-aware reviewed summary while exact facts/policy references remain authoritative; no silent context truncation. Retrieval searches only authorised approved project versions, with tenant/project/visibility/effective-date filters enforced before model context. Search is not permission control. Index clauses with page/quote/hash, exceptions and hierarchy; return insufficient evidence where sources do not establish a requirement. Current implementation sends the bounded published rule set as context; vector retrieval and summarisation remain future work.

Use deterministic schema/reference/dependency/scoring/tool-call checks, sensitive-content handling, source-grounding and contradiction checks, adversarial isolation, clear abstention and independent human review. No checker guarantees absence of hallucination. AI proposals cannot approve policies/tasks, release money, perform operational actions or certify Anvil acceptance. A server-side executor projection prevents accidental inclusion of evaluator-only answers; test it adversarially.

## Delivery slices

1. Persistent conversation + coordinated proposals + examples + map/preview; KYC pilot then shared authoring access (local implementation exists).
2. Per-template typed authoring/Anvil adapters and domain acceptance fixtures; finish policy-document qualification and SME addition review.
3. Filtered approved-policy retrieval, evidence-grounding evaluation and richer correlated-question UX; provider abstraction/OpenAI adapter.
4. Formal project quotas/deadlines/rework/payment/export invariants with existing platform integrations.
5. Multi-agent authoring, typed graph validation, role previews and separate runtime qualification.
6. Build a permissioned training dataset from accepted tasks, corrections and adjudications; hold out whole projects/policy families, maintain hidden evaluator material, and assess a candidate open-weight model on quality, safety, cost and abstention before substituting it. RAG still supplies current customer policy; do not encode confidential policies or blindly imitate unreviewed chats in training. Train the authoring assistant separately from the model being benchmarked.
