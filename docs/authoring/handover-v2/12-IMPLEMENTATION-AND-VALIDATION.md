# 12 Implementation sequence, controls and tests

## Build order

Phase A: preserve existing local project/view/save functionality; publish the common template profile and field mapping. Pilot the full KYC anatomy in the reusable Classic renderer. Validate data compatibility before replacing the generic renderer. Expose unsupported template fields as a gap rather than apparent readiness.

Phase B: integrate shared Classic/Chatbot context, safe question planner, dependency reconciliation and the horizontal graph in the same canonical draft. Keep proposal confirmation, visibility and controls common. Register remaining templates through configuration and focused domain adapters; no separate chatbot forks.

Phase C: extend project-policy intake with SME proposals, qualification, assigned Expert review and authorised publication. Reuse immutable document/rule services and add permission-filtered retrieval only where needed. Do not use unreviewed policies to improve a chat demo.

Phase D: implement review-route stages/permissions and exact-version approval, then prove unchanged payment/dataset invariants. Demo can continue using the existing authorised final-review path until this passes.

Phase E: implement the Vertex MaaS adapter and run contract tests without paid calls. Obtain separate authority for account activation/live pilot, choose a model from measured results and add spend limits/telemetry. No training platform in this scope.

Phase F: qualify per-template executable Anvil mappings, especially decisions, human response and loops. Refuse unsupported contracts. Perform a real end-to-end pilot only with authorised models/environments and clearly separated acceptance evidence.

## Required acceptance matrix

| Test | Expected result |
|---|---|
| Each template registry profile | Required fields, enums, help/examples and checks are present in both views; unknown field types block registration. |
| All Classic sections | Applicable controls remain editable after first section; repeated arrays open via clear Add actions; submit section remains validation/actions. |
| Immediate tab/view switch | Last keystroke saved before transition. Data remains after reload; no duplicate task or extra revision from preference-only save. |
| Failed save / conflict | Stay in current view with text; do not claim saved; retry or reconcile exact revision. |
| Both/editor bypass | Both allowed; Classic-only rejects chat writes; Chatbot-only rejects Classic PUT; annotation and legacy behaviour preserved. |
| Chat memory | Added/corrected SSN/TIN/name facts correlate with prior evidence; superseded facts no longer treated as current. |
| Hallucination controls | Unknown source/rule/step IDs and invented tool results cannot apply. Correctly cited but misapplied rules go to applicability review. |
| Off-topic/generate request | No substantive answer; safe task-specific redirect. Multilingual, obfuscated and document-injection examples tested. |
| Authorship | Consent/declaration tied to exact revision; pasted text friction and legitimate upload/accessibility paths behave as specified. |
| Policy intake | Unrelated/malicious/unreadable/pending documents cannot become authoritative; locators and original bytes retained. |
| Retrieval access | No cross-tenant/project/private-rule or superseded-policy retrieval, including guessed IDs and vector reranking. |
| Horizontal graph | Connected decisions/human steps/joins/loops; branch labels and exhausted exits visible. Both views preserve graph/selection. |
| Graph semantics | Unbounded cycles, invalid handoff schemas, unknown roles and unsupported human runtime bindings block executable export. |
| Agent projection | Private rubric/solution/defects/discussion and other-role/future artifacts absent from initial payload and downloads. |
| Expert/PM route | Unauthorised role cannot act; exact revision reviewed; changed content invalidates prior decisions; same-person responsibilities auditable. |
| Rework/payment | Rework/resubmission retains task; one eligible earning per accepted unit; no payout from model/proposal completion. |
| Export | Only accepted scoped records; hash/version preserved; missing executable contract returns explicit blocker. |
| Model failure/retry | No lost answer, duplicate queued run or automatic paid retry of uncertain call; receipts accurately labelled. |
| Regression | Existing project, staffing, policy, review, payment, annotation and dataset checks pass after relevant changes. |

## Nonfunctional checks

Validate accessibility and keyboard-only operations, readable graph/list fallback, mobile read-only expectations, realistic concurrency, upload limits/OCR failures, recovery from interrupted writes, backups/restore, retention deletion without breaking immutable audit obligations, and explicit cost/latency monitoring. Targets require measurement; do not infer them from a successful build.

## Release gates

Source review -> type/build/unit checks -> isolated SQL/API tests -> real browser journeys -> domain Expert acceptance -> authorised live-model pilot -> per-template Anvil contract qualification -> staging identity/permissions and operational evidence -> separate deployment approval. Do not conflate controlled providers with real selected models or a staged JSON representation with native execution.

## Existing receipts and remaining work

Local source de758ba has save-preservation changes. Actual Chrome/API/SQL persistence check covered KYC plus thirteen other catalogue templates. Candidate component tests (23), typecheck and production build passed. Earlier broader suites are recorded in VALIDATION-REPORT.md. This documentation pass does not rerun all product tests or implement the new phases above. Graph mockups have been browser checked, but remain design previews.
