# Praxis capability audit and change flags

Inspected baseline: `feat/catalog-published-defaults` commit `a4b4cbc384ce09beafd3cbb238e92a0d11a9dbc5`. Chatbot implementation is isolated on `feat/conversational-case-authoring`, initially38bbaa3. Source inspection is not production acceptance. Do not rebuild existing modules based on architecture diagrams alone.

| Capability | Baseline evidence | Finding / implementation decision |
|---|---|---|
| Templates, project configuration, targets and dates | apps/api/src/routes/projects.ts; packages/shared/src/projects.ts | Exists. Reuse, no replacement project wizard in this slice. Arbitrary Single/Multi execution toggle is not established by this inspection. |
| JD CRUD and project attachment | apps/api/src/routes/job-descriptions.ts; routes/projects.ts | Exists. Automatic LLM JD generation from every template is not demonstrated; do not claim it. |
| Matching, assignment and eligibility gates | routes/staffing.ts; routes/work.ts:workContext/ownTask; staffing/selection-gate.ts | Exists. Reuse current identity/onboarding/assignment checks. No new hiring workflow. |
| Project policy documents, extraction and review/publication | routes/policy.ts; policy/documents.ts; policy/extraction/service.ts; policy/rules.ts; policy/rule-sets.ts | Exists. Chat consumes only published rule versions, citations, applicability and exceptions. No duplicated ingestion pipeline. |
| SME upload directly into project-policy review | policy/access.ts: POLICY_ACCESS is PM/ADMIN; routes/drafting.ts supplies task source attachments only | GAP: candidate attachments are not published policy. Chat cannot silently elevate them. Candidate policy-submission/review bridge needs separate permission and workflow change. |
| Document authenticity/policy-vs-random-document qualification | policy/document-reader.ts; policy/documents.ts; extraction/service.ts | Parsing/extraction is not proof of authenticity or semantic policy qualification. End-to-end qualification acceptance remains unverified. |
| Fixed interview, saved sources and AI KYC drafting | tasks/drafting/interview.ts; drafter.ts; service.ts; candidate/components/work/drafting.tsx | Exists, KYC-only and fixed questions. Preserve in detailed editor. New adaptive chat is separate, sharing infrastructure. |
| KYC schema, tool fixtures and deterministic checks | packages/shared/src/kyc.ts; mcp.ts; tasks/definitions.ts | Exists. KYC check regression preserved. Non-KYC generic definitions are not equivalent to full typed validation for every workflow. |
| Task autosave, revisions, check and submit | routes/work.ts; tasks/submission.ts; candidate/components/work/use-autosave.ts | Exists. Chat confirms atomically at revision+policy digest, and reuses existing submit/check path. |
| Admin/Reviewer review and rework | routes/task-review.ts; tasks/review-service.ts | Exists: one final ACCEPT/REWORK/REJECT decision. Current endpoint roles REVIEWER/ADMIN, not unrestricted PM. Existing Admin workflow permits Admin operation; preserve it. |
| Separate Industry Reviewer then PM approval stages | TaskReview model; review-service.ts; docs/ADMIN-WORKFLOW.md | GAP: existing reviewer support is not evidence of a configurable two-stage workflow. Design only here; do not introduce roles/states silently. Demo uses existing Admin final acceptance. |
| Payment ledger and payout processing | pay/ledger.ts; routes/payments.ts; docs/ADMIN-WORKFLOW.md | Exists, with rate-card/requisition/pay-route eligibility and feature flags. Acceptance is not an unconditional payout for every task. Reuse, no payment rewrite. |
| Coverage-aware completion | tasks/review-service.ts:completionStatus | Exists: accepted count plus coverage. Exact end-date intake/rework grace behaviour needs its own acceptance validation. |
| Immutable dataset and dataset export | dataset/approved-records.ts; routes/dataset.ts | Exists. Reuse append-only record/hash chain and NDJSON export. |
| Executable Anvil contract export | routes/dataset.ts:/dataset/records/:id/praxis-contract; packages/shared/src/praxis-contract.ts | Exists ONLY if output.praxisContract is present and valid. An accepted ordinary KYC authoring record can lack it and correctly returns409 NO_EXECUTABLE_CONTRACT. This is a material demo gap, not an export success. |
| Multi-agent authoring and qualified execution | existing contract/studio representations, separate specs | A staged contract representation is not proof of the proposed role-based chat, per-role preview or runtime qualification. Mockup only; no multi-agent runtime changes. |

## New chatbot scope

Persistent answer memory, current task context, unresolved questions, real configured Vertex adapter (local tests use mock), published-policy grounding, coordinated proposed section updates, SME confirmation, revision checks, dependency map, executor-preview projection, section examples, model failure handling and review-feedback context for rework. Available through the shared authoring route for all12 requested names; domain correctness and executable adapters still require their own validation.

## Changed existing behaviour — flag explicitly

1. Authoring task page now defaults to conversational view. Existing editor is retained at `?editor=form`. Annotation remains on its existing path. This changes the default candidate UX.
2. Existing outbox event `task.draft.requested` has an additional CHAT handler. Legacy KYC drafter ignores CHAT runs. Existing draft path remains intact.
3. Submission gains checks only for tasks with conversation state: unresolved/pending proposals, author reconciliation, reviewed revision and published-policy digest. Manual legacy tasks without conversation state retain their previous checks.
4. Chat-confirmed edits invalidate previous AI-section confirmations; author must review them again. Task revision increments atomically.
5. No schema migration, changed payout logic, changed task-review permissions, replacement project setup, auto-acceptance, deployment or paid model call is included.

## Validation boundary

45 focused API/SDK/browser/regression checks and192 shared tests passed before the later full-lifecycle test. Production candidate build and workspace type checks passed. The browser test used actual Next/API + controlled provider and verified reload memory, confirmation, map/rubric changes and private-answer separation. Final aggregate and additional lifecycle result belongs in VALIDATION-REPORT.md. No test result here implies live model quality, live payout or authentic Anvil cloud execution.

6. Existing phone read-only behaviour is preserved for chat mutations as well as the detailed KYC editor. Legacy editor-specific E2E routes now explicitly request `?editor=form`; this is an intentional test-route update for the new default, not a removal of their assertions.

## Revision 1.3 - new authoring-experience requirement
Existing local chat default plus `?editor=form` is not a complete Classic/Chatbot/Both feature. Missing: required project enum, versioned configuration, API-level view permissions, common unsaved draft/pending-proposal state, persisted preference, Classic authorship-control parity and legacy-project migration. Reuse existing structured editor and conversational pipeline rather than create parallel task schemas. No project-mode implementation or rollout is claimed by the mockup.

## Revision 1.4 local implementation supersedes revision 1.3 gap list
Project authoring-experience persistence, required creation choice, permitted-view UI/API enforcement, flush-before-switch on the shared record, persisted view/chat draft and common human-authorship controls are now implemented. Existing projects remain NULL/legacy Both. No active-project configuration migration is supplied. See IMPLEMENTATION-EXPERIENCE-HANDOFF.md; two-stage approvals, candidate policy publication and executable/native benchmark gaps remain separate.
