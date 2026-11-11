# Template profiles and the Anvil contract compiler (Waves 1 to 3)

Status: built on `wave1-template-profiles` for AUTHORING-V2.1-PLAN Wave 1; Wave 2 (adverse media review, enhanced due
diligence, customer risk rating) on `wave2-template-profiles`; Wave 3 (Q4 global paid search query clustering, fraud-risk and
compliance handoffs, compliance monitoring) on `feat/authoring-wave3`. Field contracts outside KYC are marked
`requires_confirmation` (plan §6) until the domain owner confirms them.

Code: `packages/shared/src/template-profile/` (schema, registry, helpers, `contract.ts` compiler, one file per
profile in `profiles/`). Classic renderer: `apps/candidate/components/work/profile-editor.tsx`. Server:
`apps/api/src/tasks/profile-output.ts`.

## Storage

- Non-KYC profiles store `output.profile = { id, version }` and `output.sections = { S1: {...}, …, S8: {...} }`.
  `output.header.title` mirrors `S1.title` (a save where they differ is rejected); `header.coverageTags` and
  `header.edgeCase` stay where the submission and review code reads them.
- KYC keeps the existing `KycTask` contract. Its profile is `storage: 'canonical'`: every field names its exact path
  (`scenario.trigger`, `customerFile.parties`, …). The KYC workbench stays the editor (`domainPlugin: kyc-workbench`).
- Legacy outputs (no `profile` key) are never migrated: they open in the generic editor and save and submit as before.
- Unknown keys in a profile output are preserved.

## Visibility

`author_and_agent` fields form the agent projection, as an allow-list at every depth. `private_reference`
(solution, outcomes, recorded responses, applicability rationale, known gaps) and `private_rubric` (criteria, common
errors, acceptable variations) never reach the agent preview or actor evidence.

## Contract mapping (`praxis.anvil.task.v1`, structured-decision-v1)

