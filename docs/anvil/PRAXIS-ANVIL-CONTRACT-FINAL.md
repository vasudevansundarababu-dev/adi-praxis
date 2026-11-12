# Praxis ↔ Anvil: templates, tasks and export. Final instructions

Owner: Vasudevan. Prepared 12 Nov 2026 by the Praxis implementation session.
This document consolidates and replaces `Praxis-generic-export-requirement.txt`: the requirement, Addenda 1–2 and
notes 7A/7B.
Status: **APPROVED by the owner, 12 Nov 2026, and sent as the final instruction.** Both sides build against it. Open
questions (section 8) are answered by Anvil; Praxis builds what does not depend on them first.

## 1. Goal

Anvil benchmarks agents on tasks that Praxis experts author. Three things must work end to end, for **every**
template and every approved task, not only the 200 frozen Golden KYC tasks:

1. A new or changed template is proposed by Anvil, checked by both sides, and published for authoring.
2. SMEs author tasks from it; reviewers accept them in Praxis.
3. Praxis exports the accepted tasks; Anvil validates and resolves them for benchmark runs.

The frozen Golden KYC path (`golden-kyc-run-evidence-v1`) stays supported exactly as today.

## 2. Who owns what

| Area | Anvil | Praxis |
| --- | --- | --- |
| Customer or segment requirement (by sales channel); benchmark evolution | **Owns.** Decides that a template is needed or must change | Informed |
| Starting a new template or template change | **Owns.** Sends the template proposal | Validates it and creates a draft |
| Execution part of a template | **Owns:** environment, tool and API schemas, evaluator kinds, output schema, run limits, scoring | References it only; never edits it |
| Skills for authoring and reviewing | **Provides** them in the proposal | Uses them |
| Authoring part of a template | May propose a draft | **Owns:** form fields, SME guidance, coverage dimensions, synthetic-data rules, checks |
| Roles and review route | Not involved | **Owns, decided at project creation:** review route, merging Reviewer and PM, experience and education levels, volumes, TPT, generated job descriptions |
| People (sourcing, selection, onboarding, certification, pay) | Not involved; never receives personal data | **Owns.** Selection is always a human decision |
| Template generation from a requirement | Generates the proposal | Generates or completes the authoring part |
| Template checks | **Qualifies execution** (receipt per template version) | **Validates authorability** (Praxis API, section 5) |
| Publishing for authoring | | Praxis Admin publishes |
| Authoring and review of tasks | | **Owns** |
| Task export | Validates and resolves (section 6) | **Exports** |
| Runs, grading, reports | **Owns** | Not involved |

A template version is **complete** only when both sides accept the same version hash: Praxis "authorable" and Anvil
"qualified". Neither side edits the other side's part. Any AI-drafted template stays a draft until a person publishes
it.

## 3. Lifecycle of one template version

1. Anvil captures the requirement and drafts a **template proposal**:
   - the execution part, from Anvil's capability catalogue;
   - the authoring and reviewing skills;
   - a proposed authoring part.
2. Anvil calls Praxis **`POST /templates/validate`**. It is read-only. Anvil fixes `errors[]` and repeats.
3. Anvil calls Praxis **`POST /templates/proposals`** (idempotent). Praxis creates a **draft** template version: a new
   workflow, or a new version of an existing one.
4. A Praxis Admin completes the authoring part and **publishes**. Nothing goes live from the API alone.
5. Anvil **qualifies** the published version hash and posts the receipt to Praxis (`POST /templates/qualifications`).
   PMs see "Anvil-ready for benchmarks" only when the version is both published and qualified.
6. PMs create projects: the role split, the job descriptions, then staffing. SMEs author; the review route accepts.
7. Praxis **exports** approved tasks; Anvil validates and resolves them (section 6).
8. When the benchmark evolves, Anvil starts again at step 1 with a new version. Projects keep their version; Praxis
   never upgrades a running project silently. Anvil may revoke a qualification; Praxis then flags affected projects
   (open question Q5).

## 4. What a template version declares

**Execution part (Anvil):**
- Environment adapter.
- Tools and APIs, each with an input and output schema, error and 429/503/pending behaviour, reset and isolation.
- Evaluator kind for each rubric criterion, chosen from Anvil's catalogue.
- Output schema of the final answer.
- Run limits.
- Supported multi-agent graph node and handoff types.

