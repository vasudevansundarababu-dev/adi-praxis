# PRD: Policy Rules — project policy documents, extraction, review, inheritance and frozen task snapshots

| Item | Value |
| --- | --- |
| Status | **Draft for owner review (Gate 1: PRD).** No code until the owner approves. |
| Owner | Product owner (vasudevansundarababu-dev) |
| Prepared by | OpenHands agent (PRD role), Praxis enhancement workflow |
| Date | 9 November 2026 |
| Code baseline | `main` at `1daacdd` (PR #34 merged). |
| Source 1 | Owner spec "Praxis Policy Rules Implementation Specification", rev 1.0, 9 Nov 2026, DOCX, SHA-256 `da975ccc…9fd2c52` (kept by the owner; not committed) |
| Source 2 | Owner addendum "Praxis Document Extraction Integration", rev 1.1, 9 Nov 2026 (review package SHA-256 `693bd943…`; not committed) |
| Source 3 | Owner handoff "Praxis–Anvil Policy/Evaluator" (Design-Spec, schema `praxis-anvil-policy.schema.json`, two examples), 9 Nov 2026 (not committed) |
| Source 4 | Owner decisions in the OpenHands conversation, 9 Nov 2026 (section 8) |

Requirement IDs cite **[S1 §n / field]**, **[S2 §n]**, **[S3]**, **[Owner]** or **[Code]** (current Praxis behaviour kept or consciously changed). S2 supersedes only S1's extraction-provider assumption; S1 stays authoritative for everything else. Nothing here goes beyond the sources; where they are silent, section 8 records the owner's decision.

---

## 1. Summary

Today a Praxis project has a template, tasks, rubric and review, but no notion of the company or regulatory **policies** the agent must follow. The owner wants each project to own versioned policy documents; extract candidate rules from them (by hand or with a document-extraction service); have a person review each rule against its source; publish the reviewed rules once as the project's defaults; let every task inherit them, with only documented, source-authorised task changes; and freeze the exact rules into each published task so Anvil imports a fixed policy snapshot. Rubrics and scoring do not change. Anvil owns evaluators, environments and execution.

## 2. Goals and non-goals

Goals
- G1 Projects own versioned, hashed policy documents (PDF, DOCX, TXT, Markdown). [S1 §1, E03–E05]
- G2 One **Sources and Policies** workspace with **Extract** and **Review Rules** stages. [S1 E01, AC02]
- G3 Extraction through a provider-neutral service with two coded adapters — **LlamaExtract** (default) and **Google (Document AI Layout Parser + Gemini on Vertex AI)** — plus manual pasted text. [S2 §1–4, Owner D-G1]
- G4 Reviewed, immutable rule versions with source evidence; one immutable published Project rule set inherited by all tasks. [S1 R01–R15]
- G5 Task changes limited to clarifications, stricter constraints and source-authorised exemptions; frozen effective snapshot on task publication; exported to Anvil as a versioned sidecar. [S1 T01–T12, X01–X06, V01–V06]
- G6 Pre-seeded demo content: 5 projects × 2 draft tasks with source-backed rules, plus a private Bodhium pack. [S1 §11, Owner]

Non-goals (Release 1)
- Database policy extraction or other connectors. [S1 §1]
- Any change to rubric criteria, points, weights or formulas; any new policy-weighted score. [S1 §9, AC13]
- Running evaluators, environments or models in Praxis; a new Anvil SME role. [S1 §3, §10]
- Azure Content Understanding (replaced by Google; section 8, D-G1). The paired extraction trial and its scorecard tooling (S2 §9–10). [Owner D-T1]
- Self-hosted (BYOC) LlamaCloud; deferred until after funding. [Owner D-L1]
- Healthcare content. [S1 §11, Owner]

## 3. Users and roles

Uses existing Praxis roles only. [S1 §10]

| Action | Roles | Source |
| --- | --- | --- |
| View project policies, rules, snapshots | PM, ADMIN (project access) | [Code] `projects.ts` ACCESS = PM, ADMIN |
| Upload documents, paste text, start extraction, edit rules, exclude, add task changes | PM, ADMIN | [Owner Q3] |
| **Mark a rule version Reviewed** | **PM** (and ADMIN), never the user who last edited that version | [Owner Q7]; independent review rule [Code] CLAUDE.md "AI output never makes a final … decision" |
| Publish Project rule set; publish task snapshot | PM, ADMIN | [S1 R14, T10] |
| Choose deployment/tenant default provider, per-request override, project profile | **ADMIN only** | [Owner Q4], [S2 §2] |
| SMEs (candidate app) | See agent-visible rules of their task, read-only | [Owner Q2] |

## 4. Current state (code-backed)

| Area | Today | Code |
| --- | --- | --- |
| Project ↔ template | Project pins `templateId` + integer `templateVersion` | `schema.prisma` `Project` |
| Template blueprint | `Template.blueprint` JSON (HarborBlueprint v1) with `step_4_invariant_catalog.rules` hard-fail rules | `packages/shared/src/blueprint/schema.ts` |
| Tasks | `TaskInstance` (CREATED → … → ACCEPTED/REJECTED), `SmeAuthoredTask` (studio commits, `@@unique(taskInstanceId, submissionVersion)`) | `schema.prisma` |
| Task sources | `TaskSource` (per task file, sha256, storageKey, scan) | `schema.prisma`, `tasks/drafting/source-text.ts` |
| Document reading | PDF (`unpdf`), DOCX (`mammoth`), text; 10 MB limit; type sniffed from bytes | `candidate/document-text.ts`, `tasks/drafting/source-text.ts` |
| Uploads | `@fastify/multipart`, 10 MB, private GCS evidence bucket, malware-scan interface | `app.ts`, `candidate/storage.ts` |
| Jobs | BullMQ on Redis | `outbox/maintenance.ts` |
| AI | Vertex AI already configured (`VERTEX_PROJECT_ID`, mock otherwise); paid-AI budget pattern `GENERATION_COST_CAP_USD`, `GENERATION_DAILY_BUDGET_USD` | `config.ts` |
| Anvil exports | `/dataset/export`, `/studio-tasks/export`; frozen `contracts/praxis/task.schema.json` (`praxis.anvil.task.v1`), `task-v2.schema.json` | `docs/integrations/PRAXIS-ANVIL.md` |
| Policies | **None.** No policy, rule, rule-set or snapshot records. | — |

## 5. Functional requirements

### 5.1 Project and template [S1 UI 1]

| ID | Requirement | Source | Acceptance |
| --- | --- | --- | --- |
| PR-P01 | Template version may hold optional **policy requirements**: categories, suggested rule patterns, expected evidence. Edited in the existing template editor (Meta-Compiler). | S1 P03 | Saved with template version; a later template edit never changes existing projects (AC08). |
| PR-P02 | On project creation the pinned template's policy requirements are copied into the project as authoring requirements. | S1 J01, P02 | Copy recorded with template version. |
| PR-P03 | Project page gets a **Sources and Policies** entry and a summary: draft/reviewed counts, published set version, inheritance mode. | S1 P04, P05 | Extraction finished ≠ "reviewed" in the summary. |
| PR-P04 | Project tasks list shows per-task policy readiness: current defaults vs last published snapshot. | S1 P06 | Project edits never change published snapshots. |

### 5.2 Extract stage [S1 UI 2, S2]

| ID | Requirement | Source | Acceptance |
| --- | --- | --- | --- |
| PR-E01 | Upload policy document: PDF, DOCX, TXT, Markdown; type and content validated on the server; **≤ 20 pages per document** (text: ≤ 20 × 600 words-equivalent); existing 10 MB limit and scanning. | S1 E03, AC03; Owner D-L2 | Unsupported or over-limit files rejected with a clear message. |
| PR-E02 | Each upload is an immutable **document version**: stable document ID, version, SHA-256, filename, media type, uploader, time. Replacement = new version; old bytes kept while referenced. | S1 E04, AC05 | Old versions resolvable; deletion blocked while a published rule uses it. |
| PR-E03 | Optional metadata: title, category, language, jurisdiction/scope, effective dates; unknown stays unknown. | S1 E05 | No inferred legal conclusions. |
| PR-E04 | **Manual text**: paste text bound to a document version; locator granularity declared (e.g. "section", "none"); never fabricated page numbers. | S1 E07, AC04 | Creates real source-linked drafts. |
| PR-E05 | **Extract candidates**: one async job per immutable document version; idempotency key = tenant + project + sorted document hashes + resolved profile revision + schema/prompt hashes; same request returns the same batch; deliberate rerun = child attempt. | S1 E08; S2 §7 | Double-click/retry creates no duplicates (AC17, A07). |
| PR-E06 | **Job receipt**: queued, processing, succeeded, partial, failed, cancelled; per-document errors; provider, profile revision, completion time. | S1 E09; S2 §7 | Partial keeps usable results; never shown as complete. |
| PR-E07 | **Provider selection**: request override (ADMIN) → project profile (ADMIN) → tenant default → deployment default. Unknown/disabled/unauthorised profile fails; **no automatic failover**. Resolved profile snapshot stored with the job. No new author-facing dropdown. | S2 §2; Owner Q4 | A02. |
| PR-E08 | **LlamaExtract adapter**: server-side Bearer key from Secret Manager; ephemeral file upload; `POST /api/v2/extract` (project_id, file_input, configuration: tier agentic / parse_tier agentic, per_doc, cite_sources, confidence_scores); poll `GET /api/v2/extract/{job_id}` with extract_metadata, configuration, usage; pinned resolved version; cleanup. | S2 §3 | Contract tests with recorded responses; live smoke on staging within budget. |
| PR-E09 | **Google adapter** (replaces Azure, D-G1): Document AI **Layout Parser** produces chunks with page anchors (PDF, DOCX); Praxis reads TXT/Markdown itself with line/offset anchors; **Gemini on Vertex AI** with a response schema returns rules citing chunk IDs; Praxis resolves chunk → page/quote and checks the quote exists. Service-account auth (no keys). Pinned model version. | S2 §4 (adapted); Owner | Same canonical output as LlamaExtract (A03). |
| PR-E10 | **Unavailable provider**: an unconfigured or disabled profile shows "Not available" and returns an error; never a simulated success or receipt. | S1 E06, AC04; S2 A01, A12 | Tested. |
| PR-E11 | **Budget**: estimate and reserve cost before submitting; stop when the next worst-case job would exceed the ceiling ($50 total: $20 LlamaExtract, $30 Google); record actual usage per job. Live calls on staging only. | S2 §11; Owner Q3 | Budget exhaustion tested (A07). |
| PR-E12 | **Candidate list**: ID/title, source document/span, state (Draft, Needs definition, Reviewed, Excluded), uncertainty; open in Review Rules. Confidence is advisory. | S1 E10; S2 §6 | States distinct; no auto-approval. |
| PR-E13 | **Continue to Review Rules** keeps document/candidate context; marks nothing Reviewed. | S1 E11 | — |
| PR-E14 | Document content is data, never instructions: no following embedded links, no tool calls from content. | S1 §8; S2 §5, §7 | Injection fixture test. |

### 5.3 Review Rules and Project publication [S1 UI 3]

| ID | Requirement | Source | Acceptance |
| --- | --- | --- | --- |
| PR-R01 | Rule selector with exact version and state. | S1 R01 | — |
| PR-R02 | Source evidence beside the rule: document title, version/hash, page/section/line locator, quoted span. Unresolvable evidence keeps the rule Needs definition. Per-claim evidence for requirement, conditions, exceptions, dates, precedence. | S1 R02; S2 §6 | A05, A06. |
| PR-R03 | Editable fields: requirement; applicability (actors, actions, entities, channels, locales, jurisdictions, condition) incl. explicit universal; gate/precedence with referenced rule versions; exceptions (explicit "none" vs unknown); effective dates/scope; required evidence; suggested verification capability (hint only). | S1 R03–R09; S2 §5 | Cycles/conflicts detected; block publication. |
| PR-R04 | **Mark Reviewed** (PM/ADMIN, not last editor): requires complete source, definition, scope; records reviewer, time, content hash. Reviewed content is immutable; editing creates a new draft version. Stale decisions rejected. | S1 R10; Owner Q7 | AC06, AC17, AC18. |
| PR-R05 | Needs definition / Excluded (with reason); required policies cannot be silently omitted; counts shown. | S1 R11 | — |
| PR-R06 | **Apply to all Project tasks** (on by default; Release 1 mode). | S1 R12 | No per-task checkboxes (AC07). |
| PR-R07 | Publication preview: included Reviewed versions, excluded candidates, unresolved required rules/conflicts (block). | S1 R13 | — |
| PR-R08 | **Publish Project rule set**: immutable version with rule refs, source hashes, inheritance mode, digest, audit. Server revalidates; stale/concurrent edits rejected; identical re-publish is idempotent. | S1 R14, §6 | AC17. |
| PR-R09 | Inspect inherited tasks and impact. | S1 R15 | — |
| PR-R10 | **Conflict detection** (owner-confirmed examples): same rule ID with different content across sources; same source section with different visibility. Shown as a warning; blocks publication of the affected set until resolved. | Owner Q6 | Seed contains one deliberate conflict. |

### 5.4 Task inheritance, changes and snapshot [S1 UI 4–6]

| ID | Requirement | Source | Acceptance |
| --- | --- | --- | --- |
| PR-T01 | Task page banner: inherited set ID/version, rule count, authoring vs published status; "Not configured" when none. Legacy tasks unaffected. | S1 T02 | AC16. |
| PR-T02 | Read-only inherited rule list with applicability, source evidence, required evidence; conditional applicability shown (e.g. approval checked only when scheduling is attempted). | S1 T03, T04, §3 | AC09 documented in snapshot. |
| PR-T03 | **Task change form**: rule reference, type (clarification / stricter constraint / source-authorised exemption), scope, reason, policy source reference. Exemption unavailable when the rule defines no eligible exception; reason and source required. | S1 X01–X06 | AC10. |
| PR-T04 | Rubric shown unchanged; optional link from an existing criterion to a rule. No new weights. | S1 T07, T08, §9 | AC13. |
| PR-T05 | **Effective snapshot preview** and **publish task snapshot**: resolved rules + task changes + source hashes + applicability/precedence + required evidence + rubric version + digest, immutable. Task publication uses the existing task review/version flow. Identical content is idempotent. | S1 T09, T10, V01–V04 | AC11, AC12. |
| PR-T06 | Anvil test status shown as **Not tested** (Anvil discovery/test API not yet available); handoff readiness shows publication, source completeness and technical requirements separately. | S1 T11, T12, §7 | No fake Ready. |
| PR-T07 | **Export**: existing task envelope unchanged, plus a versioned policy sidecar (`praxis.anvil.policy.v1-proposed`, aligned with S3 schema) carrying the frozen snapshot and digest. No environment packages, credentials or install commands. | S1 V06, §7; S3 | Legacy imports unchanged (AC16); new schema in `contracts/praxis/` marked proposed. |
| PR-T08 | SMEs see agent-visible rules of their task, read-only; evaluator-only items never appear in agent-visible files. | Owner Q2; S1 §10 | — |

### 5.5 Seed content [S1 §11, Owner]

| ID | Requirement | Source |
| --- | --- | --- |
| PR-S01 | Idempotent, audited seed job (local, demo, **staging**; never production) creating SEED-labelled, fictional policy documents (≤ 20 pages), Reviewed rule versions, published Project rule sets and **2 draft tasks per project** with published snapshots, for: Phone launch; Omnichannel Creative & Locale Compliance; KYB and beneficial ownership; AML transaction-monitoring alerts; KYC onboarding and refresh. | S1 §11; Owner |
| PR-S02 | Existing blueprint hard-fail invariants become rules referencing them (same IDs); blueprints unchanged. One task per project adds a task change; one seed task carries the deliberate conflict (PR-R10). | Owner |
| PR-S03 | KYC-001 and Bodhium marketing data / FineQuestions bindings added when the owner supplies them; until then seed tasks are clearly labelled fictional design fixtures. | S1 §11; Owner Q8 |
| PR-S04 | Private Bodhium pack (not in git): project "SEED — Bodhium benchmark" from the C5 template, tasks BL-001..BL-003, closed-book policy; imported the same way as C5. | Owner |
| PR-S05 | Seed tasks are drafts: no fabricated people, approvals, reviews or compliance results. Seed rule "Reviewed" records are attributed to the seed job actor and labelled as fixtures. | Owner Q3 (drafts OK); CLAUDE.md |

## 6. Data (proposed; names reconciled at architecture)

Template policy profile · Project policy document version · Extraction attempt (batch, per-document job, resolved profile snapshot, raw receipt ref, usage) · Rule candidate/version (with field evidence) · Citation · Project rule-set version · Task policy change · Effective task snapshot · Extraction profile config · Budget ledger. Snapshots and published sets are append-only (DB-enforced, like `ApprovedTaskRecord`). [S1 §5; S2 §5–7]

## 7. Non-functional requirements

- Security: keys only in Secret Manager; no policy bodies, keys or signed URLs in logs; endpoint allowlist; existing tenant/project isolation. [S2 §7, A10]
- Reliability: persist provider operation ID before polling; backoff with jitter (2 s → 30 s, 30 min deadline, 3 retries); ambiguous submit = "submission uncertain"; late results never overwrite reviewed data. [S2 §7]
- Tests never call live services; adapters tested with recorded responses. [CLAUDE.md rule 5]
- Accessibility: labels, keyboard, state text not colour-only. [S1 §10]
- Audit: every state change authorised, idempotent and audited. [CLAUDE.md]

## 8. Owner decisions (9 Nov 2026)

| # | Decision |
| --- | --- |
| D-Q1 | Task group = Project. |
| D-Q2 | Policies for SME and Admin-authored tasks; SMEs read-only. Seed custom policies. |
| D-Q3 | Admin and PM edit policies. |
| D-Q6 | Conflict = same rule ID different content, or same section different visibility; Anvil resolves meaning contradictions at execution. |
| D-Q7 | Shared schema added to `contracts/praxis/` as proposed. |
| D-Q8 | Admin default role (done, PR #34). |
| D-R1 | **PM marks rules Reviewed** (not the last editor — proposed safeguard, confirm). |
| D-A1 | Provider default/override/project profile: **Admin only**. |
| D-G1 | **Google (Document AI Layout Parser + Gemini on Vertex AI) replaces Azure** as the second adapter. |
| D-L1 | Hosted LlamaExtract, Pay as you go; Enterprise/BYOC after funding. |
| D-L2 | Uploads limited to **20 pages per document** for now. |
| D-B1 | Budget **$50** ($20 LlamaExtract, $30 Google); live calls on staging only. |
| D-T1 | Extraction comparison trial **out of this build**. |
| D-D1 | Fictional seed documents may be sent to providers from staging. |
| D-S1 | Seed: 5 projects (no Healthcare), 2 draft tasks each; staging allowed; drafts OK; private Bodhium pack. |
| D-S2 | KYC-001 and FineQuestions data to be supplied later by the owner. |

Open for Gate 1: confirm D-R1 safeguard; confirm Gemini model choice (proposal: latest GA Gemini Flash on Vertex AI, pinned).

## 9. Change list

API: new policy module (documents, extraction service + 2 adapters + normaliser, rules, rule sets, task changes, snapshots, export sidecar, seed job), Prisma migration (additive). Web: Sources and Policies workspace (Extract, Review Rules), task policy panel, change form. Shared: canonical candidate schema, policy sidecar schema. Infra (separate PR): enable Document AI + Vertex AI, one Layout Parser processor, IAM for the Cloud Run service account, LlamaExtract key secret. Docs: this PRD, architecture, plan, `docs/integrations/PRAXIS-ANVIL.md`.

## 10. Acceptance and test strategy

S1 AC01–AC20 and S2 A01–A12 (with A01/A04 reading "LlamaExtract and Google"; A11 trial out of scope) map to unit, API and Playwright tests. Live-provider checks are a staging smoke step within budget, not CI.

## 11. Out of scope / later

Database extraction; Azure; trial tooling; BYOC; Anvil discovery/fixture test calls (status stays Not tested until Anvil exposes the API); real Anvil import and model runs (Anvil side).