| Contract | Source (sections profiles) | Source (KYC) |
|---|---|---|
| `task_id`, `revision_id` | task ID; `<taskId>-r<revision submitted>` | same |
| `task_version` | `<profileId>.v<version>` | `kyc-onboarding-and-refresh.v1` |
| `title` / `objective` | S1 title / S1 business context + requested deliverable, plus the output.json field list | header.title / scenario.businessContext + field list |
| actor `evidence[]` | each S2 evidence record (its ID, type, source, date, content); other agent-visible S2 fields (KYB parties, ownership) as one item each; recorded responses when S3 environment is `recorded_tools`; cited rules without a binding | case file, parties, ownership, each document (without defects), each recorded response, each task policy rule |
| private `evidence[]` | S2 known gaps, S5 rationale, S5 unresolved issues | document defects, reference rationale |
| `constraints[]` | S4 citations that name an output field: `policy-<ruleId>`, hard failure flag, binding | none (KYC has no typed rule bindings) |
| output.json fields | S6 pick lists with `outputField` (string, allowed values = the pick list) + S6 "Further output fields" (name, string/number/boolean, allowed values, reference value) | `disposition`, `risk_rating` |
| `rubric.reference_output` | the selected S6 values and each further field's reference value | solution.disposition, solution.riskRating |
| `rubric.criteria[]` | S7 criteria: output field, comparison (`json_equals`, `json_number_min`, `json_number_max`), expected value; weight × 100 = basis points (total 10000) | rubric.criteria with the same three optional keys (additive extension of `KycTask`) |
| `environment` | `structured-decision-v1`, `initial_state` = `{ synthetic, profile_id, profile_version }` (KYC adds `available_tools`) | |
| stages / actions / deliverables | one stage over all actor evidence; `action-submit`; `deliverable-output` at `output.json` | |
| `provenance` | `synthetic`, rights `declared` (author's synthetic declaration), review `draft` bound to the revision | |

Choices: recorded tool responses are supplied up front as actor evidence because structured-decision-v1 has no tool
replay; a cited rule without a binding is agent context, not a constraint; S7 weights must total 100 in every
profile (needed for the 10000 basis points).

Blockers (never a partial contract), each with its source path: `MISSING_FIELD`, `MISSING_REFERENCE`,
`MISSING_BINDING`, `UNKNOWN_OUTPUT_FIELD`, `INVALID_BINDING`, `INVALID_VALUE`, `INVALID_ID`, `DUPLICATE_ID`,
`DUPLICATE_OUTPUT_FIELD`, `REFERENCE_FAILS_RULE`, `WEIGHTS`, `NO_OUTPUT_FIELDS`, `NO_CRITERIA`, `NO_EVIDENCE`,
`CONTRACT_INVALID` (any residual `praxisContractIssues`), `PROFILE_NOT_APPLICABLE`.

At submission the contract is stored in `output.praxisContract` with a `praxisContractCompiled` marker (so the
approved record carries it and `GET /dataset/records/:id/praxis-contract` exports it unchanged). With blockers the
submission still succeeds; the stored checks carry `export: { status: 'blocked', blockers }`, shown as
"Approved; export adapter blocked: <reason>" on the task and review screens. A hand-written legacy contract is never
replaced. Existing KYC tasks have no criterion bindings yet, so they submit as before with a blocked export status
until the workbench edits the three binding keys.

## Catalogue names

Profiles match the catalogue (`apps/api/prisma/catalog/index.ts`), not the handover names:
"Launch of Noise Cancelling Phone" (handover: Noise Cancelling Headphones Launch),
"Omnichannel Creative & Locale Compliance" (handover: "and"), "KYB and beneficial ownership",
"AML transaction-monitoring alerts", "KYC onboarding and refresh". Nothing is renamed.

## Wave 2 profiles

All three are `storage: 'sections'`, `agentMode: 'SINGLE'`, `contractStatus: 'requires_confirmation'`, built by
`sectionsProfile` (`common.ts`) like KYB and AML, so S1–S4, S7 and S8 and the common S5/S6 fields are the shared
ones (title, trigger, business context, deliverable, scope, language, as-of date; evidence records; environment,
tools and recorded responses; policy citations; steps, findings, rationale, unresolved issues, business hand-off;
further output fields; criteria with typed bindings, weights total 100, at least one critical; common errors and
acceptable variations; sources used). Only the template-specific parts below come from each
`handover-v2/templates/<slug>/task.md` draft. Pick-list values are the drafts' "current proposed labels", verbatim.

| | Adverse media review (BK03) | Enhanced due diligence (BK10) | Customer risk rating (BK09) |
|---|---|---|---|
| Profile file | `profiles/adverse-media-review.ts` | `profiles/enhanced-due-diligence.ts` | `profiles/customer-risk-rating.ts` |
| S1 subject | Customer type | Customer type | Customer type |
| S2 evidence types | customer_identifiers, media_extract, source_metadata, other | high_risk_case, source_of_funds, source_of_wealth, ownership_record, adverse_finding, other | customer_profile, risk_factor, supporting_evidence, rating_methodology, other |
| S5 deliverables (private) | identityMatch, sourceReliability, allegationsVsFacts, relevance (all required) | enhancedChecks, evidenceGaps, riskAssessment (required); business hand-off **required** | factorAssessments (repeated: id `RF1…`, factor, assessment, evidenceRefs; required), calculation (optional, "where supported"), overrideRationale (required when S6.override is proposed_increase or proposed_decrease) |
| S5 finding fields | common | + evidenceStatus: verified, unverified, conflicting, missing (required) | common |
| S6 output fields (private reference) | `match`: confirmed, possible, false_positive, unresolved; `recommendation`: close, escalate, request_information | `recommendation`: proceed_for_approval, request_information, escalate, recommend_decline | `risk`: low, medium, high, undetermined; `override`: none, proposed_increase, proposed_decrease |

Contract mapping is the common sections mapping above, unchanged: each S6 pick list becomes a string output.json field
whose allowed values are the pick list, and its selection is the `rubric.reference_output` value; S7 criteria bind to
those fields (or to S6 "further output fields"). EDD's per-finding evidence status is private reference material (part
of the S5 findings), not an output.json field; an author who wants it graded adds a further output field. CRR's
methodology, factors and bands are S2 evidence the author supplies; the profile defines no factor, weight or
threshold, and the calculation is free text because the draft gives no calculation contract.

