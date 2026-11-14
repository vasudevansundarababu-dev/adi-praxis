# PRD: Replace Templates with the Harbor Template Directory and Meta-Compiler

| Item | Value |
| --- | --- |
| Status | **Approved by the owner on 7 Nov 2026 (Gate 1: PRD).** All decisions D1–D16 answered by the owner on 7 Nov 2026. Next: architecture (Gate 2). |
| Owner | Product owner (vasudevansundarababu-dev) |
| Prepared by | OpenHands agent (PRD role), Praxis enhancement workflow |
| Date | 7 November 2026 |
| Code baseline | `main` at `65ada8f` (PR #7 CI fix merged as `7119228`, then PR #6 merging `codex/praxis-tester-fixes` incl. `codex/praxis-anvil-harbor`). |
| Source 1 | Owner PRD `PRD-HARBOR-ENT-v2.0`, "Harbor Enterprise RL Task Authoring & Meta-Compiler", 11 pages, PDF dated 7 Nov 2026 (kept by the owner; not committed) |
| Source 2 | Owner mockup, Google Sites `adi-labs.ai/praxis/full-page-embed`, captured 7 Nov 2026 (4 screens, prototype only: all actions are simulated with timers, no network calls) |
| Scope decided by owner | "The templates section needs to be replaced with this new UI." |

Requirement IDs below cite their source as **[PDF §n]**, **[Mock Sn]** (mockup screen n) or **[Code]** (current Praxis behaviour that must be kept or consciously changed). Nothing here is invented beyond the two sources; where the sources are silent or conflict with Praxis rules, the item is raised as a decision (section 8) rather than assumed.

---

## 1. Summary

Today, `Templates` in the Praxis console is a two-level Domain → Workflow catalog with a plain table, a form editor for drafts, versioning, publish and retire. The owner wants it replaced by a four-screen flow:

1. **Templates & Active SME Applications Directory**: workflows grouped by domain, with status, TPT, modes, project, assigned SME and the SME's authoring URL.
2. **Tier-1 Admin Meta-Compiler**: a 3-panel editor for a 5-stage template blueprint, custom schema fields with explicit Harbor bindings, and live `UISpec.json`, Meta-Prompt and Pytest previews.
3. **Generate, Test & Deploy**: generate the SME authoring UI and backend, verify a test Harbor bundle (zero-baseline 0.00, oracle 1.00), bind a project and SME, and deploy a dedicated isolated SME studio at a preserved URL.
4. **Deployed SME Studio & Task Store**: the SME authors tasks against the template's controls; each task is stored in PostgreSQL, as JSON and as a Harbor `.tar.gz` bundle, with inspect, download and export.

The core mandate [PDF §1] is that every SME-authored task is hermetic (`--network=internal`), graded by deterministic programmatic verifiers (`/eval/test_verifiers.py`) and persisted to the database, as JSON and as a ready-to-run Harbor archive.

## 2. Goals and non-goals

**Goals**

- G1. Replace the console `Templates` section (`/templates`, `/templates/new`, `/templates/[id]`) with Screens 1–2, and add Screens 3–4 as the continuation of the same journey.
- G2. Let an Admin turn a domain workflow into a structured, versioned **Harbor template blueprint** (5 stages + custom fields) without writing Dockerfiles, MCP mocks or pytest by hand [PDF §1].
- G3. Let an assigned SME author benchmark tasks through domain controls generated from that blueprint [PDF §6].
- G4. Produce, for each authored task, a deterministic Harbor bundle with verifiers whose zero-baseline and oracle results are proven before the studio is released to an SME [PDF §5.1, §7].
- G5. Keep every existing Praxis guarantee: versioning and project pinning, RBAC, audit, idempotency, human review and the append-only Approved Task Dataset [Code, CLAUDE.md].

**Non-goals (unless the owner decides otherwise in section 8)**

- N1. Changing the frozen Praxis → Anvil contracts (`contracts/praxis/task.schema.json`, `task-v2.schema.json`) or `docs/integrations/PRAXIS-ANVIL.md`.
- N2. Running Anvil evaluations, model training or RL runs from Praxis.
- N3. Any live paid model or provider call from tests or CI.
- N4. Replacing the candidate sign-in, identity, onboarding, staffing or payments flows.

## 3. Users and roles

| PRD actor | Praxis role today [Code: `InternalRole` ADMIN, PM, REVIEWER, FINANCE] | Screens |
| --- | --- | --- |
| Platform Admin / Program Lead [PDF §2] | `ADMIN` | 1, 2 |
| Benchmark Architect (Admin) [PDF §2] | `ADMIN` (no separate role exists) | 2, 3 |
| Benchmark Architect / DevOps [PDF §2] | `ADMIN` (D9 = A: no new role) | 3 |
| Assigned Domain SME (Marketer, Compliance Officer) [PDF §2] | SME / candidate (`SmeUser`, assigned through `SmeAssignment` / `ProjectAssignment`) | 4 |
| Program / Project Manager | `PM`: sees published templates on `/templates` and builds projects from them [Code] | Read-only Screen 1 + blueprint summary (D10 = A) |
| Validator (Reviewer) | `REVIEWER`: independent human review of submitted tasks [Code] | Existing review queue for studio tasks (D4 = A) |

## 4. Current state (code-backed)

| Area | Today | Evidence |
| --- | --- | --- |
| Directory | Server page lists domains, each with a table: Workflow, Version, Status, TPT, Modes. Admin sees every workflow's latest version; PM sees published only. "New template" button; add-domain form. | `apps/web/app/(console)/templates/page.tsx` (82 lines) |
| Detail / editor | Draft → form editor; otherwise read-only view; actions: publish, new version, retire; version history sidebar. | `templates/[id]/page.tsx`, `components/templates/template-editor.tsx` (327), `template-actions.tsx`, `template-view.tsx` |
| Data model | `Template`: `lineageId` + integer `version` (unique), `workflowName`, `primaryWork`, `verificationCriteria`, `humanGate`, opaque `taskDefinitionSchema` / `collectionSchema` JSON, `defaultTptMinutes` (int), `defaultJdId`, `skills[]`, `status` (DRAFT, PUBLISHED, RETIRED), `taskModes[]` (AUTHORING, ANNOTATION), coverage dimensions, edge-case catalog, diversity defaults. `Domain`: name + status. | `apps/api/prisma/schema.prisma` |
| Rules | Only drafts are editable; editing a published template means creating a new version; one draft per workflow (advisory lock); publish requires workflow name, primary work, verification criteria, human gate, TPT, ≥1 skill, ≥1 mode; retire retires all published versions; every command is audited and idempotent. | `apps/api/src/routes/templates.ts`, `packages/shared/src/templates.ts` (`publishProblems`) |
| Projects | A project pins `templateId` + `templateVersion`; only the newest PUBLISHED version in an ACTIVE domain is offerable. | `apps/api/src/routes/projects.ts` |
| Task definition | Named interface `validateTaskInput` / `validateSubmission`; v1 stub passes everything until a task-definition spec exists. | `apps/api/src/templates/task-definition.ts`, SPEC "Admin: template catalog" |
| SME authoring | Candidate app workbench chooses a component per task: KYC workbench (`kyc-onboarding-v1`), annotation, or generic authoring with the optional Praxis executable contract editor. Saves are autosaved; submit → independent human review (author or declared conflict cannot review) → append-only `ApprovedTaskRecord`. | `apps/candidate/components/work/task-page.tsx`, `apps/api/src/tasks/review-service.ts` |
| AI | Claude on Vertex AI for profile assistant, drafting, certification, support; embeddings on Vertex. Blank `VERTEX_PROJECT_ID` = local mocks. No Gemini or OpenAI integration. | `apps/api/src/config.ts` |
| Harbor / Anvil | Praxis exports approved tasks as `praxis.anvil.task.v1/v2` (+ optional `praxis.anvil.export.v1` envelope). "Anvil owns Harbor packaging, isolated execution, cancellation, trajectory/reward inspection and run accounting." | `docs/releases/RELEASE-1.2-PRAXIS-HARBOR.md`, `docs/integrations/PRAXIS-ANVIL.md` |
| Seed catalog | Imported from `docs/Taskflow.xlsx`: Banking 24 workflows, Healthcare, Marketing, Research Assistant. | SPEC "Admin: template catalog", `apps/api/src/templates/taskflow-import.ts` |
| Tests touching templates | API: `templates.test.ts` and 12 other suites create/publish templates; e2e: `smoke.spec.ts` (Templates heading), `m10.spec.ts`, `tester-profile-form.spec.ts`. | `apps/api/test/`, `e2e/` |
| Navigation | `Templates` → `/templates` for `ADMIN` and `PM`. | `apps/web/lib/nav.ts` |

## 5. Functional requirements

Priority: **M** = must, **S** = should, **C** = could. Delivery phase for every requirement is in section 10b (D12). If the 16 Nov date is at risk, S and C items are the first candidates to move after it, with owner approval at the plan gate. Each requirement lists its acceptance criteria (AC) in testable form.

### 5.1 Screen 1: Templates & Active SME Applications Directory (replaces `/templates`)

| ID | Requirement | Source | Pri | Acceptance criteria |
| --- | --- | --- | --- | --- |
| S1-01 | Workflows are grouped under domain headers with a count (e.g. Digital Marketing 3, Banking 10). | PDF §3.1; Mock S1 | M | Each active domain renders a header and count equal to its workflow rows; empty domain shows "No workflows yet" to Admin and is hidden from non-Admin (keeps today's behaviour [Code]). |
| S1-02 | Domain filter pills: All plus one per domain. | Mock S1 | S | Selecting a pill shows only that domain's section; "All" restores every section; choice survives refresh (URL query). |
| S1-03 | Summary cards: Total Templates, Active SME Studios, Attached Projects & SMEs, Authored Tasks. | Mock S1 | S | Each number equals a server count for the actor's client; zero renders `0`, never a placeholder. |
| S1-04 | Columns: Workflow (link), Version, Status, TPT, Modes, Project & Assigned SME, SME studio URL & actions. | PDF §3.1; Mock S1 | M | Every row renders all columns; missing values render `—` / "Unassigned". |
| S1-05 | Workflow name opens Screen 2 pre-loaded with that template. | PDF §3.1 | M | Click navigates to the Meta-Compiler for that template ID; browser Back returns to the directory with the filter preserved. |
| S1-06 | Version shows the latest version label (`v1`, `v2`). | PDF §3.1 | M | Shows the newest version for Admin; PM rule per D10. Versions remain integers in storage, displayed `v{n}` (D3 = A1). |
| S1-07 | Status badge: **Active** (emerald) when a verified studio is deployed; **Draft** (slate) before. | PDF §3.1 | M | Badge derives from server state, never from client state. Per D2 = A: template keeps DRAFT / PUBLISHED / RETIRED; each deployment (template version + project + SME) has its own status Generating / Verified / Active / Stopped / Failed. Badge shows Active if any deployment of the shown version is Active, else the template status (Draft, Published, Retired). |
| S1-08 | TPT shows expected duration and horizon, e.g. `45m (12 Wks)`, `35m (15 Steps)`. | PDF §3.1 | M | Renders minutes + horizon count + cadence unit from the blueprint (Stage 1 max turns + cadence label). |
| S1-09 | Modes shows the sandbox protocol: Hermetic MCP, Hermetic Graph, Hermetic SQL. | PDF §3.1; Mock S1 | M | Value comes from a new blueprint field `execution_mode`; existing task modes (AUTHORING / ANNOTATION) are kept for staffing and review (D2). |
| S1-10 | Project & Assigned SME shows bound project ID and SME email once deployed. | PDF §3.1 | M | Shows only for an Active deployment; SME email visible to Admin only (privacy, see NFR-05). |
| S1-11 | Preserved studio URL with SME UI (open) action and Edit Template → action. | PDF §3.1; Mock S1 | M | "SME UI" opens the studio URL in a new tab; shown only when a deployment exists. |
| S1-12 | **Removed (owner, D11c = B):** no "New template" button. New templates come only from the seed or from Save Variant (S2-12). | Owner D11c (overrides PDF §3.1 / Mock S1) | M | Screen 1 shows no New template control; the create-template API is not reachable from the UI; seed and Save Variant remain the only ways to add a workflow. |
| S1-13 | **Removed (owner, D11):** no Add domain button or form in the UI. Domains and templates are pre-seeded. | Owner D11, D15 | M | Screen 1 shows no Add domain control; domains and workflows come only from the idempotent seed: the mockup catalog (Digital Marketing 3, Banking 10) plus the owner's new template (D15). |
| S1-14 | Header shows the active workflow + version and a "Tasks DB & JSON" shortcut to Screen 4's store. | Mock (header) | C | Shortcut visible to Admin only. |
| S1-15 | PM view (D10 = A): read-only directory of the newest published version per workflow; workflow opens a read-only blueprint summary with Create project. | Owner D10; Code | M | PM never sees drafts, retired-only workflows, SME emails, studio URLs, New template, Meta-Compiler or Screen 3 (UI hidden and API returns 403/404); Create project pre-selects the template and follows today's FLOW 1 rules. |
| S1-16 | Retire the old catalog (D15a = C): every workflow and domain not in the mockup catalog is retired; the overlapping Banking workflows are reused (name match, en dash = hyphen); `Digital Marketing` added. | Owner D15a | M | Runs idempotently with the seed/migration and is audited; retired items disappear from Screen 1 and from new projects; projects already using them keep working; nothing is deleted; works for DRAFT rows too (today retire only accepts PUBLISHED). |
| S1-17 | Seeded blueprints and publish fields (D15): full, valid (6/6), synthetic blueprints for Launch of Noise Cancelling Phone, KYB and beneficial ownership, AML transaction-monitoring alerts; the other 10 mockup workflows are published from the owner's publish fields (primary work, verification criteria, human gate, skills, task modes, default TPT). | Owner D15, D15a | M | Each blueprint passes server validation and the Screen 3 zero-baseline 0.00 / oracle 1.00 checks; content is synthetic; **every seeded workflow is published** (owner, 10 Nov 2026; replaces "others seeded as Draft"); `Control testing` and `Country-specific interpretation` are removed from the mockup catalog (owner, 10 Nov 2026), so Banking is 10. |

### 5.2 Screen 2: Tier-1 Admin Meta-Compiler (replaces `/templates/[id]` editor)

Layout [PDF §4, Mock S2]: left 5-stage navigator with per-stage validity; centre stage editor; right inspector (UISpec.json, Meta-Prompt, Pytest & Widget Map) with Copy; top bar with template switcher, Save Variant, reset, + Add Custom Field, Export UISpec.json, **Generate →**; bottom Guided Elicitation Assistant.

| ID | Requirement | Source | Pri | Acceptance criteria |
| --- | --- | --- | --- | --- |
| S2-01 | Load the selected template's blueprint (the PDF's `domain_templates.json` record) into the editor. | PDF §4 | M | Opening from S1 shows that template; switcher lists the client's templates as `Domain // Workflow (vN)`. Blueprint is read from the database (D1 = A). |
| S2-02 | **Stage 1 Domain, Persona & Horizon** (`domain_meta`, `harbor_contract`): Studio Blueprint ID, Display Title, SME Role persona, Execution Topology (`episodic_loop`, `single_pass`, `milestone_graph`), Max Horizon Turns, Cadence Unit label, Harbor flags (ATIF v1.2, `--network=internal`, `solution/solve.sh`, Zero-Baseline Gate). | PDF §4.1; Mock S2 | M | All fields editable while DRAFT; Blueprint ID unique per client; Max turns integer ≥ 1; topology from the enum; `--network=internal` cannot be switched off (PDF mandate, NFR-01). |
| S2-03 | **Stage 2 Data & Oracle Bifurcation** (`step_2_data_panels`): public dropzones (id, label, target path under `/workspace/inputs/`, format) and the hidden Oracle Table Annotator schema (`columns[]`, `sme_tag_options[]`, `template_preview_rows[]`, dataset name). | PDF §4.1; Mock S2 | M | Paths must stay under `/workspace/inputs/` (public) and `/eval/ground_truth/` (hidden); validation rejects `..` and absolute paths elsewhere. |
| S2-04 | **Stage 3 Mock Env & MCP Simulators** (`step_3_mcp_simulators`): MCP tool IDs and parameters, SME widget archetype (`diminishing_returns_curve_slider`, `fuzzy_match_threshold_slider`), slider key/default/min/max. | PDF §4.1; Mock S2 | M | min ≤ default ≤ max enforced; tool IDs unique in the template. |
| S2-05 | **Stage 4 Guardrails & Invariants** (`step_4_invariant_catalog`): allowed subjects, operators (`GREATER_THAN`, `EQUALS`, `CONTAINS_ANY`), penalty (Hard Fail −1.0), default IF/THEN rules. | PDF §4.1; Mock S2 | M | Rule = subject + operator + threshold + penalty; subject must be in the allowed list. |
| S2-06 | **Stage 5 Rubric Topology & Weights** (`step_5_default_rubric`): ordered milestones, coupled % sliders locked to 100%, each mapped to a verifier template (`f1_set_match`, `regex_schema`, `lp_solver_ceiling`, `exact_graph_path`). | PDF §4.1; Mock S2 | M | Save/Generate is blocked unless weights sum to exactly 100; "auto-normalise" helper (Mock) rebalances to 100. |
| S2-07 | Per-stage validity badges and an overall validity counter ("n/6 Valid": panel 0 Catalog & Staffing + 5 stages, D11b). | Mock S2; D11b | M | Counter equals the number of sections passing server validation; Generate disabled below 6/6. A template defined by Anvil (`anvilSpec` set) shows "Defined by Anvil" instead of the counter and badges (DECISIONS.md, 13 Nov 2026). |
| S2-08 | **Custom fields by stage** (`custom_fields_by_stage`): `field_id`, label, `input_type` (`number_input`, `currency_slider`, `single_select`, `multi_select`, `boolean_toggle`, `text_input`), `options[]`, `default_value`, mandatory `inject_into[]` (`instruction.md`, `task.json`, `mcp_mock.py`, `eval/test_verifiers.py`) and verifier binding. | PDF §4.2; Mock S2 | M | `field_id` auto-slugged and unique per template; at least one `inject_into` target required; select types need ≥1 option; default must match type; edit and delete supported. |
| S2-09 | A field bound to `eval/test_verifiers.py` produces a deterministic `def test_custom_<field_id>(env_state):` assertion visible in the Pytest inspector. | PDF §4.2 | M | Inspector shows the generated function for each verifier-bound field; generation is deterministic (same blueprint → byte-identical output). |
| S2-10 | Live inspector tabs: UISpec.json, Meta-Prompt, Pytest & Widget Map, each with Copy; footer counters (Dropzones, MCP, Custom Fields). | PDF §4; Mock S2 | M | Inspector updates within 1 s of an edit and always reflects the saved or pending blueprint; Copy copies exactly the shown text. |
| S2-11 | Export UISpec.json download. | Mock S2 | S | Downloads the current blueprint JSON; export is audited. |
| S2-12 | Save Variant: register the customised blueprint under a new label for reuse in the switcher. | Mock S2 | S | Creates a new workflow (new lineage, DRAFT v1) in the same domain named by the label, with a stored "variant of" link to the source template version; label must be unique in the domain; original unchanged; audited (D3 = B1). |
| S2-13 | Reset to factory template. | Mock S2 | C | Confirms before discarding unsaved changes; only for DRAFT. |
| S2-14 | Guided Elicitation Assistant: one-click domain presets (e.g. Creative Fatigue slider, Target CAC ceiling $42, UBO hop depth, Holiday CPM multiplier) and a free-text "Apply to Template" box. | Mock S2 | S | Presets insert a pre-defined custom field into the active stage. Presets come from a per-domain, Admin-editable list. Free text (D7 = A): AI proposes a full field; Admin must Accept / Edit / Discard; the proposal is validated like a manual field (S2-08); accepted proposals are audited with the prompt, model and proposal; if AI is off or over the cap, the box explains why and the Admin can still add the field manually. |
| S2-15 | Editing rules: only DRAFT is editable; editing a published/active template creates a new version; one draft per workflow. | Code (SPEC rules) | M | Same 409 behaviours as today (`TEMPLATE_NOT_EDITABLE`, `DRAFT_EXISTS`); existing projects keep their pinned version. |
| S2-16 | Autosave or explicit save with conflict detection. | Code (pattern) | M | Concurrent edits by two Admins never silently overwrite: second save gets a conflict with the newer revision. |
| S2-17 | **Generate →** opens Screen 3 for this template version. | PDF §4; Mock S2 | M | Enabled only when 6/6 valid and saved. |
| S2-18 | **"0. Catalog & Staffing" panel** (D11b = A) at the top of the stage navigator holds today's fields not in the mockup: primary work, verification criteria, human gate, skills, default JD, task modes, coverage dimensions, edge-case catalog, diversity defaults. | Owner D11b; Code | M | Pre-filled by the seed; editable while DRAFT; counts toward validity (publish still requires today's `publishProblems` fields); navigator shows "n/6 Valid" including this panel. |

