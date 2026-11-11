# Template profiles and the Anvil contract compiler (Wave 1)

Status: built on `wave1-template-profiles` for AUTHORING-V2.1-PLAN Wave 1. Field contracts outside KYC are marked
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