Starting workflows (`workflow-graph/template-graphs.ts`) use the common review pattern: case inputs → review →
"sufficient?" decision (yes / missing / else and unknown to escalation) → request information, returning to review
(bounded loop, 2 iterations, exhausted → escalate) → conclude → output. Enhanced due diligence adds an "Approver
decides" human step (authorised approver, Approve/Decline, timeout → escalate) between conclude and output, because its
draft lists a human hand-off and a `proceed_for_approval` outcome. Adverse media review and customer risk rating have no
business human step: their drafts do not describe one. Roles list no tools: the drafts leave the tool catalogue open.

Owner decisions (12 Nov 2026), now built:
- The pick lists above are final.
- Adverse media: S5 source reliability is a repeated list (`MS1…`: source, reliability high / medium / low / unknown,
  reason, evidence). The workflow sends an `escalate` recommendation to a person step "Compliance reviewer decides"
  (Confirm / Dismiss, timeout → escalate) behind an "Escalation recommended?" decision; other recommendations go
  straight to the output.
- EDD: S6 adds a graded `risk_rating` (low / medium / high / very_high) beside the recommendation; the written risk
  assessment stays in S5.
- CRR: each factor assessment has a rating (low / medium / high). No weights or formula: the author's methodology
  evidence decides the overall rating. A proposed override goes to "Senior compliance approver decides" (Approve /
  Decline, timeout → escalate) behind an "Override proposed?" decision; no override goes straight to the output.
- All templates: failing a critical criterion fails the whole task. The compiler exports each critical criterion
  also as a `constraints[]` entry `<criterion id>.critical` with `hard_failure: true` and the same binding; the
  criterion keeps its weight.

Still not mapped (nothing invented): exact field names beyond these lists, the published agent mode, and the qualified
tool catalogue (S3 tools stay free entries, `allowCustom`).


## Wave 3 profiles

Built exactly like Wave 2: `storage: 'sections'`, `agentMode: 'SINGLE'`, `contractStatus: 'requires_confirmation'`,
`sectionsProfile` (`common.ts`) for the shared S1–S8 fields, and only the template-specific parts below taken from each
`handover-v2/templates/<slug>/task.md` draft. Pick-list values are the drafts' "current proposed labels", verbatim. All
three are in the catalogue (`apps/api/prisma/catalog/index.ts`); nothing was added to it. Q4 paid search is a Digital
Marketing workflow: it uses no banking field names. The fraud handoff profile matches the catalogue name
"Fraud-risk/compliance handoffs" and the seeded old-lineage name "Fraud–risk/compliance handoffs" (en dash), because
lookups ignore dash style.

| | Q4 global paid search query clustering (DM01) | Fraud-risk and compliance handoffs (BK11) | Compliance monitoring (BK06) |
|---|---|---|---|
| Profile file | `profiles/q4-global-paid-search-query-clustering.ts` | `profiles/fraud-risk-and-compliance-handoffs.ts` | `profiles/compliance-monitoring.ts` |
| Catalogue name | Q4 Global Paid Search Query Clustering | Fraud-risk/compliance handoffs | Compliance monitoring |
| S1 subject | Product or brand | Customer type | Monitored area |
| S2 evidence types | query_dataset, product_brief, locale_constraint, channel_constraint, other | fraud_alert, transaction_records, case_timeline, roles, escalation_policy, other | monitoring_scope, records, obligations, monitoring_period, other |
| S5 deliverables (private) | clusters (repeated: id `CL1…`, name, definition, evidenceRefs; required), queryAssignments (repeated: query, clusterId, intent, assignment, evidenceRefs; required), exclusions (required), ambiguousQueries (required) | facts, fraudIndicators, complianceConcerns, handoffPackage (all required) | obligationAssessments (repeated: id `OB1…`, obligation, assessment, result, evidenceRefs; required), exceptions (required), proposedFollowUp (required) |
| S5 per-item pick lists | queryAssignments: `intent` and `assignment` (the draft lists, required) | none | obligationAssessments: `result` (the draft list, required) |
| S6 output fields (private reference) | `intent`: informational, commercial, transactional, navigational, unclear; `assignment`: assigned, excluded, needs_review (both for the focus query) | `handoff`: fraud, compliance, joint_review; `recommendation`: request_information, escalate, close_with_rationale | `result`: compliant, noncompliant, insufficient_evidence, not_applicable; `severity`: low, medium, high, critical, undetermined |