### 5.3 Screen 3: Generate, Test & Deploy

Layout [PDF §5, Mock S3]: header with status; model/credential panel; project + SME + preserved URL panel; 3-step pipeline buttons with progress bars; 5 verification check cards; compiler/verifier/runtime log; generated code preview; deployment result card.

| ID | Requirement | Source | Pri | Acceptance criteria |
| --- | --- | --- | --- | --- |
| S3-01 | Select a pre-configured code-generation model. PDF names Gemini and Claude; mockup adds OpenAI. Per D6 = A2, Claude and Gemini models on Vertex AI are offered. Each shows "processing_terms.reviewed: true". | PDF §5.1(1); Mock S3; D6 | M | List shows only the Claude and Gemini models configured on the server; a model whose processing terms are not reviewed cannot be selected; no OpenAI option appears; both providers go through the same generator interface, cost cap and mocks. |
| S3-02 | Credentials are server-side only. The UI may show provider, a masked key suffix, connection ID and credential version, never a key. | PDF §5.1(1); Mock S3 | M | No API key value is ever returned by an API, rendered, logged or stored in the browser; keys come from Secret Manager / env (see NFR-04). |
| S3-03 | **Step 1 Generate the UI**: synthesise the SME studio front end and the backend (persistence + MCP simulator) from the validated UISpec, showing UI and backend compilation progress to 100%. | PDF §5.1(1); Mock S3 | M | Runs as an async job with progress, logs and a stored, versioned output tied to (template version, model, prompt hash). Re-running with the same inputs is idempotent. Per D5 = C: default mode builds the shared studio configuration from the UISpec (LLM drafts content only); optional per-template code mode (D5 a) appears only when the server-side switch is on, shows the estimated cost before running and stops at the cost cap. |
| S3-04 | **Step 2 Test the UI & Verify Harbor**: inject a synthetic payload through the generated studio, build a test bundle (`task.json`, `instruction.md`, `/eval/test_verifiers.py`, `solution/solve.sh`) and run the 5 checks: (01) SME UI component mount, (02) DB + JSON sync, (03) Harbor archive tarball, (04) **Zero-Baseline**: null agent scores **0.00**, (05) **Oracle**: `solve.sh` scores **1.00**. | PDF §5.1(2); Mock S3 | M | Each check stores pass/fail, measured value and logs. Step 2 cannot start before Step 1 succeeds. Any failure blocks Step 3 and shows the reason. Payload is synthetic only (CLAUDE.md). |
| S3-05 | **Step 3 Ready to Deploy**: once both gates pass, Admin selects Project and SME and deploys the studio at a preserved URL (Phase B: blueprint-driven studio in the candidate app, isolated per deployment by access control and data scope; Phase C: separate isolated runtime); workflow status changes Draft → Active on Screen 1. | PDF §5.1(3); Mock S3 | M | Button disabled until checks 04 and 05 pass and both selections are made. Deployment is audited and idempotent; the URL is a candidate-app path `/studio/<studio-id>` (D14 = A) and stays stable across redeploys of the same template version + project + SME. |
| S3-06 | Project selector lists only projects the Admin's client owns that use this template (lineage/version rule per D10). SME selector lists only SMEs assigned to that project. | Code (RBAC, assignments) | M | Cross-client projects/SMEs never appear; selecting an SME not assigned to the project is rejected server-side. |
| S3-07 | Copy SME URL; "Open Deployed SME Studio" link. | Mock S3 | S | Copies the exact URL; opens Screen 4. |
| S3-08 | Live logs panel (compiler, verifier, runtime) and generated-code preview. | Mock S3 | S | Logs stream or poll at ≤ 2 s; secrets and personal data are redacted. |
| S3-09 | Re-generation and rollback: a newer generation does not replace a running studio until it passes Step 2 and is deployed. | Inferred from PDF gate order | M | Previous deployment stays live and selectable until the new one is Active. |
| S3-10 | Stop a studio (owner agreed, D12; Phase C). | Owner D12 | M | Admin can stop a studio; it then uses no compute; its URL returns a clear "studio closed" page; authored tasks and bundles remain; stop is audited and idempotent. |
| S3-11 | Optional per-template code generation (D5 = C): when the server-side switch is on, Step 1 offers "Generate full studio code" for the YC demo. | Owner D5 | S | Switch off by default in every environment; Admin sees estimated tokens/cost before running; run stops at the owner's cost cap; generated code is stored, versioned and runs only in the isolated runtime (NFR-02); Steps 2–3 gates apply unchanged. |