**Skills (Anvil):**
- Mandatory and preferred skills, specialties, jurisdictions and languages, required certification, separately for
  authoring and for reviewing.

**Authoring part (Praxis):**
- The form (`praxis.template_profile.v1`): sections S1–S8 built from Praxis field types, private fields kept out of
  the agent view, a rule-citation field bound to published rule versions, and a rubric (weights total 100, at least
  one critical criterion, 5/2/0 anchors).
- Coverage dimensions and edge cases.
- SME guidance.
- Optional worked examples.

A template may reference only capabilities that Anvil has published in its catalogue.

**Praxis-side gaps, fixed by this build:**
- Most tool catalogues are tool names only. Only KYC v1 has full schemas.
- Rubric criteria have no evaluator kind.
- Graph node types have not been checked against Anvil's runtime.

## 5. Praxis template API (Praxis builds; Anvil calls)

**Base:** `/api/v1/integrations/anvil/templates`.

**Auth:**
- A Praxis-issued, Anvil-scoped bearer credential, server to server only.
- A Praxis Admin issues and revokes it; Praxis stores it hashed, with an expiry.
- It is valid only for these endpoints.
- No cookies; no paid model calls.

| Call | Purpose |
| --- | --- |
| `GET /contracts` | Template-spec schema versions, field types, limits, and the Anvil capability-catalogue versions Praxis understands |
| `POST /validate` | Checks a template proposal. Read-only |
| `POST /proposals` | Same body plus `Idempotency-Key`. Stores the proposal append-only and creates a draft template version. Same key with a different body returns 409 |
| `GET /proposals/{id}` | Status: received, draft created, published or rejected by Admin, with the template version ID and hash |
| `POST /qualifications` | Anvil records a qualification receipt (or a revocation) for a published template version hash |

