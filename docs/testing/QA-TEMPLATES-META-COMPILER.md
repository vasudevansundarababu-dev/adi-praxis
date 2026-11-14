# QA record — Templates & Meta-Compiler (Q1–Q5)

QA pass of the Harbor Templates Directory (Screen 1), Meta-Compiler (Screens 2–3) and SME Studio (Screen 4)
against [PRD-TEMPLATES-META-COMPILER.md](../prd/PRD-TEMPLATES-META-COMPILER.md), for plan items Q1–Q5 in
[PLAN-TEMPLATES-META-COMPILER.md](../plan/PLAN-TEMPLATES-META-COMPILER.md). Q6 (owner QA on a non-production
environment) is not part of this record.

- **Date:** 9 Nov 2026
- **Baseline:** `feat/mc-integration` at `4598f29` (75 commits ahead of `main`), plus the two e2e spec changes committed with this record
- **Environment:** local only, isolated from `pnpm dev`: Postgres `praxis_e2e` on 15452, Redis on 16399,
  fake GCS on 14453 (forwarded to 4443); e2e servers on web 3300, candidate 3301, API 4300/4301
- **Providers:** mock drafter, mock runner, mock Google sign-in, mock judge. No live AI or paid provider calls.

## Summary

| Item | Result |
| --- | --- |
| Q1 Acceptance criteria | 80 of 87 PRD rows pass with test evidence; 1 fails (S1-08, DEF-1); 1 not built (S3-10, Phase C); 1 open (D-23); 4 NFRs checked by review (NFR-02 partly, NFR-04, NFR-05, NFR-11) |
| Q2 Browser journey | Pass. `e2e/meta-compiler-journey.spec.ts`: 3 tests |
| Q3 Security | Pass. No new findings |
| Q4 Performance (NFR-12) | Pass on a production build |
| Q5 Hardened sandbox | Pass for the 3 seeded blueprints, the owner's private C5 template (rerun 9 Nov) and the hostile bundle |

## Test suites

| Suite | Result |
| --- | --- |
| API (Vitest, with `HARBOR_DOCKER=1`) | 650 passed, 0 failed (204 suites) |
| `packages/shared` | 188 passed |
| `apps/web` | 54 passed |
| `apps/candidate` | 23 passed |
| Playwright (`pnpm test:e2e --retries=1`) | 24 passed, 1 skipped (deployed-only), 0 flaky, 2.7 min |

Earlier full Playwright runs without retries failed one or two different tests per run (`smoke.spec.ts:11`,
`smoke.spec.ts:74`, `tester-profile-form.spec.ts:5`). Each passed when run alone and on retry. This looks like
load-related timing with 4 workers on 4 cores; CI already retries once.

CI first failed the journey test because the e2e worker had no storage settings: it fell back to real GCS and
verification stayed "Running". Earlier local runs passed, probably because that shell carried the emulator settings.
`e2e/playwright.config.ts` now gives the API and the worker the same emulator settings. The test fails on the old
config and passes with the fix, both run the way CI runs it.

## Defects

### DEF-1 — TPT shown twice on Screen 1 (S1-08, Must)

The directory TPT cell renders `45m (45m (12 Wks))` instead of `45m (12 Wks)` (seen on a production build).
`tptLabel()` in `apps/api/src/meta-compiler/blueprint.ts` returns the full text, the seeded blueprints store the
full text in `template_meta.tpt_label`, and `tptText()` in `apps/web/lib/mc/format.ts` wraps it in minutes again.
The unit tests disagree on the contract (`meta-compiler-directory.test.ts` expects `45m (12 Wks)` from the API;
`directory.test.tsx` passes `15 Steps` to `tptText`), so both pass. Not fixed in this pass; owner to decide
whether the label carries only the horizon or the full text.

## Q2 — Browser journey

`e2e/meta-compiler-journey.spec.ts`:

1. An Admin goes from the directory to the Meta-Compiler, generates and verifies, deploys to a project; the SME
   authors and commits a task in the studio; a separate Reviewer approves it (S1-06, S4-14 and the full flow).
2. The workflow name opens Screen 2 and browser Back keeps the domain filter; Save Variant creates a new workflow;
   Reset to factory restores the original blueprint (S1-05, S2-12, S2-13).
