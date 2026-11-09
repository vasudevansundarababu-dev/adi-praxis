# Build plan: Policy Rules (aggressive, 2 days)

| Item | Value |
| --- | --- |
| Status | **Approved by the owner on 9 Nov 2026 (Gate 3: plan).** Coding started 9 Nov. |
| OpenHands budget | **$150** this conversation (build), **$50** independent QA conversation (owner, 9 Nov). Alert at 80%; stop at the cap unless raised. |
| Implements | [PRD](../prd/PRD-POLICY-RULES.md) (approved 9 Nov) and [architecture](../architecture/ARCH-POLICY-RULES.md) (approved 9 Nov) |
| Target | **Code complete on `feat/policy-rules` by end of 11 Nov 2026**; independent QA and staging deploy follow with separate approvals |
| Prepared by | OpenHands agent (Planner role), 9 Nov 2026 |

## 1. Approach

One lead conversation (this one) builds everything on `feat/policy-rules`, in vertical slices that each end green (typecheck + tests) and are pushed. No parallel coding streams: two days is too short to pay for their setup and merge cost, and one schema/migration owner avoids conflicts. Independent QA runs in a separate conversation that did not write the code (owner already has the PRD for test design).

What makes 2 days possible:
- Reuse, not new frameworks: `runCommand`, audit, outbox, BullMQ, GCS storage, `unpdf`/`mammoth` readers, the Vertex `GoogleAuth` pattern, `meta-compiler/cost.ts`, existing UI components.
- One additive migration; no change to existing schemas.
- Providers tested only with recorded responses; no waiting on accounts.
- Docs and PRs kept short; one draft PR (#35) updated as slices land.

## 2. Slices and schedule

| # | Slice | Closes (PRD) | Day |
| --- | --- | --- | --- |
| 1 | **Foundation**: Prisma models + one additive migration with append-only triggers; shared Zod canonical schema; policy sidecar JSON schema (`contracts/praxis/`, proposed); config names + validation | §6, PR-T07 (schema) | 10 Nov AM |
| 2 | **Documents**: upload (PDF/DOCX/TXT/MD, page counting, 20-page limit, scan), versions, metadata, manual text, source content route | PR-E01–E04, OD3 | 10 Nov AM |
| 3 | **Extraction service**: profile resolution (Admin override), idempotent batches, budget ledger + guard, BullMQ worker with polling/backoff/deadline, receipts, retry as child attempt, "Not available" path, cleanup | PR-E05–E07, E10, E11, E13, A02, A07, A08, A12, OD2, OD4, OD5 | 10 Nov PM |
| 4 | **Adapters + normaliser**: LlamaExtract and Google (Layout Parser online/batch + Gemini) with recorded fixtures; citation resolution and quote check; injection fixture | PR-E08, E09, E12, E14, A01, A03–A06, OD8 | 10 Nov PM |
| 5 | **Review and rule sets**: edit/versions, Mark Reviewed (PM), Exclude, conflicts and precedence cycles, preview, publish (idempotent, stale 409) | PR-R01–R10, OD1 | 11 Nov AM |
| 6 | **Tasks and export**: inherited view, task changes + exemption rules, snapshot publish + hook on new task versions, SME read-only route, export sidecar on both exports | PR-T01–T08, AC07–AC16, OD9 | 11 Nov AM |
| 7 | **Web UI**: Sources and Policies (Extract, Review Rules), project summary, tasks readiness column, task policy panel + change form, Admin extraction profiles, candidate read-only view | 5.1–5.4, AC01, AC02 | 11 Nov PM |
| 8 | **Seed + e2e + docs**: policy seed job (5 projects × 2 tasks, conflict, production refusal, idempotent), private Bodhium pack hook, one Playwright journey, `docs/integrations/PRAXIS-ANVIL.md` + ADMIN docs | PR-S01–S05, AC19, OD6, OD7 | 11 Nov PM |
| 9 | **Infra PR** (separate branch `infra/policy-docai`): Document AI API, Layout Parser processor in `us`, IAM, secret name, GCS prefix | Arch §11 | 11 Nov PM |

Each slice: code + tests for its acceptance rows → `pnpm -r typecheck` + affected tests green → commit → push. Full `pnpm -r test` and e2e at the end of each day.

## 3. After code complete (separate approvals)

| Step | Who | Gate |
| --- | --- | --- |
| Independent QA on `feat/policy-rules` against PRD §10 | QA conversation | Owner authorises QA |
| Fixes from QA | Lead | — |
| Owner applies infra PR; sets LlamaExtract key in Secret Manager | Owner | — |
| Staging deploy + seed + live smoke (1 small fictional file per provider, within $50) | Lead | **Owner names staging and approves; rollback = previous image + migration is additive** |
| Merge to `main` | Owner | Review |

## 4. Definition of done (code complete)

- Every PRD §10 row (except A11, and the live half of A01) has an automated test or a named manual check.
- `pnpm -r typecheck`, `pnpm -r test` and the e2e journey pass locally; CI green on the PR.
- No live provider calls from tests; no secrets committed; no Healthcare content; no Azure code.
- Existing tests still pass (legacy compatibility, AC16).

## 5. Isolation

Checkout `/workspace/praxis-enhancements`, compose project `praxis-enh`, test DB `praxis_enh_test`, default ports. QA conversation uses its own sandbox, compose project `praxis-polq` and ports +40. No Anvil resources, services, conversations or `/workspace/anvil-prd-validation`.

## 6. Risks and responses

| Risk | Response |
| --- | --- |
| Two days is tight for UI polish | UI built from existing components; layout follows spec figures; polish items logged, not blocking code complete |
| Provider response shapes differ from docs | Fixtures written from the official docs; first staging smoke confirms; adapter fixes are small and isolated |
| Hooking snapshots into task versions touches existing flows | Additive nullable column; hook is a no-op without a rule set; existing tests guard it |
| Migration on staging | Additive only; rollback = redeploy previous image (new tables unused) |
| Scope creep | Anything not in the PRD goes to the enhancement backlog (like E-1) |

## 7. Approval

Owner approves this plan → coding starts immediately on slice 1.
