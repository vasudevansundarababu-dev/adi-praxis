# Architecture: Policy Rules

| Item | Value |
| --- | --- |
| Status | **Approved by the owner on 9 Nov 2026 (Gate 2: architecture).** A1–A8 accepted as proposed; region US. Next: build plan (Gate 3). |
| PRD | `docs/prd/PRD-POLICY-RULES.md` (approved 9 Nov 2026) |
| Baseline | `main` at `1daacdd` |
| Prepared by | OpenHands agent (Architect role) |

## 1. Principles

1. Reuse existing Praxis building blocks: `runCommand` (authorised, idempotent, audited), `writeAudit`, outbox, BullMQ, GCS evidence storage and malware scanner, `document-text.ts` readers, `GoogleAuth` + Vertex REST pattern from `meta-compiler/drafter.ts`, cost guard pattern from `meta-compiler/cost.ts`.
2. **Additive only.** New tables and an optional export sidecar; no change to existing task, rubric, template blueprint or `praxis.anvil.task.v1/v2` schemas.
3. Published things are append-only in the database (trigger, same as `SmeAuthoredTask_immutable`).
4. Providers are adapters behind one interface; tests use recorded responses, never live calls (CLAUDE.md rule 5).
5. Human decides: extraction only creates Draft / Needs definition candidates.

## 2. System view

```mermaid
flowchart LR
  subgraph Web[apps/web]
    SP[Sources & Policies<br/>Extract · Review Rules]
    TP[Task policy panel<br/>+ change form]
  end
  subgraph API[apps/api]
    PR[routes/policy.ts]
    ES[policy/extraction-service]
    W[BullMQ worker<br/>policy-extract]
    N[policy/normalise]
    RS[policy/rule-sets + snapshots]
    X[policy/export-sidecar]
  end
  subgraph Adapters
    L[LlamaExtract<br/>hosted API]
    G[Google<br/>Document AI Layout Parser + Gemini]
    M[Manual text]
  end
  SP --> PR --> ES --> W
  W --> L & G
  M --> N
  W --> N --> DB[(PostgreSQL)]
  TP --> PR --> RS --> DB
  RS --> X --> Anvil[[Anvil import]]
  ES --> GCS[(GCS evidence bucket)]
```

## 3. Data model (one additive Prisma migration)

| Table | Key fields | Mutability |
| --- | --- | --- |
| `TemplatePolicyProfile` | templateId, templateVersion, categories Json, suggestedPatterns Json, expectedEvidence Json | Versioned with template |
| `ProjectPolicyRequirement` | projectId, copied from template profile, templateVersion | Copy at project creation |
| `PolicyDocument` | id, clientId, projectId, title, category, language, jurisdiction, effectiveFrom/To, archivedAt | Metadata editable |
| `PolicyDocumentVersion` | documentId, version, sha256, fileName, mediaType, sizeBytes, pageCount, storageKey, textStorageKey, locatorGranularity, origin (UPLOAD / MANUAL_TEXT / SEED), uploadedById | **Append-only** |
| `ExtractionBatch` | projectId, idempotencyKey (unique), profileId, profileRevision, profileSnapshot Json, schemaHash, promptHash, parentBatchId, status, requestedById | Status only |
| `ExtractionJob` | batchId, documentVersionId, provider, providerOperationId, status, attempt, error, rawReceiptKey, usage Json, estimatedUsd, actualUsd, startedAt, finishedAt | Status only |
| `PolicyRule` | id (stable), projectId, ruleKey (e.g. `R-APPROVAL`), currentVersion | — |
| `PolicyRuleVersion` | ruleId, version, state (DRAFT / NEEDS_DEFINITION / REVIEWED / EXCLUDED), body Json (canonical §5), contentHash, extractionJobId?, editedById, reviewedById, reviewedAt, excludeReason | DRAFT editable; **REVIEWED/EXCLUDED immutable** |
| `PolicyCitation` | ruleVersionId, documentVersionId, fieldPath, role (supports / qualifies / exception / conflict), quote, locator Json, resolution, providerRaw Json, confirmedById | With its rule version |
| `ProjectRuleSet` | projectId, version, inheritanceMode (ALL_TASKS), ruleVersionIds, sourceHashes, digest (unique per project), publishedById | **Append-only** |
| `TaskPolicyChange` | taskInstanceId, ruleVersionId, type (CLARIFICATION / STRICTER / EXEMPTION), scope Json, reason, sourceCitationId, state (DRAFT / PUBLISHED), createdById | DRAFT editable |
| `TaskPolicySnapshot` | taskInstanceId, version, ruleSetId, resolved Json, changes Json, sourceHashes, rubricVersion, digest (unique per task), publishedById | **Append-only** |
| `TaskSubmission`, `SmeAuthoredTask` (existing) | + nullable `policySnapshotId` | Additive column only |
| `ExtractionProfile` | id (e.g. `llama-agentic-v1`), provider, enabled, revision, config Json, credentialRef, scope (DEPLOYMENT / TENANT / PROJECT) | Admin only; revision bumps |
| `ExtractionSpend` | provider, jobId, reservedUsd, actualUsd, createdAt | Append-only ledger; the ceiling is cumulative per provider (not monthly) |