### 5.4 Screen 4: Deployed SME Studio & Task Store

| ID | Requirement | Source | Pri | Acceptance criteria |
| --- | --- | --- | --- | --- |
| S4-01 | Studio header shows status (running), preserved URL, project and SME identity. | PDF §6.1; Mock S4 | M | Values match the deployment record. |
| S4-02 | Access control: only the assigned SME (and Admins, read-only per D4) can open the studio. | Code (assignment model) | M | Unauthenticated or unassigned users get 401/403 and no task data. Sign-in reuses the existing SME sign-in, not a new account system. |
| S4-03 | **6-step authoring sidebar**: Scenario Setup, Data & Oracle Labelling, Simulator Curve Tuning, Guardrail Thresholds, Rubric Weighting, Final Confirmation. | PDF §6.1 | M | SME can move between steps; incomplete steps are marked; confirmation lists any blocking problems. (Mockup shows a single form; the PDF's 6-step layout is the target.) |
| S4-04 | Scenario fields: task title / scenario name, target TPT / horizon, plus domain fields from the template (e.g. budget cap, target CAC, locales) and business instructions / brand guidelines. | Mock S4 | M | Fields and validation come from the blueprint, not hard-coded per domain. |
| S4-05 | **Mounted custom template controls** from the Meta-Compiler render with their type, options and defaults. | Mock S4; PDF §4.2 | M | Every custom field of the deployed template version appears exactly once with its default. |
| S4-06 | **Interactive Ground-Truth Oracle Table Annotator**: grid pre-loaded from Stage 2 preview rows; SME selects, highlights and tags rows with the template's tag options; results populate `/eval/ground_truth/`. | PDF §6.1 | M | Tags limited to `sme_tag_options`; annotated rows are hidden from the agent workspace in the bundle (check by path). |
| S4-07 | **Diminishing Returns Curve sliders with live plot**: sliders set simulator parameters; plot shows CTR(s) = CTR_base × s / (s + K_half). | PDF §6.1 | M | Plot updates on slider change; values stay within template min/max; values are written to `mcp_mock.py` parameters. Fuzzy-match threshold archetype also supported (PDF §4.1). |
| S4-08 | Live JSON preview and download of the selected task. | PDF §6.1; Mock S4 | M | Preview equals the stored JSON byte-for-byte after save. |
| S4-09 | DB metadata panel: database, task ID, configuration status, repository path, with copy. | PDF §6.1 | S | Shows no secrets or connection strings. |
| S4-10 | **Save & Commit** writes the task atomically to PostgreSQL, JSON and a Harbor `.tar.gz` bundle. | PDF §7; Mock S4 | M | All three succeed or none is visible (no partial task); repeat clicks with the same idempotency key do not duplicate. |
| S4-11 | Task store table: Task ID, Template/Workflow (version), Project, Authored by, Title, DB & Harbor status, Inspect JSON, download bundle. | Mock S4 | M | Admin sees all tasks for the client; SME sees only their own (D4). |
| S4-12 | Export full store as JSON. | Mock S4 | S | Admin only; audited; respects client scope. Large exports stream. |
| S4-13 | SME work after commit follows Praxis review: committed tasks enter the existing independent human review before they can reach the Approved Task Dataset. | Code / CLAUDE.md; D4 = A | M | Committed task shows "Submitted for review"; only Reviewer-approved tasks reach the Approved Task Dataset and exports; returned tasks go back to the SME. |
| S4-14 | Simple testing workflow (D4a = A): a non-production, idempotent, audited setup creates a synthetic deployed example template, project, test SME and separate test Reviewer. | Owner D4a | M | One command/button creates or reuses the setup; a tester completes commit → review → approve end to end; refused in production; no real data; review rules unchanged. |

## 6. Data and artifact requirements

### 6.1 Template blueprint (UISpec)

| ID | Requirement | Source |
| --- | --- | --- |
| D-01 | Blueprint top-level keys: `studio_id`, `template_meta` (template_id, registry source, label, domain category, version, tpt, modes), `harbor_contract` (`atif_v1_2`, `network_internal`, `require_solve_sh`, `zero_baseline_gate`), `domain_meta` (title, persona label, horizon {type, max_turns, cadence_unit}), `step_2_data_panels`, `step_3_mcp_simulators`, `step_4_invariant_catalog`, `step_5_default_rubric`, `custom_fields_by_stage`. | Mock S2 (UISpec.json); PDF §4.1 |
| D-02 | Blueprint is versioned with the template and immutable once a version is Active / used by a project. | Code (SPEC rules) |
| D-03 | Blueprint has a JSON Schema with server-side validation; the same validator runs in the browser for instant feedback. | Implied by PDF validity counts |

### 6.2 Authored task store

The PDF specifies table `public.sme_authored_tasks` [PDF §7.1]: `task_id` (PK, e.g. `TASK-MKTG-901`), `template_id`, `workflow_name`, `template_version` ('v1'), `project_id`, `assigned_sme_email`, `preserved_docker_url`, `tpt_estimate`, `execution_mode` ('Hermetic MCP'), `zero_baseline_score` (CHECK = 0.00), `oracle_solve_score` (CHECK = 1.00), `task_json_payload` (JSONB), `harbor_bundle_uri`, `created_at`, `updated_at`.

| ID | Requirement | Source |
| --- | --- | --- |
| D-10 | Store every listed attribute for each authored task. | PDF §7.1 |
| D-11 | Every row is client-scoped and linked by foreign key to the Praxis template version, project, SME user and task instance (the PDF uses free-text IDs and emails). | Code (multi-tenant, RBAC) |
| D-12 | The zero-baseline = 0.00 and oracle = 1.00 results must be **measured**, stored with evidence (run ID, logs, timestamp), and enforced as a gate, not as column defaults. | PDF §5.1(2), §7.1 |
| D-14 | Every authored task and bundle stores `data_classification` (`synthetic` or `real_public`), set from the real-data switch at commit time and immutable afterwards. | Owner D5a |
| D-13 | Storage (D8 = A): new client-scoped table `sme_authored_tasks` linked to the existing `TaskInstance` → `TaskSubmission` → `TaskReview` → `ApprovedTaskRecord` chain; PDF columns such as SME email, workflow name and project ID are read through those links. `ApprovedTaskRecord` schema and append-only rule unchanged. | Owner D8; Code / CLAUDE.md |

### 6.3 Harbor bundle `<task_id>.tar.gz` [PDF §7.2]

| Archive path | Source | Runtime access |
| --- | --- | --- |
| `task.json` | Stage 1 + custom fields | Harbor runner: metadata, horizon limits, resources, ATIF v1.2 flags, custom keys |
| `instruction.md` | Stage 1 + custom fields | Agent read-only: persona, objectives, tool signatures, guardrails |
| `/workspace/inputs/*` | Stage 2 public dropzones | Agent read-only datasets |
| `/environment/mcp_mock.py` | Stage 3 simulators | Internal loopback MCP server with SME slider values |
| `/eval/ground_truth/*` | Stage 2 oracle annotator | Verifier only, hidden from the agent |
| `/eval/test_verifiers.py` | Stages 4, 5 + custom fields | Verifier only: milestones, hard-fail invariants, custom assertions |
| `/solution/solve.sh` | Stage 1 oracle contract | Pre-flight: must score 1.00 |

| ID | Requirement |
| --- | --- |
| D-20 | Bundle layout exactly as above; deterministic build (same inputs → same SHA-256), hash stored with the task. |
| D-21 | Hidden paths (`/eval/*`, `/solution/*`) are never exposed to the agent workspace or to the SME's agent-facing preview. |
| D-22 | Bundles live in the existing evidence/object storage (GCS in deployed environments, fake-GCS locally), not on container disks. |
| D-23 | The PDF lists Harbor v0.25+ / ATIF v1.2 as the runtime target; exact Harbor schema versions are confirmed in architecture (no change to Anvil's frozen contracts, N1). |


## 7. Non-functional requirements

| ID | Requirement | Source |
| --- | --- | --- |
| NFR-01 | **Hermetic execution**: generated studios' agent sandboxes and all verifier runs use an internal-only network; no outbound internet. Studios themselves are reachable only through the Praxis auth front door. | PDF §1 mandate |
| NFR-02 | **Untrusted generated code**: LLM-generated code never runs inside the Praxis API/worker process or with Praxis service credentials. It runs in a separate sandbox with no access to Praxis databases except through a narrow, authenticated API; CPU/memory/time limits; no privileged containers. | Security (generated code is untrusted) |
| NFR-03 | **Human decisions**: AI output never approves a template, a task or a deployment; an Admin action deploys, a Reviewer approves tasks. | CLAUDE.md non-negotiables |
| NFR-04 | **Secrets**: provider keys in Secret Manager (deployed) or `.env` (local), never in the DB, UISpec, logs, bundles or browser. Mockup placeholders (`AIzaSy…`, `sk-ant-…`, `sk-proj-…`, connection UUIDs) are illustrative only and must not be reproduced as real-looking values in code or fixtures. | Security; `.env.example` convention |
| NFR-05 | **Privacy and synthetic data**: no real customer or employer data in templates, payloads or bundles; SME emails shown only to Admins; no identity images or ID numbers stored. | CLAUDE.md |
| NFR-05a | **Real-data switch (D5a)**: a server-side switch, off by default in every environment, that allows tasks to use real public data. While off, the studio and bundles carry `data_classification: synthetic`. Turning it on requires owner approval, a data-handling note (sources, licences, storage, export) and the matching `CLAUDE.md` rule update in the same change. Every task records its data classification; exports and the Approved Task Dataset carry it; the switch never permits customer or employer data. | Owner D5a |
| NFR-06 | **Audit and idempotency**: create, edit, save variant, generate, verify, deploy, undeploy, commit task and export are audited commands with idempotency keys. | CLAUDE.md |
| NFR-07 | **Tenancy and RBAC**: every query is client-scoped; Screens 1–3 Admin-only; Screen 4 assigned SME (+ Admin read). | Code |
| NFR-08 | **Tests never call live providers**: LLM, container runtime and Harbor runner are behind interfaces with deterministic mocks in local dev and CI. | CLAUDE.md rule 5 |
| NFR-08a | **Live-call environments (D6b)**: live Claude/Gemini calls only when `APP_ENV` is `staging` or `production`, the relevant generation switch is on and the cost cap is set; otherwise the deterministic mock is used. Startup refuses a live configuration in `local`, `demo` or test. | Owner D6b |
| NFR-09 | **Cost controls**: per-generation token cap, per-client daily generation budget, and limits on concurrent running studios; stopped studios consume no compute. | Owner instruction (budgets) |
| NFR-10 | **Accessibility**: WCAG 2.1 AA on all four screens (keyboard navigation of stage nav, grid annotator and sliders; slider values announced; contrast). The mockup's dark theme must meet contrast rules. | Existing a11y work (commit a03cb10) |
| NFR-11 | **Branding**: screens use ADI Praxis branding and tokens (`packages/shared/theme`), not the mockup's "HARBOR / Enterprise RL" brand (D13 = A); mockup layouts kept; "Harbor" only as a product term. | SPEC "Branding" |
| NFR-12 | **Performance**: directory loads < 2 s for 500 templates; inspector updates < 1 s; task commit < 5 s excluding bundle upload. | Proposed; owner to confirm |
| NFR-13 | **Observability**: generation, verification and deployment jobs expose status, duration, cost and failure reason. | Proposed |

## 8. Conflicts and decisions needed from the owner

The sources describe a stand-alone "Harbor" product. Praxis has rules that the sources do not mention. All decisions were answered by the owner on 7 Nov 2026 (one by one); the final column records the decision. Summary in section 14.

| # | Decision | Why it matters | Recommendation |
| --- | --- | --- | --- |
| D1 | Where does the blueprint live? PDF says `domain_templates.json`. | Praxis stores templates in PostgreSQL with versions and audit. | **DECIDED (owner, 7 Nov 2026): A.** Store in the DB with each template version (versioned, audited, pinned by projects); `domain_templates.json` / UISpec.json is import/export only. |
| D2 | Status model: PDF has **Draft / Active** (Active = deployed studio). Praxis has **DRAFT / PUBLISHED / RETIRED** (PUBLISHED = PMs may create projects). Also, today's `taskModes` (AUTHORING/ANNOTATION) vs PDF "Modes" (Hermetic MCP/Graph/SQL). | Projects can only be created from PUBLISHED templates, but the PDF deploys a studio *to a project*, so a project must exist before "Active". | **DECIDED (owner, 7 Nov 2026): A.** Keep DRAFT/PUBLISHED/RETIRED for the template lifecycle; add a separate **deployment status** (None, Generating, Verified, Active, Stopped, Failed) per template version + project. Screen 1 shows "Active" when a deployment is Active. Add "execution mode" as a new blueprint field; keep task modes. |
| D3 | Versions: semantic (`v1`, `v2`) labels vs integers; does "Save Variant" create a new workflow or a new version? | Projects pin integer versions. | **DECIDED (owner, 7 Nov 2026): A1 + B1.** Keep integer versions (display `vN`); Save Variant = new workflow (new lineage, v1) with a "variant of" link to the source template version. |
| D4 | Review and dataset: do studio-committed tasks go through the existing independent Reviewer step and into the append-only Approved Task Dataset? | CLAUDE.md: a human Reviewer decides task acceptance; dataset is append-only. The PDF goes straight from SME commit to DB/JSON/bundle. | **DECIDED (owner, 7 Nov 2026): A.** Commit creates a submission (status "Submitted for review") → independent Reviewer approves or returns → approved record; the PDF's task store is a view over this, and the bundle is attached to the approved record. Owner also wants a simple workflow for testing: see D4a (decided A). |
| D4a | Simple testing workflow. | Testers need a fast end-to-end path without weakening review. | **DECIDED (owner, 7 Nov 2026): A.** Same review rules everywhere. One-step, idempotent, audited synthetic test setup (non-production only, reusing the existing demo setup pattern): a valid, deployed synthetic example template, a project, a test SME and a separate test Reviewer, so commit → review → approve takes a few clicks. No auto-approve and no self-review in any environment. |
| D5 | What does "Generate the UI" really produce? (a) an LLM writes a bespoke front end + FastAPI backend per template (PDF), or (b) Praxis renders the studio from the UISpec with one shared, tested renderer, and the LLM only drafts content (instructions, verifier bodies, mock data) for Admin review. | (a) means running untrusted generated code per SME, a Python/FastAPI stack Praxis does not use, and per-template security review. (b) gives the same screens with far less risk and cost. | **DECIDED (owner, 7 Nov 2026): C.** Build (b) first: Step 1 compiles the UISpec + LLM-drafted artefacts with the same 3-step UX. Also build (a) as an optional **Code generation mode** behind a server-side switch, off by default, so the owner can generate per-template code for the YC demo. (a) is enabled only after (b) passes 2–3 rounds of testing and with explicit owner approval. Generation is a one-time cost per template version that the owner accepts for YC, within a cost cap the owner sets. (a) still needs the isolation in NFR-02 before any deployment. |
| D5a | "Real tasks" for the YC checklist vs CLAUDE.md "Task content is synthetic only". | Real data changes privacy, licensing and export rules. | **DECIDED (owner, 7 Nov 2026): A now, B later.** Real SMEs author and review tasks through the full workflow with synthetic content. Build a **real-data switch** (off by default) so the owner can later allow real public data (option B) after testing. Customer data (option C) stays out of scope. |
| D6 | Which model providers? PDF: Gemini + Claude. Mockup also OpenAI. Praxis today: Claude + embeddings on Vertex AI only. | New providers need contracts, processing-terms review, secrets and budgets. | **DECIDED (owner, 7 Nov 2026): A2 (changed from A1), Claude and Gemini**, both through Vertex AI in the existing GCP project (no new vendor or API keys; service-account auth as today). Model names are config settings like the existing `CERT_MODEL` / `SUPPORT_MODEL`. OpenAI is out of scope. Live-call environments: D6b (decided B). |
| D6b | Where may live, paid model calls happen? | Cost and data exposure. | **DECIDED (owner, 7 Nov 2026): B, staging and production.** The YC run happens in **production**. Live calls allowed only in `staging` and `production`, and only through the generation switches (D5) and within the owner's cost cap; `local`, `demo`, tests and CI always use mocks. Production generation stays off until the owner turns it on after the staging test rounds. |
| D7 | Guided Assistant free text: AI or rule-based? | AI output must be a proposal reviewed by a human. | **DECIDED (owner, 7 Nov 2026): A.** Free text → Claude/Gemini proposes a complete custom field (id, label, type, options, default, `inject_into`, verifier binding); Admin sees a preview and chooses Accept / Edit / Discard; nothing changes until accepted. Uses the same models, live-call rules (D6b), switch and cost cap as Screen 3; mocked in local/demo/tests. Presets: per-domain, Admin-editable lists (recommendation, not objected). |
| D8 | Task storage: new `sme_authored_tasks` table as specified, or extend existing task tables? | Duplicate stores risk drift; PDF fields like `assigned_sme_email` duplicate user data. | **DECIDED (owner, 7 Nov 2026): A.** New table `sme_authored_tasks` with the PDF's attributes plus bundle SHA-256 and data classification, linked by foreign keys to client, `TaskInstance`, `TaskSubmission`, project, template version, SME user and deployment (no copied emails/names). Screen 4 reads it; review and Approved Task Dataset unchanged. Zero-baseline and oracle scores are stored as measured results with evidence (run ID, logs, timestamp), not as column defaults. `ApprovedTaskRecord` is not altered. |
| D9 | Who may deploy? PDF mentions "DevOps". | No DevOps role exists. | **DECIDED (owner, 7 Nov 2026): A.** Admin only for Screens 1–3 (edit, generate, verify, deploy, stop); no new role. |
| D10 | PM experience: today PMs use `/templates` to see published templates. The new directory is Admin-centric. | Removing the PM view breaks FLOW 1 discovery. | **DECIDED (owner, 7 Nov 2026): A.** PMs get a read-only Screen 1: same layout (domain groups, filters, version, TPT, Modes) showing only the newest published version of each workflow; no New template, Meta-Compiler, SME emails, studio URLs or deploy controls. Workflow click opens a read-only blueprint summary (5 stages + custom fields) with **Create project**. |
| D11 | Existing fields not in the mockup (primary work, verification criteria, human gate, skills, default JD, coverage dimensions, edge-case catalog, diversity defaults) and the add-domain form. | Projects, staffing, matching and diversity use them. | **DECIDED (owner, 7 Nov 2026):** remove the Add domain button; domains and templates are **pre-seeded** because creating them by hand is hard; domain list decided in D15. **D11b = A:** "0. Catalog & Staffing" panel at the top of the Meta-Compiler, seed-filled, counts toward validity. **D11c = B:** remove New template; new workflows come only from the seed or Save Variant. |
| D12 | Release scope / priority: all four screens at once, or phased? Is "undeploy" required? | Screens 3–4 need new runtime infrastructure. | **DECIDED (owner, 7 Nov 2026): A, three phases**, each separately reviewed, tested and released. Phase A: Screens 1–2, DB blueprint, pre-seeded blueprints, PM view, AI field assistant, deterministic bundle build + preview. Phase B: Screen 3 generate/verify (shared-studio mode), Screen 4 studio in the candidate app, commit → review → approve, test setup (D4a); enough for SMEs to author YC tasks. Phase C: isolated runtime, preserved URLs, **Stop studio (required, owner agreed)**, optional per-template code generation (D5). Timeline: owner needs the system ready before ≥2 weeks of SME authoring, followed by a benchmark run; target date confirmed in D12a. |
| D12a | Deadline. | Determines what fits in each phase. | **DECIDED (owner, 7 Nov 2026):** YC date **7 Dec 2026**. Benchmark run needs 1 week (≈30 Nov – 7 Dec); SME authoring needs 2 weeks (≈16 – 30 Nov). **System (Phases A + B) must be ready in production by 16 Nov 2026** (YC date minus 3 weeks), about 9 days from PRD date. Phase C (isolated runtime, preserved URLs, Stop studio, optional code generation) is not on the critical path for YC authoring; it follows after 16 Nov and must not disrupt production during the authoring window without owner approval. |
| D13 | Branding: mockup is "HARBOR / Enterprise RL", dark theme; SPEC requires ADI Praxis branding. | Brand consistency. | **DECIDED (owner, 7 Nov 2026): A.** ADI Praxis logo, navigation, palette and existing light/dark theme (`packages/shared/theme`) on all four screens, including the SME studio; keep the mockup layouts; "Harbor" used only as a product term (Harbor bundle, Verify Harbor). |
| D14 | Preserved URL format: mockup `https://sme-<slug>.harbor.internal:8443/studio`. | `.internal` hosts are not reachable by external SMEs. | **DECIDED (owner, 7 Nov 2026): A.** Path in the candidate app, e.g. `https://experts.<domain>/studio/<studio-id>`; existing SME sign-in; only the assigned SME (and Admin read-only) can open it; URL stable across redeploys; no new hostnames, certificates or DNS. Delivered in Phase B. |
| D15 | Domains: mockup has "Digital Marketing" and "Banking"; seed catalog has Banking, Healthcare, Marketing, Research Assistant. | Renaming domains affects existing data. | **DECIDED (owner, 7 Nov 2026): B, mockup catalog.** Seed exactly the mockup catalog: **Digital Marketing** (Launch of Noise Cancelling Phone; Q4 Global Paid Search Query Clustering; Omnichannel Creative & Locale Compliance) and **Banking** (Adverse media review; AML transaction-monitoring alerts; Audit and evidence preparation; Communications surveillance; Compliance monitoring; Customer risk rating; Enhanced due diligence; Fraud-risk/compliance handoffs; Issue and remediation tracking; KYB and beneficial ownership). Full synthetic blueprints for the 3 mockup examples (Noise Cancelling Phone, KYB & beneficial ownership, AML transaction monitoring); others seeded as Draft. **Plus one new template the owner will design from the owner's own spec** (D15a). Seed is idempotent; existing data in any environment is never deleted; Healthcare / Research Assistant no longer seeded for new environments. **UPDATE (owner, 10 Nov 2026): every seeded template is published by default.** The 10 workflows without a blueprint are published from the owner's publish fields (primary work, verification criteria, human gate, skills, task modes, default TPT). `Control testing` and `Country-specific interpretation` are removed from the mockup catalog, so Banking is 10, not 12; their old-catalog drafts are retired by `catalog-v2` (nothing deleted). |
| D15a | New template and old catalog. | Seed defines everything Admins start with. | **DECIDED (owner, 7 Nov 2026): Part 1 A, Part 2 C.** (1) Owner sends their spec; agent drafts the full blueprint (Catalog & Staffing, 5 stages, custom fields, oracle table, sliders, verifiers, `solve.sh`) for owner review, then adds it to the seed. Domain follows the spec; spec needed by ≈10 Nov to meet 16 Nov. (2) Retire the old Taskflow catalog: every workflow and domain **not** in the mockup catalog (Banking: KYC onboarding and refresh, Sanctions screening, Suspicious activity and SAR/STR support, Transaction investigation, Regulatory change management, Regulatory obligation mapping, Policy-to-control mapping, Model risk/compliance review, Trade surveillance, Third-party/vendor risk, Operational risk events and RCSA, Regulatory reporting validation; domains Healthcare, Marketing, Research Assistant) is retired. The 12 mockup Banking workflows already exist in the seed and are **reused, not duplicated** (name match; seed's `Fraud–risk/compliance handoffs` en dash = mockup's hyphen); of those, `Control testing` and `Country-specific interpretation` were later removed from the mockup catalog (owner, 10 Nov 2026), so they are retired as old-catalog rows. Running projects keep their pinned versions. Today retire only applies to PUBLISHED templates, so retiring unused DRAFT seed rows needs a defined mechanism (architecture). No data is deleted. |
| D16 | Relationship to Anvil: Anvil "owns Harbor packaging, isolated execution … run accounting". This PRD has Praxis build bundles and run zero-baseline/oracle checks. | Scope overlap with the separate Anvil project; shared contracts must not change. | **DECIDED (owner, 7 Nov 2026): Part 1 A, Part 2 A.** (1) Praxis builds bundles and runs only the zero-baseline and oracle pre-flight checks as a deployment gate, in its own sandbox; no agent evaluations, trajectories or rewards in Praxis. (2) The one-week benchmark (30 Nov – 7 Dec) runs in **Anvil**. The owner is writing a separate **Anvil benchmark-factory spec** that will define how Anvil consumes Praxis tasks/bundles (including whether Harbor `.tar.gz` bundles need an Anvil-side contract change). This PRD makes no change to `contracts/praxis/*`, `docs/integrations/PRAXIS-ANVIL.md` or Anvil resources; existing export unchanged; bundles are stored and downloadable so the Anvil spec can use them. |

## 9. Change list (what will change in Praxis)

High level only; the architecture stage will confirm files and data design. Reflects the owner's decisions in section 8. Phase per D12: **A** = Screens 1–2, blueprint, seed, PM view, assistant, bundle preview; **B** = Screen 3 generate/verify, Screen 4 studio, review, test setup; **C** = isolated runtime, Stop studio, optional code generation.

| Area | Change | Files today |
| --- | --- | --- |
| Console UI | Replace Templates list with Screen 1 (grouping, filters, summary cards, new columns); remove New template and Add domain controls. | `apps/web/app/(console)/templates/page.tsx`, `components/templates/new-template-form.tsx`, `status-badge.tsx`, `new-domain-form.tsx` |
| Console UI | Replace draft editor/view with the Meta-Compiler (stage nav, 5 stage editors, custom-field dialog, inspector, assistant, Save Variant, Export, Generate). Keep version history and publish/new version/retire actions. | `templates/[id]/page.tsx`, `template-editor.tsx`, `template-view.tsx`, `template-actions.tsx` |
| Console UI | New Screen 3 route under the template (generate/verify/deploy). | new |
| Candidate app | New Screen 4 studio route driven by the blueprint (6-step sidebar, oracle annotator, curve sliders + plot, custom controls, JSON inspector, commit), using existing SME sign-in and autosave. | `apps/candidate/app/…`, `components/work/*` (reuse autosave, submit panel) |
| Shared package | Blueprint types + JSON Schema + validators; deterministic generators for UISpec preview, Meta-Prompt, pytest snippets and `instruction.md`/`task.json`. | `packages/shared/src/templates.ts` (+ new modules) |
| API | Endpoints: get/save blueprint, validate, save variant, export UISpec; generation jobs; verification jobs; deployments (create/stop/list); studio task commit, list, inspect, download, export. All audited, idempotent, client-scoped. | `apps/api/src/routes/templates.ts` (+ new routes) |
| Data | Migration: blueprint JSON + execution mode on template; new tables for generation runs, verification runs, deployments, authored tasks/bundles (FKs to existing records). No change to `ApprovedTaskRecord` or `RLReviewRecord` append-only rules. | `apps/api/prisma/schema.prisma`, new migration |
| Worker | Jobs for generation (LLM via interface), bundle build, verification (runner via interface), deployment. | `apps/api/src/worker.ts`, `jobs/` |
| Integrations (interfaces + mocks) | `CodeGenerator` (Vertex Claude/Gemini; mock), `HarborRunner` (zero-baseline/oracle; mock), `StudioRuntime` (deploy/stop; mock), bundle storage on existing GCS adapter. | `apps/api/src/config.ts`, `.env.example` (names only) |
| Docs | Update SPEC "Admin: template catalog", add a Meta-Compiler doc, decision register entries, release note. | `docs/SPEC.md`, `docs/testing/DECISION-REGISTER.md`, `docs/releases/` |
| Tests | Update API and e2e tests that rely on today's Templates UI/API; add tests for every acceptance criterion. | `apps/api/test/templates.test.ts` (+12 suites using templates), `e2e/smoke.spec.ts`, `m10.spec.ts`, `tester-profile-form.spec.ts` |
| Not changed | Anvil contracts and integration doc; shared Anvil resources; CI/deploy workflows (other than PR #7 already open). | `contracts/praxis/*`, `docs/integrations/PRAXIS-ANVIL.md` |

## 10. Acceptance and test strategy

- Every **M** requirement's acceptance criteria get an automated test (Vitest API/unit, Playwright UI) before the stage is called done (CLAUDE.md rule 3).
- Determinism tests: same blueprint → byte-identical UISpec, pytest, `instruction.md`, `task.json` and bundle SHA-256.
- Gate tests (mocked runner): zero-baseline ≠ 0.00 blocks deploy; oracle ≠ 1.00 blocks deploy; both pass → deploy allowed.
- Security tests: no key in any API response, log or bundle; cross-client access denied on every new endpoint; unassigned SME denied studio; hidden `/eval` and `/solution` absent from the agent-visible workspace; generated code cannot reach Praxis DB credentials.
- Regression: existing project creation, staffing, task review, approved dataset and Anvil export tests stay green.
- No live provider calls in tests (mocks for LLM, runner, runtime, email, identity).
- Isolated test resources for this work (separate test database and ports from Anvil, see workflow notes).

## 10a. Timeline (D12a)

| Date (2026) | Milestone |
| --- | --- |
| 7 Nov | PRD approval (Gate 1), then architecture (Gate 2) and plan (Gate 3) |
| by 16 Nov | Phases A + B built, QA'd and deployed to production with owner approval; studios ready for SMEs |
| 16 – 30 Nov | SME authoring (2 weeks) and independent review |
| 30 Nov – 7 Dec | Benchmark run (1 week) |
| 7 Dec | YC |
| after 16 Nov | Phase C, only with owner approval and without disrupting authoring |

## 10b. Delivery phase per requirement (D12 = A)

| Phase | Target | Requirements |
| --- | --- | --- |
| **A** | Screens 1–2 live (≈ 12 Nov) | S1-01 to S1-09, S1-12 to S1-17; S2-01 to S2-18; D-01 to D-03; deterministic bundle preview (D-20 without storage); NFR-03, 04, 06, 07, 08, 08a, 10, 11 |
| **B** | Studios ready for SMEs in production by **16 Nov** | S1-10, S1-11; S3-01 to S3-09; S4-01 to S4-14; D-10 to D-14, D-20 to D-23; NFR-01, 05, 05a, 09, 12, 13 |
| **C** | After 16 Nov, not disrupting authoring | S3-10 (Stop studio), S3-11 (per-template code generation); NFR-02 isolated runtime for generated studio code |

## 10c. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 9 days to 16 Nov, including three approval gates | Phase B late, SME authoring starts late | Plan gate marks S/C items that can move; approvals turned around same day where possible |
| Phase B verification runs `solve.sh` and pytest (code) for the 0.00 / 1.00 checks | Needs a sandbox before Phase C's isolated runtime | Architecture to define a minimal hermetic verifier sandbox in Phase B (no network, no Praxis credentials, time/CPU limits) |
| Owner's new template spec arrives after ≈ 10 Nov | Fourth template not ready on 16 Nov | Seed the 3 mockup blueprints first; add the fourth when ready |
| Anvil benchmark-factory spec may need Harbor bundles in a new contract | Benchmark (30 Nov) blocked on Anvil side | Bundles stored and downloadable from Phase B; contract change handled in the Anvil track only |
| Retiring old catalog in production | Confusion if a project uses an old workflow | Running projects keep pinned versions; retirement audited; nothing deleted |

## 10d. What 16 Nov needs, with full Phase A + B scope (owner asked for no compromise)

Findings (7 Nov, read-only checks): the GitHub repo has **no `staging` or `production` environments** configured; every `Deploy staging` run since 2 Oct failed at startup; there are no `v*` release tags, so `Release production` has never run. The only deployed path found is `infra/demo/deploy-demo.sh` (the testers' environment), which uses **simulated sign-in and identity**, so it cannot serve real SMEs as production.

| # | Needed from the owner | By |
| --- | --- | --- |
| N1 | Approve PRD (Gate 1): **done 7 Nov** | 7 Nov |
| N2 | Merge PR #7 then PR #6: **done 7 Nov** | 7 Nov |
| N3 | Name the production target (GCP project, region, domain for `experts.` / `app.` / `api.`) and confirm real SME sign-in and onboarding steps required before authoring | 8 Nov |
| N4 | Production access for deploy: GitHub environments + variables, or approval for the agent to run the deploy with provided credentials | 9 Nov |
| N5 | Approve architecture (Gate 2) and plan (Gate 3) the same day they are sent | 8 Nov |
| N6 | Approve parallel coding conversations (separate branches) and the OpenHands budget for them | 8 Nov |
| N7 | Approve cloud changes: enable Gemini in Vertex AI; a hermetic verifier job (no network, no Praxis credentials) | 10 Nov |
| N8 | New template spec | 9 Nov |
| N9 | Review the 4 seeded blueprints (agent drafts) | 11 Nov |
| N10 | List of SMEs and Reviewers, projects and template assignments for 16 Nov | 12 Nov |
| N11 | Generation cost cap and GCP budget | 12 Nov |
| N12 | Human QA in a non-production environment | 13–14 Nov |
| N13 | Production deployment approval with rollback plan | 14 Nov |
| N14 | Scope freeze: new requests after PRD approval go to a post-16 Nov list | 7 Nov |

| Date | Work |
| --- | --- |
| 7 Nov | PRD approved; PRs merged; architecture drafted |
| 8 Nov | Architecture and plan approved |
| 9–12 Nov | Coding Phase A and B in parallel streams; blueprints drafted |
| 13–14 Nov | QA; fixes; production deploy approval |
| 14–15 Nov | Production deploy; SME accounts and studios set up; smoke test |
| 16 Nov | SMEs start authoring |

Daily status to the owner; any slip is reported the same day with options.

## 11. Success metrics (proposed, owner to confirm)

- Admin reviews and publishes a valid 6/6 seeded blueprint in ≤ 30 minutes without editing code.
- 100% of deployed studios have stored zero-baseline 0.00 and oracle 1.00 evidence.
- 0 secrets exposed (automated scans + tests).
- SME commits a task in the studio with no partial or duplicate records.

## 12. Out of scope / later

- Per-template generated code (D5 option a) is **in scope but switched off by default**; enabling it in any environment needs owner approval after 2–3 test rounds of the default mode.
- Anvil-side evaluation runs, trajectories, rewards and the one-week benchmark run (owner's separate Anvil benchmark-factory spec, D16).
- OpenAI or any provider other than Claude and Gemini on Vertex AI (D6 = A2).
- Mobile layout for Screens 2–3 (Admin desktop tool); Screen 4 must work on tablet+.

## 13. Source mapping and open questions about the sources

| Topic | PDF | Mockup | Note |
| --- | --- | --- | --- |
| Screen 3 models | Gemini, Claude | Gemini, Claude, OpenAI | Decide in D6. |
| Screen 4 layout | 6-step sidebar, oracle annotator grid, curve sliders + plot, DB inspector | Single form, custom controls, JSON panel, task-store table | PRD takes the union. Please confirm. |
| Banking example | "KYC and beneficial ownership" (Fig 1.2 caption) | "KYB and beneficial ownership" | Assume **KYB** (matches seed catalog). |
| Verification UX | Progress bars "UI compilation / Backend compilation 100%", two gates | 5 check cards | PRD uses the 5 checks; the two gates are checks 04 and 05. |
| Scores | Column CHECK constraints | Simulated values | PRD requires measured evidence (D-12). |


## 14. Decision log

| # | Decision | Answer | Date |
| --- | --- | --- | --- |
| D1 | Blueprint storage | A: database only; `domain_templates.json` for import/export | 7 Nov 2026 |
| D2 | Status model and Modes | A: template DRAFT/PUBLISHED/RETIRED + separate deployment status; Screen 1 shows Active when a deployment runs. Modes = new blueprint `execution_mode`; task modes kept (recommendation, taken as accepted with A) | 7 Nov 2026 |
| D3 | Versions and Save Variant | A1: integer versions shown as vN. B1: Save Variant creates a new workflow (v1) linked to its source | 7 Nov 2026 |
| D4 | Review of studio tasks | A: commit → independent review → Approved Task Dataset. Visibility (owner agreed): SME sees own tasks, Admin sees all (read-only), Reviewer via existing queue | 7 Nov 2026 |
| D4a | Simple testing workflow | A: same review rules; one-step synthetic test setup (template, project, test SME, separate test Reviewer), non-production only | 7 Nov 2026 |
| D5 | Generate the UI | C: shared blueprint-driven studio first; optional per-template code generation (A) behind an off-by-default switch for the YC demo, enabled after 2–3 test rounds with owner approval, one-time cost accepted within a cap | 7 Nov 2026 |
| D5a | Real tasks for YC | A: real SMEs, synthetic content now; real-data switch (off by default) to allow real public data (B) later after testing; customer data excluded. Generation cost cap: owner sets later, before the code-generation switch is turned on | 7 Nov 2026 |
| D6 | Model providers | ~~A1: Claude only~~ → changed by owner to **A2: Claude and Gemini, both via Vertex AI**; OpenAI out of scope | 7 Nov 2026 |
| D6b | Live model calls | B: staging and production (YC run in production); only via switches and within cost cap; local/demo/tests/CI always mocked | 7 Nov 2026 |
| D7 | Guided Assistant free text | A: AI proposes a field, Admin accepts/edits/discards; same models, switch, cost cap; presets per-domain and Admin-editable (not objected) | 7 Nov 2026 |
| D8 | Task storage | A: new `sme_authored_tasks` table linked by FKs to the existing task/review chain; measured scores with evidence; ApprovedTaskRecord unchanged | 7 Nov 2026 |
| D9 | Who may deploy | A: Admin only; no new role | 7 Nov 2026 |
| D10 | PM experience | A: read-only published-only directory + read-only blueprint summary with Create project | 7 Nov 2026 |
| D11 | Add domain / seeding | Remove Add domain button; domains and templates pre-seeded; domain list decided in D15. D11b = A (Catalog & Staffing panel 0). D11c = B (no New template button; seed or Save Variant only) | 7 Nov 2026 |
| D12 | Phasing | A: three phases (A: Screens 1–2; B: generate/verify + studio + review; C: isolated runtime, URLs, Stop studio, optional code-gen). Stop studio required (agreed). Timeline: ready before ≥2 weeks SME authoring + benchmark run; date to confirm (D12a) | 7 Nov 2026 |
| D12a | Deadline | YC 7 Dec 2026; benchmark 1 week; authoring 2 weeks; Phases A+B ready in production by 16 Nov 2026; Phase C after, non-disruptive | 7 Nov 2026 |
| D13 | Branding | A: ADI Praxis branding and theme on all screens, mockup layouts, Harbor only as a product term | 7 Nov 2026 |
| D14 | Studio URL | A: candidate-app path `/studio/<studio-id>`, existing sign-in, stable, no new DNS; Phase B | 7 Nov 2026 |
| D15 | Seeded catalog | B: mockup catalog (Digital Marketing 3, Banking 10); full blueprints for the 3 mockup examples; the other 10 published from the owner's publish fields; 1 new owner-designed template from owner's spec (see D15a) | 7 Nov 2026; updated 10 Nov 2026 |
| D15a | New template + old catalog | Part 1 A: agent drafts blueprint from owner's spec (spec ≈10 Nov; domain per spec). Part 2 C: retire all old-catalog workflows/domains not in the mockup; reuse the 12 overlapping Banking workflows; nothing deleted | 7 Nov 2026 |
| D16 | Anvil relationship and benchmark | Part 1 A: Praxis builds bundles + runs 0.00/1.00 pre-flight gate only. Part 2 A: benchmark runs in Anvil, defined in owner's separate Anvil benchmark-factory spec; no shared contract changes here | 7 Nov 2026 |
