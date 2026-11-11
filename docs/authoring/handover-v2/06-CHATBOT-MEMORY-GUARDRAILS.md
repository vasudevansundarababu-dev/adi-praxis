# 06 Chatbot, memory, hallucination and adversarial controls

## Authoring policy

The assistant may clarify the current field, quote approved rules with sources, identify missing information, organise the SME's own text and propose source-linked field placement. It must not write the case answer, fabricate evidence/tool results, supply the reference solution/rationale/rubric for the SME, answer unrelated requests, publish rules, approve tasks, determine payment or operate real accounts. Read-only teaching examples use a different case and have no Insert answer action.

“Use another LLM to write this answer” is prohibited by the author agreement. Technical controls cannot guarantee that a person did not consult an external device/model or retype generated text. Consent, typing friction, revision history, similarity review and expert judgement are evidence/signals, not an AI-use detector or automatic misconduct decision.

## Turn processing and durable memory

1. Authenticate; enforce tenant/project/task ownership, assignment, allowed editor, editability, consent and request size.
2. Inspect text for sensitive patterns and explicit instruction overrides. Treat task documents and messages as data, never higher-priority instructions.
3. Persist the authored turn with client-message ID and active revision. Enqueue one claim-once facilitation job. A replay must not create another paid attempt.
4. Build context from the template schema/help, current canonical case, relevant prior answers, unresolved issues, approved project rules, actual reviewer feedback and privacy/visibility constraints.
5. Call the configured provider outside a DB transaction. Limit output, duration and cost. Do not grant general browser/tool access.
6. Parse typed output; reject additional properties, forbidden paths and invalid references. Trace each substantive change to SME-authored spans; numeric/critical choices need explicit SME input.
7. Reconcile affected fields. Reject unsupported new facts, unsupported obligations and stale proposal context. The model can ask the SME to supply missing content; it cannot fill it itself.
8. Present proposal/diff and one task-specific follow-up. On confirm, lock/recheck revision and policy digest, apply atomically, increment revision and invalidate declarations/review where needed.
9. Update graph/readiness from confirmed data. The SME inspects/reconciles, declares the current version and submits through the normal check service.

Current implementation caveat: source-linked full-section proposals and deterministic facilitatorQuestion() are implemented, but the visible follow-up is currently selected by a limited server rule set. It is not a fully general policy-aware adaptive planner. The new design must add a safe question-plan schema and server-rendered question templates, with model-selected allowed targets/citations, rather than directly exposing unrestricted model prose.

## Proposed safe response contract

A facilitation result contains proposal ID/context revision, affected allowed fields, exact author turn/span IDs, preserved unchanged content, rule-version links, unresolved dependency IDs and a question target. The question target refers to a registered field/help/approved rule; the server renders the wording. Keep free model replies internal. Unsupported semantic conclusions are review signals, never authoritative changes. Do not log hidden reasoning; retain decision-relevant explanations and source references.

## Guardrail implementation matrix

| Control | Enforcement and expected behaviour | Current status / limit |
|---|---|---|
| Task scope | API ownership and project editor gates before reads/writes. | Local implemented; retain regression tests. |
| Off-topic requests | Reject or redirect to the current field using an allowed intent/question target. | Narrow generationRequest patterns/server-owned replies exist; robust multilingual intent handling is a gap. |
| Answer-generation requests | No substantive response; ask SME to type their reasoning. | Source-wording guard and prompt exist; not proof against external authorship. |
| Prompt injection | Separate untrusted policy/evidence; no tool privileges; known intent/path allowlists. | Regex tripwires exist, not universal injection protection. Add adversarial corpus and output capability gates. |
| Structured output | Strict schema plus additionalProperties=false and bounded arrays/text. | Existing proposal validation; each new provider needs contract qualification. |
| Source fidelity | Each new fact/quantity/condition maps to authored source spans. | Literal-source checks exist and can reject useful paraphrases. Improved span-based review is proposed. |
| Hallucinated evidence | Reject unknown IDs, unseen tool results and unsupported claims. | Known-reference checks exist; factual entailment needs human judgement. |
| Hallucinated policy | Only published rule IDs; correct version, source locator, applicability and exceptions. | ID/digest checks exist. A valid citation can still be misapplied. |
| Contradictions | Surface conflicting names, dates, identifiers and dependent findings. | KYC deterministic checks cover a subset. General cross-field dependency engine is a gap. |
| Adverse-media errors | Preserve allegation status, subject-match uncertainty, source date and credibility. | Template requirement; no unsupported adverse real-world assertion or automatic risk judgement. |
| Personal/confidential data | Type/format limits, sensitive patterns, least-data context and private storage. | Pattern checks are incomplete; no guarantee of universal PII detection. |
| Agent-view leakage | Server projection and visibility/reveal policies, not client hiding. | Basic allowlist exists; richer nested/per-role/graph projections need tests. |
| Approvals/payments | Model output cannot invoke business commands or write provenance. | Existing command boundaries retained; new stages need explicit permissions. |
| Authorship and paste | Consent, declarations, no insert-example action, text paste/cut/drop restriction. | Implemented friction; allow approved uploads and accessible alternatives through a reviewed exception. |
| Similarity/plagiarism | Compare against authorised corpus; reviewer sees matched passages and exclusions. | Existing similarity is not internet-wide plagiarism detection or proof of AI use. |
| Save/retry integrity | Save acknowledgements, optimistic revision, idempotency and uncertain-attempt handling. | Local save barriers implemented; provider telemetry/repair policy needs extending. |

## Example: missing SSN/Tax ID

SME: “The identity and address records use different family names; Tax ID and SSN are absent.” The system preserves the name discrepancy and identifier absence as supplied observations. It asks jurisdiction, customer category, applicable published rule, exceptions and acceptable alternatives. It flags dependent evidence-gap/findings/rubric sections. It does not insert invented identifiers, assert that every applicant must supply both, mark high risk automatically, or create a denial recommendation.

If the author later says a tax identifier was supplied, preserve the correction history, resolve which field/document proves it and invalidate any finding or criterion relying on absence. A summary must not keep the superseded absence as current truth. When policy is missing or conflicting, use an unresolved state and ask the authorised reviewer.

## Failure and safety UX

A blocked proposal displays a field-specific reason and retains the answer. Context-limit failure explicitly explains that memory was not silently truncated. Provider failure leaves canonical data intact and marks the attempt failed/uncertain as appropriate. Unsupported/unsafe output is not presented as a completed answer. Save failure prevents a tab/editor/preview transition and offers retry without clearing the draft. No “100% safe”, “hallucination-free” or “AI authorship proven” badge is permitted.