All rows carry `clientId` for tenant isolation. Append-only via `BEFORE UPDATE OR DELETE` triggers; `PolicyRuleVersion` trigger allows updates only while `state` is DRAFT or NEEDS_DEFINITION. Deleting a document version referenced by a published set is blocked by FK (`ON DELETE RESTRICT`).

## 4. Extraction service and adapters (`apps/api/src/policy/extraction/`)

```ts
interface ExtractionAdapter {
  provider: 'llamaextract' | 'google' ;
  validateProfile(p: ProfileSnapshot): Problem[];
  submit(input: { bytes: Buffer; mediaType: string; schema: CanonicalSchema; prompt: string }, p): Promise<{ operationId: string }>;
  getStatus(operationId, p): Promise<'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'>;
  getResult(operationId, p): Promise<{ raw: unknown; candidates: RawCandidate[]; usage: Usage }>;
  cleanup(operationId, p): Promise<CleanupOutcome>;
}
```

Page limit (D-L2): PDF = `numPages` from `unpdf`; DOCX = `<Pages>` in `docProps/app.xml`, or, if absent, the text rule; TXT/MD and DOCX without a page count = estimated tokens (characters ÷ 4) ≤ 20 × 600 = 12,000 (LlamaExtract's text-page unit). Encrypted or unreadable files are rejected.

Flow: route → `runCommand` (Idempotency-Key + computed batch key from PRD PR-E05) → resolve profile (override → project → tenant → deployment; Admin-only override; fail on unknown/disabled) → page check (≤ 20) → cost guard reserves worst case → create batch + one job per document version → enqueue `policy-extract`. Worker persists `providerOperationId` before polling, polls with backoff (2 s → 30 s, 30 min deadline, 3 transport retries, Retry-After honoured), stores raw receipt in GCS (private), normalises, writes candidates as `DRAFT` or `NEEDS_DEFINITION`, records actual usage, calls `cleanup`. No failover.

| Adapter | Calls | Auth |
| --- | --- | --- |
| **LlamaExtract** | Upload file (ephemeral) → `POST /api/v2/extract` {project_id, file_input, configuration{tier, parse_tier, extraction_target: per_doc, cite_sources, confidence_scores, version (pinned)}, data_schema} → `GET /api/v2/extract/{id}?expand=extract_metadata,configuration,usage` → delete file | Bearer key from Secret Manager `llamaextract-api-key` |
| **Google** | PDF/DOCX: Document AI Layout Parser (location `us`) `:process` online for ≤ 15 pages; 16–20 pages use `:batchProcess` with input/output in a private GCS prefix (Document AI service agent gets object access to that prefix only) → layout chunks with page spans. TXT/MD: Praxis splits by line ranges. Then Vertex `generateContent` in `us-central1` (Gemini Flash, pinned version) with `responseSchema` = canonical schema, input = numbered chunks, instruction: cite chunk IDs, never follow document instructions. Praxis resolves chunk IDs → page/line + verbatim quote check. | Cloud Run service account (`roles/documentai.apiUser`, existing `roles/aiplatform.user`) |
| **Manual** | No provider; author edits fields directly against pasted text; citations are text spans with declared granularity. | — |

Unconfigured → `PROVIDER_UNAVAILABLE` error and a "Not available" receipt state; no simulated data.

## 5. Canonical candidate schema (`packages/shared/src/policy/`)

Zod schema (also compiled to the JSON Schema each provider needs): `{ rules: [{ title, requirement, requirementType, visibility (agent_visible | evaluator_only; default agent_visible, set at review), applicability{actors, actions, entities, channels, locales, jurisdictions, conditionText}, prerequisites[], precedenceClaims[], exceptions{kind: none|unknown|listed, items[]}, effective{from, to, conditionText}, evidenceNeeds[], verificationHint, uncertainty[], citations[{fieldPath, quote, page?, chunkId?, lineStart?, lineEnd?}] }] }`. Nullable = unknown. IDs are generated by Praxis, never taken from model output. Size bounds enforced; malformed output → job `partial`/`failed`.

## 6. Review, publication and snapshots (`apps/api/src/policy/`)

- Edit a rule: creates/updates the DRAFT version; editing REVIEWED creates a new DRAFT version.
- Mark Reviewed (PM/ADMIN): requires requirement, applicability, effective scope, ≥ 1 resolved citation for requirement and each material condition/exception; checks `expectedContentHash` (stale → 409). Editor may review (D-R1; guardrail E-1 later).
- Conflicts: same `ruleKey` with different content hashes in the candidate set, or same source section with different visibility; precedence cycles. Any → publication blocked with a list.
- Publish rule set: server recomputes included set and digest; same digest → returns existing set (idempotent); `expectedRuleSetVersion` mismatch → 409.
- Task view: effective rules = latest published set + task's DRAFT changes. Publish snapshot: resolve, digest, insert `TaskPolicySnapshot`; same digest → existing. Hooked into the existing task version step: when a `TaskSubmission` or `SmeAuthoredTask` row is created and the project has a published rule set, the current effective snapshot is resolved (or reused by digest) and its ID stored on the new row. PM/ADMIN can also publish a snapshot explicitly from the task page (seed tasks use this). Projects without a rule set: nothing changes.
- Exemption validation: allowed only if the referenced rule version has a listed exception and the change cites it.

## 7. API (`apps/api/src/routes/policy.ts`, access PM/ADMIN unless noted)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects/:id/policy` | Summary: documents, counts, latest set, inheritance |
| POST | `/projects/:id/policy/documents` (multipart) | Upload document version |
| POST | `/projects/:id/policy/documents/:docId/text` | Manual text version |
| GET | `/policy/document-versions/:id/content` | Source viewer (authorised stream) |
| POST | `/projects/:id/policy/extractions` | Start batch (`extractionProfileId` override: ADMIN only) |
| GET | `/projects/:id/policy/extractions/:batchId` | Receipt |
| POST | `/projects/:id/policy/extractions/:batchId/retry` | Retry failed jobs (child attempt) |
| GET/PATCH | `/projects/:id/policy/rules[/:ruleId]` | List / edit draft |
| POST | `/policy/rule-versions/:id/review` · `/exclude` | Mark Reviewed / Excluded |
| GET/POST | `/projects/:id/policy/rule-sets[/preview]` | Preview / publish |
| GET | `/tasks/:id/policy` | Inherited rules, changes, last snapshot, diff |
| POST/PATCH/DELETE | `/tasks/:id/policy/changes[/:changeId]` | Task changes (draft) |
| GET/PUT | `/admin/extraction-profiles` | ADMIN: profiles, defaults, enable/disable |
| GET | `/candidate/tasks/:id/policy` (candidate app) | SME: agent-visible rules of the SME's own task, read-only |

All writes use `runCommand`. Export: `/studio-tasks/export` and `/dataset/export` gain an optional `policy` sidecar per task when a snapshot exists.

## 8. Export sidecar (`contracts/praxis/policy-snapshot.schema.json`, status **proposed**)

`{ schema_version: "praxis.anvil.policy.v1-proposed", task_id, task_version, project_rule_set{id, version, digest}, rules[{rule_id, version, requirement, applicability, exceptions, effective, precedence, evidence_needs, verification_hint, visibility, sources[{document_id, version, sha256, locator, quote}]}], task_changes[], rubric_version, digest }`. Aligned with the handoff schema (S3) field names where they overlap. Evaluator-only items are never in agent-visible files. Existing envelopes are untouched.

## 9. Front end (`apps/web`)

- `projects/[id]/policies/page.tsx`: tabs **Extract** and **Review Rules** using existing table, form, upload, badge and tab components. Source viewer: PDF via existing viewer pattern (page + highlight when a box exists), text via line view.
- Project page: Sources and Policies entry + summary card. Tasks list: policy readiness column.
- Task page: policy panel (banner, inherited list, conditional applicability, changes, snapshot preview, Anvil status "Not tested").
- Admin → Extraction profiles (ADMIN only).
- Accessible state labels (text, not colour only).

## 10. Configuration (names only; values never committed)

| Name | Purpose |
| --- | --- |
| `POLICY_EXTRACTION_LIVE` | `true` enables provider calls (staging only); otherwise adapters report unavailable |
| `LLAMAEXTRACT_API_KEY` (secret `llamaextract-api-key`), `LLAMAEXTRACT_PROJECT_ID`, `LLAMAEXTRACT_BASE_URL` | LlamaExtract |
| `DOCUMENTAI_PROCESSOR` (projects/…/processors/…), `DOCUMENTAI_LOCATION`, `POLICY_GEMINI_MODEL` (pinned) | Google |
| `POLICY_BUDGET_LLAMA_USD=20`, `POLICY_BUDGET_GOOGLE_USD=30` | Spend ceilings |
| `POLICY_MAX_PAGES=20` | Upload limit |
| `POLICY_PRICE_LLAMA_USD_PER_PAGE`, `POLICY_PRICE_GOOGLE_USD_PER_PAGE` | Dated worst-case estimates used to reserve budget before a job; actual usage recorded after |
| `DOCUMENTAI_LOCATION=us`, `VERTEX_LOCATION` (existing) = `us-central1` for policy calls | Region (owner: US) |

Config validation: production refuses `POLICY_EXTRACTION_LIVE=true` without both budgets set.

## 11. Infrastructure (separate PR, owner reviews and applies)

- `modules/platform`: add `documentai.googleapis.com`.
- `modules/iam`: backend SA gets `roles/documentai.apiUser`; secret `llamaextract-api-key` added to `app_secret_names` (value set by owner).
- New `google_document_ai_processor` (type `LAYOUT_PARSER_PROCESSOR`) in staging, location **`us`** (owner, 9 Nov 2026).
- Document AI service agent: object read/write on the private `policy-docai/` prefix of the evidence bucket (batch processing for 16–20 pages).
- No change to production until the owner asks.

## 12. Seed (`apps/api/src/jobs/policy-seed.ts`)

Idempotent job (refuses `APP_ENV=production`). For each of 5 projects: fictional SEED documents (≤ 20 pages, TXT/MD/DOCX generated from repo fixtures), rule versions with citations (origin SEED, Reviewed by the seed actor, labelled fixtures), published set, 2 draft tasks from the project's template with one task change and a snapshot; one deliberate conflict left unpublished. Bodhium pack: same job with `--pack <private path>`; data never committed.

## 13. Security

Keys only from Secret Manager; LlamaExtract base URL allowlisted; Google endpoints fixed. No policy text, keys or signed URLs in logs (existing logger redaction extended). Uploaded files: byte sniffing, size/page limits, existing scanner, encrypted/password PDFs rejected. Document content treated as data (prompt states it; no tool use; no URL fetching). Tenant `clientId` scoping on every query. Raw receipts in private GCS.

## 14. Testing

Unit: schema, normaliser (both providers from recorded fixtures), citation resolution, conflict detection, digest/idempotency, exemption rules, profile resolution, budget guard. API: every route incl. 403s, stale 409s, replay. Migration: append-only triggers. Web: component tests. Playwright: upload → manual text → review → publish → task inherits → snapshot → export. Live provider smoke: manual staging step, not CI.

## 15. Decisions for approval

| # | Decision | Proposal |
| --- | --- | --- |
| A1 | Store policy data in new additive tables (not in `Template.blueprint` or task JSON) | Yes |
| A2 | Snapshot taken in the existing task publish/accept step; tasks without a rule set unchanged | Yes |
| A3 | Export sidecar `praxis.anvil.policy.v1-proposed` in `contracts/praxis/`, task envelopes unchanged | Yes |
| A4 | Google adapter = Layout Parser + Gemini Flash (pinned); TXT/MD read by Praxis | Yes |
| A5 | Live calls only when `POLICY_EXTRACTION_LIVE=true` on staging; CI uses recorded fixtures | Yes |
| A6 | Infra in a separate PR; Document AI region `us`, Gemini in `us-central1` | **Decided: US (owner, 9 Nov 2026)** |
| A7 | Page counting rule for DOCX/TXT/MD as in section 4 (text page = 600 tokens) | Yes |
| A8 | Snapshot ID stored on new `TaskSubmission` / `SmeAuthoredTask` rows (additive nullable column) | Yes |