3. A PM sees the directory read-only: no Meta-Compiler toolbar, Screen 3 and the Tasks DB return 404, and the
   UISpec, deployments, studio-task and test-setup APIs return 403 (S1-15).

`e2e/smoke.spec.ts` now expects the heading `Harbor Templates Directory` and no "New template" or "Add domain"
control (S1-12, S1-13).

## Q3 — Security

- **RBAC:** every route declares `config.access`; `apps/api/src/auth/rbac.ts` refuses to start if one does not.
  Directory and blueprint read: Admin or PM. Blueprint, variant and UISpec writes: Admin only.
- **Tenancy:** 8 cross-client tests on the meta-compiler routes.
- **Hidden paths:** `/eval/*` and `/solution/*` never reach the agent workspace (D-21; harbor-bundle tests and the
  Q5 hostile bundle).
- **Live-call refusal:** `meta-compiler-config.test.ts` refuses live AI in local, demo, test and staging without
  the bot.
- **Prompt injection:** fixtures exist for support, profile assistant, SME profile, drafting and the meta-compiler
  drafter. A QA probe of the LLM judge (not committed) confirmed a deliverable cannot close `<deliverable>` or open
  a second `<checklist>`, and that awards are clamped to each criterion's points.
- **Secrets:** no provider keys in tracked files; model lists show no keys (S3-02).

## Q4 — Performance (NFR-12)

Seeded with 500 templates.

| Check | Limit | Measured |
| --- | --- | --- |
| Directory API | < 2 s | 144–234 ms (5 runs); 0.66 s in `meta-compiler-directory.test.ts` |
| Directory page, production build | < 2 s | 567–678 ms (5 runs) |
| Inspector update | < 1 s | under 50 ms average (web unit test) |
| Task commit, excluding bundle upload | < 5 s | 139–244 ms (3 runs) |

The directory page takes about 3.8 s under `next dev`; that is dev compilation, not the app.

## Q5 — Hardened sandbox

Image `infra/harbor-verify/Dockerfile`, bundles from `scripts/harbor-verify-bundles.ts`, run with
`infra/harbor-verify/test/run_e2e.py`:

| Bundle | Null agent | Oracle |
| --- | --- | --- |
| Launch of Noise Cancelling Phone | 0.00 | 1.00 |
| AML transaction-monitoring alerts | 0.00 | 1.00 |
| KYB and beneficial ownership | 0.00 | 1.00 |
| Hostile bundle | 0.00 (forged reward and `conftest.py` ignored) | — |

The hostile bundle also confirmed: runs as `nobody`, no internet, cannot write `/etc/shadow` or change the
verifiers, judge files absent, symlinked output not followed.