**Response:** the same shape as Anvil's export API: `{ data: { valid, status, errors[], praxis_requirements[],
review_gates[] }, meta: { request_id } }`.

- **`errors[]`:** only what Anvil must fix. Each entry has `code`, `owner: "anvil"`, `file`, `pointer`, `message`
  and `fix`. Codes:
  - `TP_SECTION_MISSING`
  - `TP_FIELD_TYPE_UNSUPPORTED`
  - `TP_PRIVATE_FIELD_EXPOSED`
  - `TP_CRITERIA_WEIGHTS`
  - `TP_EVALUATOR_KIND_UNKNOWN`
  - `TP_TOOL_SCHEMA_MISSING`
  - `TP_OUTPUT_SCHEMA`
  - `TP_CAPABILITY_UNKNOWN`
  - `TP_SKILLS_MISSING`
  - `TP_EXAMPLE_INVALID`
- **`praxis_requirements[]`:** Praxis-side work. Examples:
  - a new field type or editor;
  - `PR_SUPPLY_INSUFFICIENT`, `PR_RECRUITMENT_NEEDED`, `PR_CERTIFICATION_NEEDED`.

  Staffing feasibility is given as counts only, with no personal data.
- **`review_gates[]`:** domain-owner sign-off and Praxis Admin publication.
- **`valid: true`** means "Praxis can collect tasks from this once published". It is not publication or approval.
- Auth, transport and internal errors use a separate error shape and are never reported as template errors.

## 6. Anvil export API (Anvil extends; Praxis calls)

Generic path, beside the Golden path. Anvil's current shape is kept: `GET /contracts`, `POST /validate` (raw ZIP),
`POST /resolve` (ZIP plus `Idempotency-Key`).

**Auth:** an Anvil-issued, project-scoped export-client token on the Praxis server only.

**Required:**
- **Any task** from a template version Anvil has qualified is accepted. There is no fixed Golden allowlist on the
  generic path.
  - Tasks from a version that is not qualified return an explicit "template not qualified" result, not
    `PX_TASK_UNKNOWN`.
  - Unknown schema versions return "unsupported contract".
- **Per-task validation relies on the template receipt.** It checks only conformance and completeness:
  - cited rule versions are present;
  - every tool step has a recorded call;
  - criteria reference existing evidence;
  - private expectations are present.
- **Package:** a ZIP containing:
  - `praxis-export.json` (manifest);
  - the form file;
  - `tasks/<id>/actor.json` (Praxis's agent projection);
  - `private/<id>/reference.json` (grader-only, `access: private_rubric`).

  Hashes use one agreed canonical JSON (Q2). Large projects are split into packages within the upload bounds, with
  a shared batch ID.
- **Responses:** `errors[]` holds Praxis fixes (`PX_*`), separate from `anvil_requirements[]` and `review_gates[]`.
  `valid: true` is not readiness or approval. A 202 for provisioning, idempotency, immutable receipts and version
  conflicts behave as on the Golden path.
- Resolve never launches a Run.
- Paid calls stay off.

**On the Praxis side:**
- **Project Export.** The owning PM or an Admin can:
  - validate one approved task at any time;
  - export every approved task once the project is complete (target reached, marked complete, or end date
    reached).
- **Separate labels:** package validity, Anvil readiness, review gates and Run authority are shown separately.
- **Flagged tasks:** listed with Praxis's fixes; nothing changes automatically.

## 7. Constraints both sides keep

- Evaluator-graded checks are never turned into agent-output fields.
- Private expectations never enter actor or public views.
- Praxis review status is provenance, not Anvil approval.
- Task content is synthetic. Customer-confidential requirement data does not enter Praxis task content.
- Neither side shares personal data of SMEs or reviewers.
- Credentials stay server-side only: never in browsers, ZIPs, logs or chat.
- Paid model calls stay off for every call in this contract.
- Staging waits for QA acceptance; production is untouched.

## 8. Open questions Anvil must answer before or while building

1. **Template-spec format.** A joint `template spec v1` (Praxis form plus Anvil execution part plus skills), with
   each part's schema maintained by its owner. Does Anvil agree, and what are the schema ID and file layout?
2. **Canonical JSON for hashes.** Anvil's Python `json.dumps(sort_keys)` or RFC 8785. Praxis proposes RFC 8785 for
   the generic path.
3. **Capability catalogue under `/contracts`:** environment adapters, tool and API schema format, evaluator kinds
   (for example run-evidence, business table, trace, human judge), output schemas, versions.
4. **Criteria weights.** 20 × 5-point checks only, or any weights totalling 100 with 5/2/0 anchors per criterion?
5. **Revocation.** What should Praxis do with running projects whose template qualification is revoked: keep
   authoring and flag them, or pause them?
6. **New error codes.** The `PX_*`, `AV_*` and `REVIEW_*` codes for the generic path and the "template not
   qualified" result.
7. **Credential lifecycle on both sides:** expiry window, rotation and revocation (the Anvil export token and the
   Praxis template credential).
8. **Dates and order.** Praxis proposes: KYC v2 account opening first, then single-agent templates, then
   multi-agent graphs. Which Anvil revision and migration?

## 9. What each side builds

**Praxis:**
1. The template API (section 5) with its credential, append-only proposal store and draft creation.
2. Template versions carrying the execution part, skills and Anvil qualification receipts, with the
   "Anvil-ready for benchmarks" label.
3. The Praxis-side gap fixes:
   - tool schemas in catalogues;
   - an evaluator kind on each criterion;
   - graph node types checked against Anvil's catalogue.
4. The Anvil export connector: contracts, validate, resolve and the package builder, connected to the existing
   project Export screen.
5. Tests, with mocks only for CI. Live QA tests need the credentials and QA deploy approval.

**Anvil:**
1. The capability catalogue under `/contracts`.
2. Template qualification and receipts posted to Praxis.
3. The generic export validation and resolution path.
4. A caller for the Praxis template API.

**QA acceptance:**
- An Anvil-proposed template goes through validate, proposal, draft, publish and qualification.
- A project is created from it; one task is authored and approved.
- The export is validated and resolved, and the receipt is recorded.
- Negative cases: an invalid template, an invalid package, idempotency conflicts, and wrong or expired credentials.

**Prerequisites:**
- The owner issues the Anvil export token through Anvil's Admin flow.
- The owner issues the Praxis template credential to Anvil.
- Both are stored in the respective secret stores.
- Praxis QA deploy approval.
- The owner's decision on Praxis QA live Vertex: the integration tests themselves make no model calls.
