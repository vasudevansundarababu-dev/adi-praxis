# QA record — Policy Rules (S1 AC01–AC20, S2 A01–A12)

QA pass of the Policy Rules feature against [PRD-POLICY-RULES.md](../prd/PRD-POLICY-RULES.md) §10, for
[PLAN-POLICY-RULES.md](../plan/PLAN-POLICY-RULES.md). Staging deploy, live provider smoke and merge are not part of this record.

- **Date:** 10 Nov 2026
- **Baseline:** `feat/policy-rules` at `6bbb5f5`, plus the tests and this record committed with it
- **Environment:** local only, separate from `pnpm dev` and from Anvil: Postgres database `praxis_enh_qa`, Redis DB 9,
  API on 4040, console on 3140. Object storage in memory (no GCS emulator in this sandbox).
- **Providers:** recorded provider responses and test doubles only. Live extraction off, no provider keys set.
  No paid calls.
- **Independence:** this pass was run by the conversation that wrote the code. An independent pass followed on 10 Nov
  (see "Independent QA" below).

## Summary

| Item | Result |
| --- | --- |
| Acceptance criteria | 26 of 32 rows pass with test, runtime or review evidence; 4 partly (AC02, AC14, A04, A05); 1 deferred to staging (A01 live half); 1 out of scope (A11) |
| Browser journey | Pass on 3 screens (project policy workspace, task list readiness, task policy). Screenshots kept outside git |
| Runtime API | Pass: seed idempotent, production refused, SME view read-only and private, PM-only exports |
| Security | Pass for what was checked. No secrets, cookies or policy text in the API log |
| Defects | 1 found and fixed in this pass (DEF-1). 0 open |

## Test suites

| Suite | Result |
| --- | --- |
| API (Vitest) | 685 passed, 2 failed, 6 skipped. Both failures (`infra.test.ts`, `meta-compiler-sweep.test.ts`) need Docker / the GCS emulator, which this sandbox lacks. They do not touch policy code; not re-run elsewhere |
| Policy tests | `policy-rules` 19, `policy-adapters` 12, `policy-handoff` 13: all pass |
| `apps/web` | 55 passed; typecheck clean |
| `apps/candidate` | 23 passed; typecheck clean |

## Defects

### DEF-1 — Runtime database role could still update and delete policy records (A10, fixed)

The migration revokes UPDATE/DELETE on `PolicyDocumentVersion`, `ProjectRuleSet`, `TaskPolicySnapshot` and
`ExtractionSpend`. But `grantAppRole` (run after each deploy) re-grants every table and then revokes only its own
list. That list did not include the four new tables. Triggers still blocked changes, but the privilege layer did not.
Found by the existing append-only check in `tasks.test.ts`. Fixed in `6bbb5f5` (`APPEND_ONLY_TABLES`); `deploy.test.ts`
now covers the four tables.

## Runtime checks (QA server)

| Check | Result |
| --- | --- |
| `policy-seed` first run / second run | 5 created / 0 created, 5 skipped |
| `policy-seed` with `APP_ENV=production` | Refused: "policy-seed refuses to run in production" |
| Seeded projects | 4 publishable; *Phone launch* blocked by the deliberate conflict (`same_rule_id_different_content`) and its draft |
| Task list readiness | All 10 seeded tasks "Frozen, current" |
| Extraction | "Not available" with the four reasons; no fake receipt |
| SME, own task (`/me/tasks/:id/policy`) | 200, `readOnly: true`, only the 2 agent-visible rules, 0 changes (the seeded change is on an evaluator-only rule), no evaluator text |
| Another SME, same task | 404 |
| SME `POST` to the view / SME on PM route | 404 / 401 |
| PM on `/dataset/export`, `/studio-tasks/export` | 403 (Admin + RL Gym only, unchanged) |
| API log | No passwords, session cookies or policy text |

## Browser journey (console, PM)

1. Project → **Policy rules**: two fictional SEED documents with hashes. Extraction "Not available" with reasons.
   Four rules (3 Reviewed, 1 Draft) with source evidence ("Quote found in this version"). Publication blocked by
   the draft and by "Rule ID weekly_spend_cap appears in more than one source with different requirements."
2. Tasks and invites: new **Policy** column. "Frozen, current" links to the task policy page.
3. Task policy: rule set v1, 3 rules, 1 task change, rubric `template:<id>@1 (unchanged)`, snapshot published and
   up to date, **Anvil test: Not tested**. Evaluator-only rule labelled. Download sidecar offered.
   No console errors.

## UX observations (not defects)

- The PRD names the entry "Sources and Policies" with stages "Extract" and "Review Rules". The build has one
  **Policy rules** page with sections "Extract candidate rules" and "Rules". It is one workspace, as AC02 asks, but the labels differ.
- A seeded project's policy page is reachable from the project summary and from the task list. There is no policy
  link in the top navigation (matches existing patterns).

## Acceptance criteria