**C5 (owner's private template), rerun 9 Nov 2026.** Pass. The file was the owner's chosen version (SHA-256 starts
`307d5b91`), read from its private folder outside the repository. The template content stays out of git; the run
outputs are kept with the private files.

| Check | Result |
|---|---|
| Blueprint sections | 6 of 6 valid; no studio answer problems |
| Bundle | 13 files, 8 hidden from the agent; no judge criteria in the SME view |
| Grading sandbox | Null agent 0.00, oracle 1.00; hostile bundle checks all passed in the same run |
| Import dry run (local QA database) | Would create version 1 as a DRAFT; nothing written |

## UX observation

The Reviewer queue labels a task by its slot brief (`<project> · <workflow>`), not by the SME's task title. A
Reviewer with several tasks from one project cannot tell them apart.

## Q1 — Acceptance criteria

Evidence is the test file that names the criterion ID. "Review" means checked by reading code and searching the
repository, without a dedicated test.

| ID | Pri | Requirement | Result and evidence |
| --- | --- | --- | --- |
| S1-01 | M | Workflows are grouped under domain headers with a count (e.g. Digital Marketing 3, Banking 12). | Pass — directory.test.tsx, meta-compiler-directory.test.ts |
| S1-02 | S | Domain filter pills: All plus one per domain. | Pass — directory.test.tsx |
| S1-03 | S | Summary cards: Total Templates, Active SME Studios, Attached Projects & SMEs, Authored Tasks. | Pass — directory.test.tsx |
| S1-04 | M | Columns: Workflow (link), Version, Status, TPT, Modes, Project & Assigned SME, SME studio URL & actions. | Pass — directory.test.tsx |
| S1-05 | M | Workflow name opens Screen 2 pre-loaded with that template. | Pass — meta-compiler-journey.spec.ts |
| S1-06 | M | Version shows the latest version label (`v1`, `v2`). | Pass — meta-compiler-journey.spec.ts |
| S1-07 | M | Status badge: **Active** (emerald) when a verified studio is deployed; **Draft** (slate) before. | Pass — directory.test.tsx, meta-compiler-directory.test.ts |
| S1-08 | M | TPT shows expected duration and horizon, e.g. `45m (12 Wks)`, `35m (15 Steps)`. | **FAIL** — DEF-1: renders `45m (45m (12 Wks))` |
| S1-09 | M | Modes shows the sandbox protocol: Hermetic MCP, Hermetic Graph, Hermetic SQL. | Pass — directory.test.tsx |
| S1-10 | M | Project & Assigned SME shows bound project ID and SME email once deployed. | Pass — directory.test.tsx, meta-compiler-directory.test.ts |
| S1-11 | M | Preserved studio URL with SME UI (open) action and Edit Template → action. | Pass — directory.test.tsx, meta-compiler-directory.test.ts |
| S1-12 | M | **Removed (owner, D11c = B):** no "New template" button. New templates come only from the seed or from Save… | Pass — directory.test.tsx, smoke.spec.ts |
| S1-13 | M | **Removed (owner, D11):** no Add domain button or form in the UI. Domains and templates are pre-seeded. | Pass — directory.test.tsx, smoke.spec.ts |
| S1-14 | C | Header shows the active workflow + version and a "Tasks DB & JSON" shortcut to Screen 4's store. | Pass — directory.test.tsx, task-store.test.tsx |
| S1-15 | M | PM view (D10 = A): read-only directory of the newest published version per workflow; workflow opens a read-… | Pass — directory.test.tsx, meta-compiler-directory.test.ts, meta-compiler-journey.spec.ts, meta-compiler.test.tsx |
| S1-16 | M | Retire the old catalog (D15a = C): every workflow and domain not in the mockup catalog is retired; the 12 o… | Pass — catalog-v2.test.ts |
| S1-17 | M | Seeded blueprints (D15): full, valid (6/6), synthetic blueprints for Launch of Noise Cancelling Phone, KYB… | Pass — catalog-blueprints.test.ts |
| S2-01 | M | Load the selected template's blueprint (the PDF's `domain_templates.json` record) into the editor. | Pass — meta-compiler-blueprint.test.ts, meta-compiler.test.tsx |
| S2-02 | M | **Stage 1 Domain, Persona & Horizon** (`domain_meta`, `harbor_contract`): Studio Blueprint ID, Display Titl… | Pass — blueprint.test.ts, meta-compiler-blueprint.test.ts, meta-compiler.test.tsx |
| S2-03 | M | **Stage 2 Data & Oracle Bifurcation** (`step_2_data_panels`): public dropzones (id, label, target path unde… | Pass — blueprint.test.ts |
| S2-04 | M | **Stage 3 Mock Env & MCP Simulators** (`step_3_mcp_simulators`): MCP tool IDs and parameters, SME widget ar… | Pass — blueprint.test.ts |
| S2-05 | M | **Stage 4 Guardrails & Invariants** (`step_4_invariant_catalog`): allowed subjects, operators (`GREATER_THA… | Pass — blueprint.test.ts |
| S2-06 | M | **Stage 5 Rubric Topology & Weights** (`step_5_default_rubric`): ordered milestones, coupled % sliders lock… | Pass — blueprint.test.ts, meta-compiler.test.tsx |
| S2-07 | M | Per-stage validity badges and an overall validity counter ("n/6 Valid": panel 0 Catalog & Staffing + 5 stag… | Pass — meta-compiler.test.tsx |
| S2-08 | M | **Custom fields by stage** (`custom_fields_by_stage`): `field_id`, label, `input_type` (`number_input`, `cu… | Pass — blueprint-generate.test.ts, blueprint.test.ts, meta-compiler.test.tsx |
| S2-09 | M | A field bound to `eval/test_verifiers.py` produces a deterministic `def test_custom_<field_id>(env_state):`… | Pass — blueprint-generate.test.ts, blueprint.test.ts, meta-compiler.test.tsx |
| S2-10 | M | Live inspector tabs: UISpec.json, Meta-Prompt, Pytest & Widget Map, each with Copy; footer counters (Dropzo… | Pass — blueprint-generate.test.ts, meta-compiler.test.tsx |
| S2-11 | S | Export UISpec.json download. | Pass — meta-compiler-blueprint.test.ts |
| S2-12 | S | Save Variant: register the customised blueprint under a new label for reuse in the switcher. | Pass — meta-compiler-blueprint.test.ts, meta-compiler-journey.spec.ts, meta-compiler.test.tsx |
| S2-13 | C | Reset to factory template. | Pass — meta-compiler-journey.spec.ts |
| S2-14 | S | Guided Elicitation Assistant: one-click domain presets (e.g. Creative Fatigue slider, Target CAC ceiling $4… | Pass — meta-compiler-assistant.test.ts, meta-compiler.test.tsx |
| S2-15 | M | Editing rules: only DRAFT is editable; editing a published/active template creates a new version; one draft… | Pass — meta-compiler-blueprint.test.ts, meta-compiler.test.tsx |
| S2-16 | M | Autosave or explicit save with conflict detection. | Pass — meta-compiler-blueprint.test.ts, meta-compiler.test.tsx |
| S2-17 | M | **Generate →** opens Screen 3 for this template version. | Pass — meta-compiler-generation.test.ts, meta-compiler.test.tsx |
| S2-18 | M | **"0. Catalog & Staffing" panel** (D11b = A) at the top of the stage navigator holds today's fields not in… | Pass — blueprint.test.ts, meta-compiler.test.tsx |
| S3-01 | M | Select a pre-configured code-generation model. PDF names Gemini and Claude; mockup adds OpenAI. Per D6 = A2… | Pass — meta-compiler-generation.test.ts, pipeline.test.tsx |
| S3-02 | M | Credentials are server-side only. The UI may show provider, a masked key suffix, connection ID and credenti… | Pass — meta-compiler-generation.test.ts, pipeline.test.tsx |
| S3-03 | M | **Step 1 Generate the UI**: synthesise the SME studio front end and the backend (persistence + MCP simulato… | Pass — meta-compiler-generation.test.ts, meta-compiler-schema.test.ts, pipeline.test.tsx |
| S3-04 | M | **Step 2 Test the UI & Verify Harbor**: inject a synthetic payload through the generated studio, build a te… | Pass — catalog-blueprints.test.ts, meta-compiler-verification.test.ts, pipeline.test.tsx |
| S3-05 | M | **Step 3 Ready to Deploy**: once both gates pass, Admin selects Project and SME and deploys the studio at a… | Pass — meta-compiler-deployments.test.ts, meta-compiler-verification.test.ts, pipeline.test.tsx |
| S3-06 | M | Project selector lists only projects the Admin's client owns that use this template (lineage/version rule p… | Pass — meta-compiler-deployments.test.ts, pipeline.test.tsx |
| S3-07 | S | Copy SME URL; "Open Deployed SME Studio" link. | Pass — meta-compiler-deployments.test.ts |
| S3-08 | S | Live logs panel (compiler, verifier, runtime) and generated-code preview. | Pass — meta-compiler-generation.test.ts, meta-compiler-verification.test.ts, pipeline.test.tsx |
| S3-09 | M | Re-generation and rollback: a newer generation does not replace a running studio until it passes Step 2 and… | Pass — meta-compiler-deployments.test.ts, meta-compiler-directory.test.ts, meta-compiler-schema.test.ts, pipeline.test.tsx |
| S3-10 | M | Stop a studio (owner agreed, D12; Phase C). | Built 10 Nov, awaiting independent QA. `S3-10 an Admin stops a studio…` (API: Admin only, 404 across clients, 410 "studio closed" for its SME, other SMEs still 404, authored tasks kept, audited once, idempotent, redeploy reopens the same URL); `S3-10: each active studio has a Stop button…` (web). "Uses no compute" holds for the shared runtime, which has no per-studio compute; the isolated runtime's `stop` is not built |
| S3-11 | S | Optional per-template code generation (D5 = C): when the server-side switch is on, Step 1 offers "Generate… | Pass — meta-compiler-generation.test.ts |
| S4-01 | M | Studio header shows status (running), preserved URL, project and SME identity. | Pass — meta-compiler-studio.test.ts, studio.test.tsx |
| S4-02 | M | Access control: only the assigned SME (and Admins, read-only per D4) can open the studio. | Pass — meta-compiler-studio.test.ts, studio.test.tsx |
| S4-03 | M | **6-step authoring sidebar**: Scenario Setup, Data & Oracle Labelling, Simulator Curve Tuning, Guardrail Th… | Pass — blueprint-studio.test.ts, studio.test.tsx |
| S4-04 | M | Scenario fields: task title / scenario name, target TPT / horizon, plus domain fields from the template (e.… | Pass — blueprint-studio.test.ts, studio.test.tsx |
| S4-05 | M | **Mounted custom template controls** from the Meta-Compiler render with their type, options and defaults. | Pass — blueprint-studio.test.ts, studio.test.tsx |
| S4-06 | M | **Interactive Ground-Truth Oracle Table Annotator**: grid pre-loaded from Stage 2 preview rows; SME selects… | Pass — blueprint-studio.test.ts, studio.test.tsx |
| S4-07 | M | **Diminishing Returns Curve sliders with live plot**: sliders set simulator parameters; plot shows CTR(s) =… | Pass — blueprint-studio.test.ts, studio.test.tsx |
| S4-08 | M | Live JSON preview and download of the selected task. | Pass — meta-compiler-studio.test.ts, studio.test.tsx |
| S4-09 | S | DB metadata panel: database, task ID, configuration status, repository path, with copy. | Pass — studio.test.tsx |
| S4-10 | M | **Save & Commit** writes the task atomically to PostgreSQL, JSON and a Harbor `.tar.gz` bundle. | Pass — meta-compiler-studio.test.ts, studio.test.tsx |
| S4-11 | M | Task store table: Task ID, Template/Workflow (version), Project, Authored by, Title, DB & Harbor status, In… | Pass — meta-compiler-store.test.ts, task-store.test.tsx |
| S4-12 | S | Export full store as JSON. | Pass — meta-compiler-store.test.ts, task-store.test.tsx |
| S4-13 | M | SME work after commit follows Praxis review: committed tasks enter the existing independent human review be… | Pass — meta-compiler-studio.test.ts, studio.test.tsx |
| S4-14 | M | Simple testing workflow (D4a = A): a non-production, idempotent, audited setup creates a synthetic deployed… | Pass — meta-compiler-journey.spec.ts, meta-compiler-test-setup.test.ts |
| D-01 | - | Blueprint top-level keys: `studio_id`, `template_meta` (template_id, registry source, label, domain categor… | Pass — blueprint.test.ts |
| D-02 | - | Blueprint is versioned with the template and immutable once a version is Active / used by a project. | Pass — meta-compiler-blueprint.test.ts |
| D-03 | - | Blueprint has a JSON Schema with server-side validation; the same validator runs in the browser for instant… | Pass — blueprint.test.ts, meta-compiler-blueprint.test.ts |
| D-10 | - | Store every listed attribute for each authored task. | Pass — meta-compiler-studio.test.ts |
| D-11 | - | Every row is client-scoped and linked by foreign key to the Praxis template version, project, SME user and… | Pass — meta-compiler-studio.test.ts |
| D-12 | - | The zero-baseline = 0.00 and oracle = 1.00 results must be **measured**, stored with evidence (run ID, logs… | Pass — meta-compiler-deployments.test.ts, meta-compiler-judge.test.ts, meta-compiler-store.test.ts, meta-compiler-test-setup.test.ts, meta-compiler-verification.test.ts |
| D-14 | - | Every authored task and bundle stores `data_classification` (`synthetic` or `real_public`), set from the re… | Pass — meta-compiler-schema.test.ts, meta-compiler-studio.test.ts |
| D-13 | - | Storage (D8 = A): new client-scoped table `sme_authored_tasks` linked to the existing `TaskInstance` → `Tas… | Pass — meta-compiler-studio.test.ts |
| D-20 | - | Bundle layout exactly as above; deterministic build (same inputs → same SHA-256), hash stored with the task. | Pass — harbor-bundle.test.ts |
| D-21 | - | Hidden paths (`/eval/*`, `/solution/*`) are never exposed to the agent workspace or to the SME's agent-faci… | Pass — harbor-bundle.test.ts, meta-compiler-blueprint.test.ts, meta-compiler-studio.test.ts |
| D-22 | - | Bundles live in the existing evidence/object storage (GCS in deployed environments, fake-GCS locally), not… | Pass — meta-compiler-sweep.test.ts |
| D-23 | - | The PDF lists Harbor v0.25+ / ATIF v1.2 as the runtime target; exact Harbor schema versions are confirmed i… | Open — Harbor schema version confirmed in architecture |
| NFR-01 | - | **Hermetic execution**: generated studios' agent sandboxes and all verifier runs use an internal-only netwo… | Pass — blueprint.test.ts |
| NFR-02 | - | **Untrusted generated code**: LLM-generated code never runs inside the Praxis API/worker process or with Pr… | Partly — FULL_CODE gated off (meta-compiler-config, meta-compiler-generation); isolated runtime is Phase C |
| NFR-03 | - | **Human decisions**: AI output never approves a template, a task or a deployment; an Admin action deploys,… | Pass — meta-compiler-generation.test.ts |
| NFR-04 | - | **Secrets**: provider keys in Secret Manager (deployed) or `.env` (local), never in the DB, UISpec, logs, b… | Review — keys server-side only (meta-compiler-generation "no keys"); repo scan found no keys |
| NFR-05 | - | **Privacy and synthetic data**: no real customer or employer data in templates, payloads or bundles; SME em… | Review — seeded content synthetic; real-data switch off by default (NFR-05a) |
| NFR-05a | - | **Real-data switch (D5a)**: a server-side switch, off by default in every environment, that allows tasks to… | Pass — meta-compiler-studio.test.ts |
| NFR-06 | - | **Audit and idempotency**: create, edit, save variant, generate, verify, deploy, undeploy, commit task and… | Pass — 10 audit/idempotency tests across meta-compiler-{assistant,blueprint,deployments,store,studio,test-setup} |
| NFR-07 | - | **Tenancy and RBAC**: every query is client-scoped; Screens 1–3 Admin-only; Screen 4 assigned SME (+ Admin… | Pass — meta-compiler.test.tsx |
| NFR-08 | - | **Tests never call live providers**: LLM, container runtime and Harbor runner are behind interfaces with de… | Pass — 15 mock/fake-client tests (meta-compiler-{config,drafter,generation,judge,store,verification}) |
| NFR-08a | - | **Live-call environments (D6b)**: live Claude/Gemini calls only when `APP_ENV` is `staging` or `production`… | Pass — meta-compiler-config.test.ts |
| NFR-09 | - | **Cost controls**: per-generation token cap, per-client daily generation budget, and limits on concurrent r… | Pass — meta-compiler-assistant.test.ts, meta-compiler-config.test.ts, meta-compiler-drafter.test.ts |
| NFR-10 | - | **Accessibility**: WCAG 2.1 AA on all four screens (keyboard navigation of stage nav, grid annotator and sl… | Pass — a11y.test.tsx, a11y.ts, studio.test.tsx |
| NFR-11 | - | **Branding**: screens use ADI Praxis branding and tokens (`packages/shared/theme`), not the mockup's "HARBO… | Review — no "HARBOR / Enterprise RL" brand strings in web or candidate apps |
| NFR-12 | - | **Performance**: directory loads < 2 s for 500 templates; inspector updates < 1 s; task commit < 5 s exclud… | Pass — see Q4 |
| NFR-13 | - | **Observability**: generation, verification and deployment jobs expose status, duration, cost and failure r… | Pass — meta-compiler-generation.test.ts |
