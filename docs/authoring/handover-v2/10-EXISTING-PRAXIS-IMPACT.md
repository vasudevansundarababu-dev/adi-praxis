# 10 Existing Praxis: reuse and explicit change flags

Audit is based on local source de758ba and prior baseline a4b4cbc. It is not a claim that these commits are deployed or that every feature is independently accepted. Do not rebuild existing modules because a diagram looks new.

| Area and evidence path | Reuse / current finding | Change required |
|---|---|---|
| Project/template/JD: routes/projects.ts, routes/templates.ts, routes/job-descriptions.ts | Existing configuration, publishing, JD and versioning. authoringExperience local migration/choice exists. | Add versioned common authoring profiles and fixed agent-mode contract where absent; target review-route config. |
| Staffing: routes/staffing.ts; selection-gate.ts | Matching/assignment/identity/eligibility exist. | Reuse; automated JD preparation and Expert matching need their own qualification if added. |
| KYC: packages/shared/src/kyc.ts; kyc-workbench.tsx | Typed KYC fields, MCP fixtures, deterministic checks and W01-W06 forms exist. | Map to common target sections without breaking stored field names or checks. |
| Generic Classic: candidate/components/work/task-page.tsx | Shared title/body form exists for other workflows. | Build template-schema renderer; generic form is not full per-template anatomy. |
| Conversation: tasks/conversation/{service,assistant,guards,authorship}.ts | Durable history/proposals, Vertex Claude/mock, source and revision checks exist. | New MaaS adapter, richer safe adaptive questions and dependency reconciliation; no separate chatbot per template. |
| Autosave: use-autosave.ts; task-page.tsx; kyc-workbench.tsx | Local save barriers, metadata resume, failure retention and agent-preview preservation. | Preserve semantics in new renderer and graph; avoid remounting dirty editors. |
| Policies: routes/policy.ts; policy/{documents,rules,rule-sets}.ts | PM/Admin upload, document versions, extraction, rule review and publication. | SME proposal queue, reviewer access, policy-vs-random qualification, OCR/large-library retrieval acceptance. |
| Review: routes/task-review.ts; tasks/review-service.ts; TaskReview | Existing one-stage authorised ACCEPT/REWORK/REJECT and pinned comments. | Explicit Expert -> PM workflow, three-state UI projection and new authority checks. |
| Payments: pay/ledger.ts; routes/payments.ts | Eligibility/rate-card/pay-route and payout controls exist. | Do not replace. New review-stage events must not duplicate earnings or release payment early. |
| Dataset/export: dataset/approved-records.ts; routes/dataset.ts | Immutable accepted record/hash chain and NDJSON export exist. | Per-template executable Anvil contracts; preserve 409 NO_EXECUTABLE_CONTRACT when absent. |
| Workflow graph | Earlier dependency map and design previews exist. | Typed decisions, human interaction, bounded loops, horizontal layout and matching runtime/export qualification. |

All paths above are relative to the inspected Praxis checkout. Source names are evidence locations, not a guarantee of interface stability. Existing TaskInstance output and project/template IDs remain canonical. The graph UI and new template profiles must not create a parallel database of answers.

## Intentional local behaviour already changed

New authoring-project callers require an explicit authoring experience. NULL legacy remains previous access; no silent backfill. Classic PUT is denied for Chatbot-only; chat mutation is denied for Classic-only. New configured projects require common consent/declaration and disallow generative draft/redraft paths. Both uses a save-before-switch barrier and persisted unsent answer. KYC section changes save first; a failed save retains the current section. View as Agent saves first and retains the mounted editor. Paused projects cannot mutate chat. Annotation retains its path and read-only phone behaviour is preserved.

## Changes to flag before implementation/release

1. New uniform eight-section renderer changes layout/navigation for generic templates; assess legacy saved outputs and specialised domain controls.
2. Adding graph fields changes schema, validators, agent visibility and export adapters. Version it; do not reinterpret existing dependsOn as a loop.
3. SME/Expert policy access changes permissions and introduces a publication queue. Audit tenant/project scope and rights.
4. Two-stage approval changes event timing, record immutability and payment eligibility. Prove no duplicate acceptance/earning/export.
5. Safer question planner may change the chatbot's current deterministic wording; measure supported extraction and off-topic refusal, not conversational fluency alone.
6. MaaS migration changes auth, model IDs, structured-output support, reasoning/output billing, latency and data-processing commitments. Keep provider-independent semantics and rollback.
7. Document retention, consent and typing restrictions need accessible alternatives and project-policy notice. No unannounced surveillance or secret monitoring of external devices.

## Evidence boundary

Previous full local API run: 724 pass / 5 explicit gated skips, with separate later Classic-only focused lifecycle coverage. Candidate 23, console 55, shared 192, MCP replay 2 passed in the prior local delivery. The persistence follow-up added an actual Chrome/API/SQL journey across 14 catalogue templates, with final-keystroke/tab saves, failed-save retention, reload and editor switching. It also passed candidate typecheck and production build. None proves the new graph runtime, new MaaS model quality, new two-stage approval, live payouts or deployed acceptance.