| Row | Result | Evidence |
| --- | --- | --- |
| AC01 Existing UI | Pass | Screens use existing shell, tables, uploads, tokens (browser journey) |
| AC02 Single workspace | Partly | One page, no separate workbench route. Labels differ from the PRD (see observations) |
| AC03 Document scope | Pass | `rejects unsupported files and documents over the page limit`; `identifies formats by content and counts pages` |
| AC04 Provider truth | Pass | `reports Not available while the profile is disabled…`, `…not configured, with no fallback`; manual text: `accepts pasted text with a declared locator granularity…`; runtime "Not available" |
| AC05 Source provenance | Pass | `stores an immutable version with hash…`; `every seeded rule resolves to the exact document version and hash it quotes` |
| AC06 Review gate | Pass | `publication is blocked until rules are reviewed…`; `detects the same rule ID with different content as a blocking conflict`; runtime Phone launch block |
| AC07 Inheritance | Pass | `…then immutable and idempotent; tasks inherit it`; no per-task checkboxes in the UI |
| AC08 Template isolation | Pass | `publishing rules and snapshotting tasks leaves the template blueprint and scoring untouched`; snapshots pin `template:<id>@<version>` |
| AC09 Conditional checks | Pass | `a rule tied to scheduling reads Not applicable outside it…` |
| AC10 Exceptions | Pass | `refuses an exemption when the rule defines no exception; accepts a clarification` |
| AC11 Frozen handoff | Pass | `publishes an immutable snapshot with a digest…`; `dataset export carries the frozen snapshot…`; `studio task export adds the policy sidecar…`; `the sidecar matches contracts/praxis/policy-snapshot.schema.json` |
| AC12 Historical integrity | Pass | Append-only triggers + revokes (DEF-1 fixed); export reads the snapshot, not current rules |
| AC13 Rubric stability | Pass | Template blueprint, criteria and version unchanged after seeding and publishing (test above) |
| AC14 Verdict semantics | Partly | Praxis computes no verdicts; it shows "Anvil test: Not tested" and never Pass. The verdict states themselves belong to Anvil |
| AC15 Evaluator ownership | Pass (review) | Praxis sends rules and hints only; no engine, credential or execution code added |
| AC16 Legacy compatibility | Pass | `a legacy task without a rule set is Not configured and unchanged`; legacy export rows have no `policy` key; SME view returns `configured: false` |
| AC17 Concurrency and retries | Pass | `…stale decisions are rejected…`; `runs one job per version… idempotent`; `a deliberate rerun is a child attempt` |
| AC18 Authorisation and audit | Pass | `keeps projects private: another PM gets 404…`; runtime SME 404/401, PM 403 on exports; review/publish audited |
| AC19 Seed slice | Pass | Seed tests (5 projects, idempotent, production refused, SEED-labelled, no invented reviews/people); runtime seed |
| AC20 No benchmark rewrite | Pass (review) | No Anvil code or shared contract changed; sidecar is optional and marked proposed |
| A01 Both adapters | Pass in CI / staging owed | 12 recorded-response tests. Live smoke is a later owner-gated staging step (≤ $50) |
| A02 Profile selection | Pass | `only an Admin may choose the provider; the project setting is used and audited` |
| A03 One canonical output | Pass | Both adapters normalise to one schema; one review screen |
| A04 Formats on both providers | Partly | PDF and TXT recorded for both; DOCX/Markdown by format detection only. Live check in staging |
| A05 Citation locators | Partly | Field association and quote matching (whitespace, typographic quotes) tested; malformed and converted-page locators not separately tested |
| A06 Quote and source checks | Pass | `keeps a quote that is not in the document as Needs definition`; extraction never marks Reviewed |
| A07 Retries and budget | Pass | `marks an ambiguous submit Uncertain without resubmitting`; `refuses a job that would exceed the provider budget` |
| A08 Provider switch | Pass | New attempt per switch; reviewed rules and snapshots untouched (append-only) |
| A09 Rubric unchanged; frozen import | Pass | AC13 test; export reads snapshot by ID |
| A10 Isolation and secrets | Pass | Key in header only, allowlisted hosts, file cleanup (adapter tests); log scan clean; DEF-1 fixed |
| A11 Comparison trial | Out of scope | D-T1 |
| A12 Disabling a provider | Pass | Disabled profile reports Not available; manual authoring still works |

## Independent QA (10 Nov, separate conversation, head 67e8d86)

Run in a separate conversation that did not write the code, with local services only and no provider keys.

- **Verdict on the code:** sign-off. No Blocker defects and no AC marked Fail. A05 stays Partly (no malformed or converted-page locator test); the A01 live half stays for the staging smoke.
- **Suites:** typecheck clean; API 689 passed, 1 failed (`infra.test.ts`, needs the Docker socket), 5 skipped; web 55, candidate 23, shared 188 passed. Policy suites 44 passed.
- **Spend safety:** a throwaway concurrency test with a budget that fits exactly one job gave `[202, 409 BUDGET_EXHAUSTED]`, and a null ceiling gave `409 BUDGET_NOT_SET`. The advisory lock serialises reservations.
- **Migration:** additive only. Applies on an empty database and on a database at `main`'s schema; existing rows intact; 13 append-only triggers.
- **Security:** route access matrix (200/403/404/401) as designed; PM view hides profiles, budget and cost; API log has no policy text, keys or cookies.
- **Seed:** refuses production; 5 created on the first run, all skipped on the second; CLI matches the live-setup guide §3.
- **Defects raised:** D1 PR description still said "PRD, docs only" (fixed: PR retitled and redescribed). D2 stale base SHA in the QA brief (no code impact). D3 flaky, pre-existing `tasks.test.ts` outbox receipt race (`outbox/dispatcher.ts:69`, unique `event_id, handler`), to be tracked separately. D4 this record (updated here). D5 labels differ from PRD wording ("Sources and Policies", "Review Rules"); owner to choose.

## Still owed before staging

1. Owner approves merging to staging and the rollback plan: the Roll back workflow (staging) moves traffic to the previous revisions; the migration is additive, so the previous image runs on the new schema; live extraction stays off.
2. `policy-seed` on staging (infra PR #37 applied), then live provider smoke within budget, then live off again.