Contract mapping (`praxis.anvil.task.v1`, structured-decision-v1) is the common sections mapping, unchanged: S1
business context and deliverable → `objective`; S2 evidence → actor evidence; S2 known gaps, S5 rationale and
unresolved issues → private evidence; S4 → policies; each S6 pick list → a string output.json field whose allowed
values are the pick list, with the author's selection as `rubric.reference_output`; S6 further output fields →
additional output fields; S7 criteria bind to those fields. Per-item pick lists (Q4 query labels, compliance
monitoring obligation results) are private reference material in S5, not output.json fields; an author who wants one
graded adds a further output field.

Starting workflows use the common review pattern (case inputs → review → "sufficient?" decision with else and unknown
to escalation → request, returning to review in a bounded loop of 2 with exhausted → escalate → conclude → output).
None of the three has a business human step: the drafts describe none. Roles list no tools.

Owner decisions (12 Nov 2026), now built:
- **Pick lists** above are final.
- **Q4 paid search: every query is graded** (no focus query). Anvil's task v1 has no list type and allows 50 criteria,
  so each query in S5 Query assignments (at most 20 per task, checked at save and export) becomes output.json fields
  `q01_intent`, `q01_assignment` and `q01_cluster`, each described with its query text. Praxis generates one
  `json_equals` criterion per query for intent and for assignment; together they carry 50% of the score and the author's
  S7 criteria keep their proportions in the other 50%. Cluster labels are the agent's own, so Anvil does not grade them:
  Praxis scores clustering by pairwise F1 (pass at 0.99, the catalogue's bar) when RL Gym / Anvil returns the run's
  output.json as `final_output` on the review request, and shows it to the RL Reviewer as advice. `final_output` is a
  new optional Praxis-side field: Anvil must send it for the score to appear.
- **Fraud handoffs:** fraud indicators and compliance concerns are repeated items from fixed lists (indicators:
  account_takeover, money_mule, synthetic_identity, first_party_fraud, authorised_push_payment_scam, card_fraud,
  insider_fraud, other; concerns: suspicious_activity_report, sanctions, customer_due_diligence, data_protection,
  conduct_risk, other), each with a description and evidence. The common business hand-off is hidden (the handoff package
  is the hand-off). The workflow ends with a person step "Receiving team accepts handoff" (Accept / Return, timeout →
  escalate).
- **Compliance monitoring:** exceptions are repeated items, each with its own severity (low / medium / high / critical)
  and evidence; the overall S6 severity stays the graded output.

Requires confirmation (left for the domain owner, nothing invented):
- all three: exact field names and enums beyond the proposed labels, published agent mode, qualified tool catalogue
  and environment, critical-failure scoring semantics, executable Anvil mapping (draft open questions);
- Q4 paid search: the draft's labels are per query, but the S6 contract holds scalar values, so S6 grades one "focus
  query"; a list-valued output.json shape (every query's cluster and intent) is not supported yet. The catalogue's
  verification criterion "F1 >= 0.99" against the SME oracle is not encoded as a profile check (no scoring contract);
  cluster naming and coverage rules are case evidence (the brief), not profile rules;
- fraud handoffs: whether the receiving team (fraud, compliance, joint review) is a business human step in the graph,
  and its response schema; the contents of a handoff package (free text); no enum for fraud indicators or compliance
  concerns; whether the S5 business hand-off should be required;
- compliance monitoring: whether severity is rated per exception or overall (S6 holds one value); obligation and
  threshold definitions are case evidence; no follow-up enum (free text, a proposal only).
