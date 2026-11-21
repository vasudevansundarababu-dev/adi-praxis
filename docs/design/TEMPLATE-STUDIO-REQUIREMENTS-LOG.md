# Template Studio: requirements log (living document)

Started 18 Nov 2026 by the QA DevOps session, on the owner's instruction: *record every gap found while moving
templates and tasks between ADI Forge (authoring) and RL Gym, and give them as required spec to Template Studio.*

Template Studio is a standalone ADI Labs utility that creates templates and environments outside both authoring and
RL Gym (design: `docs/design/TEMPLATE-STUDIO.md`, PR #85, parked). This log does not change that design. It
collects requirements the Studio must meet, with the evidence behind each one, so the design can be rewritten
from facts.

Both ADI Forge (authoring) and RL Gym are expected to agree to this log before the Studio is built.
Related: `docs/anvil/FORGE-RLGYM-HANDOFF-GAPS.md` (the 18 Nov hand-off) and `docs/anvil/PRAXIS-ANVIL-CONTRACT-FINAL.md`.

## How this log is used

- **One row per requirement**, with an ID that never changes. New learnings add rows; a changed requirement keeps its
  ID and gets a dated note.
- **Owner** says who must deliver it: `Studio` (the utility), `Forge` (authoring), `RL Gym`, or `All`.
- **Status:** `open`, `agreed` (both sides accept), `built`, `dropped` (with reason).
- **Source** points at the run, defect or hand-off that showed the need.

## Runs that feed this log

| Run | Template | Integration | Status | Learnings |
|---|---|---|---|---|
| H0: manual hand-off | KYC v7, Marketing VEYRA v1/v2 | Off: files sent by hand | Done 18 Nov 2026 | Rows TS-01 to TS-20 below |
| R1: benchmark run | KYC (one task) | Off | Planned (owner) | *to be added* |
| R2: benchmark run | Marketing | **On** (live integration) | Planned (owner) | *to be added* |
| P1: target flow | All | n/a | Proposed by owner 20 Nov 2026 | Rows TS-26 to TS-46 |

After R2, this log becomes the input for the Studio's requirements spec.

## Requirements

### A. Template specification

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-01 | Studio | A template version is one bundle with four parts: requirement, authoring (form), execution, skills. It has a whole-template SHA-256 and a SHA-256 per part, and a human-readable export of the full published spec. | On 18 Nov the full KYC v7 and Marketing specs had to be rebuilt by a script from the database to answer RL Gym. | open |
| TS-02 | All | **Every hash says what it covers.** For each hash field, record: the input (which object or bytes), ordering, canonical form (RFC 8785 / JCS), algorithm and encoding. Publish these as part of the schema. | RL Gym could not reproduce `population_sha256` (ids only vs records vs objects). The bank-rule hashes turned out to be the SHA-256 of the JCS *string* of the rule text, not of an object. | open |
| TS-03 | All | **Successor versions only.** A published version never changes. Adding policy text, state modules, receipts or form changes creates a new version with an explicit `successor_of` link. Unchanged parts keep their hashes, and the diff shows which parts changed. | KYC v7 could not take the federal text without changing its hash. Marketing form v2 changed only the authoring part (execution and skills hashes unchanged), which was the right pattern. | open |
| TS-04 | Studio | **Visibility of every form sub-field is declared** (agent-visible or private), including items inside lists such as policy citations, so the agent's view never includes private fields. | Marketing v1's approved task was refused at export (`GENERIC_PRIVATE_EXPOSURE`): the form did not mark citation rationale, applies-to and exception as private. A v2 form and re-authoring were needed. | open |
| TS-05 | Studio | **Input contract, never input data.** The template declares what kind of case each task is written for (case selector, e.g. `product = individual`) and its allowed values. It carries no evaluation dataset or population. | Owner decision 18 Nov 2026: RL Gym owns datasets and populations; authors must not see or choose evaluation data. | agreed (owner) |
| TS-06 | Studio | Worked examples for authors are stored and labelled separately from any evaluation set. | Same decision as TS-05. | open |

### B. Policy artifacts

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-07 | Studio | **Policies by content, not by pointer only.** For each policy: id, version, kind (`official_text`, `descriptor`, `bank_rule`, `synthetic`), SHA-256 of the actual content, publisher, source location, retrieval method, point-in-time date, effective from and to. A descriptor's hash and the text's hash are separate fields. | KYC v7 held only a federal descriptor (`normative_text_included: false`). The text of 31 CFR 1020.220 was captured by hand from eCFR on 18 Nov (text hash `07069b75…`, descriptor hash `0c05f57a…`). | open |
| TS-08 | Studio | **The Studio captures official text itself** and stores the exact bytes with a capture record: source URL, API used, as-of date, amendment history. | Done by hand for the federal rule. The eCFR versioner API needs a compression header (`Accept-Encoding`), otherwise it answers 406. | open |
| TS-09 | Studio | **State modules and charter applicability**, one per jurisdiction, each with version, content hash, effective interval and review status, plus the rule that decides which state and charter apply to a case. | All five state modules for KYC (CA, NY, TX, FL, IL) are `legal_qualification: pending`; every case has `charter_applicability.reviewed: false`. Nothing could be bound. | open |
| TS-10 | All | **Synthetic is never public policy.** Every policy source is marked `synthetic` or `official`. A synthetic document can be used for authoring practice but never bound as a public policy artifact. | QA projects use six synthetic policy documents (a fictional demo bank). They had to be labelled "not public policy" by hand in the hand-off bundle. | open |

### C. Approvals and receipts

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-11 | Studio | **Approval records with scope.** Reviewer identity and role; independence (not the author or uploader); scope = policy set × product × state × charter × effective interval; the artifact hashes covered; expiry; revocation. Shows `pending` until one exists. The AI never approves. | RL Gym asked for exactly these on 18 Nov. Only internal rule-set reviews existed, done by one Admin who also uploaded the documents, with no expiry or revocation. | open |
| TS-12 | RL Gym | **Qualification receipt after publication.** When a template version is published, RL Gym registers and qualifies it and posts the receipt (id, hash, expiry) or a revocation back. | No receipt exists for KYC v7 or Marketing v2, so RL Gym reports `AV_TEMPLATE_NOT_REGISTERED`. This step is already in the agreed contract (section 3, step 5) and was never done. | open |
| TS-13 | Studio | The Studio shows, per template version, which receipts and approvals exist and which are pending, before anyone uses the template. | On 18 Nov this had to be worked out by database queries. | open |

### D. Hand-off between Studio, authoring and RL Gym

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-14 | Forge | **Each task export carries its policy binding**: project rule-set version and digest, and a link with hash to the project policy manifest. | The exported KYC task package has the task's own citations but no rule-set digest; RL Gym had to ask. | open |
| TS-15 | Forge | **Warn or block before export** when the template version has no RL Gym qualification receipt. | The QA export sent 4 KYC tasks that came back "not validated" for a reason unrelated to the tasks. | open |
| TS-16 | All | **Credentials per environment**: a project-scoped export credential for QA (then Staging), with expiry, rotation and revocation. Secrets are entered by the owner only. | QA export failed with "Valid project-scoped export credential required". Contract open question 7. | open |
| TS-17 | Forge | **Offline package download** for isolated testing while the live integration is off: the same package the live export would send, with its hashes. | Built by hand on 18 Nov with a read-only job for one KYC task. | open |

### E. Platform behaviour learned in QA

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-18 | All | A form or template stored at runtime must be available to every service that uses it (API, workers, jobs), not only to the process that stored it. | D30: the background worker never loaded stored forms, so the tutorial video for VEYRA v2 failed. Fixed in PR #97. | built (Forge) |
| TS-19 | All | AI calls never run inside a database transaction; each call has a time budget; large forms are sent in batches; a timeout says "try again" plainly. | D31: field suggestions failed on large Marketing sections (15 s transaction limit, 45 s model limit). Fixed in PR #98. Applies to the Studio's own AI drafting. | built (Forge) |
| TS-20 | Studio | Paid generation (videos, long drafts) runs only on published versions, shows its cost estimate and caps first, and is started by a person. | The tutorial flow already does this; keep it for anything the Studio generates. | open |

### F. Template revisions and migration

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-21 | All | **Migrating approved tasks to a successor template version.** A defined process: successor task revisions point to the new version; the originals stay unchanged; unchanged content carries its original SME approval; a change report lists exactly what changed; any change to the required decision, outcome or business meaning goes for separate approval and is never covered by the old one. Allowed only with a recorded Product Owner migration exception. | RL Gym asked on 18 Nov for KYC v7 tasks to be moved to a v8 with policy bindings without asking the SMEs to re-author unchanged content. No such process exists today. ApprovedTaskRecord is append-only, so successors must be new records. | open |
| TS-22 | Studio | **Named policy owner and decision records for applicability.** For each jurisdiction × product × charter × effective period, a person with the policy-owner role records either the applicable sources or a reviewed "not applicable" decision with rationale. AI may draft research notes and rule-to-clause mappings, marked as drafts; it never records the decision. | RL Gym asked for applicability to be resolved for CA, NY, TX, FL and IL. That is a legal or policy judgement, and no policy-owner role or decision record exists today. | open |
| TS-23 | All | **Rule-to-clause mapping that separates regulation from bank choice.** Each task rule links to its supporting clauses, and each link says whether it is a regulatory requirement or a bank operating choice, with the clause's source hash. | Requested by RL Gym on 18 Nov. Today GB-01 to GB-07 are bank choices with no clause links, and federal rules link only to synthetic summaries. | open |
| TS-24 | All | **A successor version may keep an unchanged form.** Creating v8 with the same form as v7 must not need a new form ID. Only a changed form gets a new ID. | ADI Forge's proposal checker rejected the KYC v8 candidate with `TP_FORM_ID_TAKEN` although its form was byte-identical to v7's (18 Nov 2026). | open |
| TS-25 | Studio | **Official source capture works for every jurisdiction**, including sites that block automated download, and records the capture method: exact server bytes, or a rendered-text capture. Point-in-time versions are used where the publisher offers them; otherwise the record says "current text on capture date". | 15 state sources captured by hand on 18 Nov: TX, FL and IL by direct download (the TX site needed its hidden source endpoint); CA and NY only through a browser (403 to automated clients). No state site offered a point-in-time version. | open |

### G. Release registry and build (the Studio as the factory)

Source for G to I: the owner's proposed target flow and inspection checklist (20 Nov 2026). The checklist cites
failures found in a review of the RL Gym codebase. This session did not verify those RL Gym findings; they are
recorded as stated.

Target flow: **Studio** authors the template, schema and seed → builds and smoke-tests the image locally with
production flags → pushes it to GCP Artifact Registry pinned by `@sha256` → publishes an immutable **release
manifest** (`template_sha256` + `image_digest`). **ADI Forge** authors tasks against the pinned release. **RL Gym**
registers the release, binds evaluators and model keys at run time, and runs isolated rollouts and grading.

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-26 | Studio | **One immutable release registry.** A release manifest holds `template_sha256` and the environment `image_digest`, plus the content hashes of the bound policy artifacts (TS-07). It is stored in GCS under its own SHA-256 with retention lock; nothing published is overwritten or deleted. ADI Forge and RL Gym have read-only access. A change is a new release with `successor_of` and a part diff (TS-03). | Today each side keeps its own copy, linked only by the template hash. QA services are deployed by tag, not digest. | open |
| TS-27 | Studio | **Images pinned by digest, built hermetically.** Every image is referenced and deployed as `@sha256:…`, never by tag. Builds download nothing live (no curl, wget or urlopen during `docker build`). Tools come from SHA-256-pinned base stages or vendored lockfiles. | Owner checklist A: a live download during build caused fragility in an RL Gym Dockerfile. | open |
| TS-28 | Studio | **Base images from the target project only.** `FROM` is parameterised (`ARG BASE_IMAGE`). The Studio checks that the base image exists in the target deployment registry, never in another GCP project. | Owner checklist A: an RL Gym image built `FROM` an image in a different GCP project. | open |
| TS-29 | Studio | **Read-only, non-root layout.** Immutable assets (schema, fixtures, server code) go under `/opt/…`, owned by root, mode 0555/0444. Mutable files (SQLite, `/workspace/inputs`, `/workspace/output`, temp files) go only in mounted writable paths (`/tmp`, `/workspace`). | RL Gym runs with `--read-only` and `--user 10001:10001`. | open |
| TS-30 | Studio | **Local contract gate before push.** Before any push, the Studio boots the image with the production flags (`--network none --read-only --user 10001:10001 --tmpfs /tmp:rw,noexec`). `GET /health` must return 200, `POST /reset` must load the seed without EROFS or permission errors, and `GET /snapshot` must export the expected state. A failed gate blocks the push. | Owner checklist A. | open |
| TS-31 | Studio | **A person approves each release, and revocation is a record.** Publishing a release is an authorised, audited state change, and the AI never approves (TS-11). A bad release is stopped by a separate revocation record, never by deletion. ADI Forge and RL Gym refuse revoked hashes. | Every state change is authorised and audited (non-negotiable). | open |

### H. Authoring checks (ADI Forge)

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-32 | Forge | **Tasks pin the release.** Every authored task records the release it was written against (`template_sha256`, and through the release manifest the `env_image_digest`). Export is blocked if that digest is not confirmed present in Artifact Registry, or if the release is revoked. | Owner checklist B. Today tasks record only the template version and hash. | open |
| TS-33 | Forge | **Pre-export scrub for secrets and host paths.** Before export, check that no local host path (`/Users/…`), `.env` value or model API key appears in the payload. Any hit blocks the export. | Owner checklist B. ADI Forge already blocks private-field exposure (`GENERIC_PRIVATE_EXPOSURE`), but has no secret or path scan. | open |
| TS-34 | All | ~~Seed and assertion dry-run in ADI Forge.~~ Dropped: SMEs add no seed data or SQL/API assertions. The Studio owns the schema and seed (TS-39); RL Gym owns evaluation data (TS-05). | Follows from the owner decision of 20 Nov 2026 (TS-39) and the decision of 18 Nov 2026 that RL Gym owns input data. | dropped |

### I. Execution and evaluation (RL Gym)

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-35 | RL Gym | **Evaluators pinned like environments.** Evaluators (Promptfoo, Gozen, OPA) are images pinned by digest, and each config is hashed. Each grading run writes a **run manifest**: release hash, evaluator digests, config hashes, policy hashes and model identifier, so a score can be reproduced. Model keys come from Secret Manager at run time and never appear in a manifest or image. | Today the template names only an "evaluator kind", not the tool, its version or its config. | open |
| TS-36 | RL Gym | **Isolation between the Gym, evaluators and secrets.** The Gym container runs with `--network none`, `--cap-drop ALL` and no LLM keys, talking only over owner-restricted Unix sockets (0600/0660, `SO_PEERCRED`). Evaluators run outside the task container, against the immutable post-rollout snapshot (trajectory, final DB dump, API trace). | Owner checklist C. | open |
| TS-37 | RL Gym | **Fail loudly, with single claim ownership.** A single-attempt runner never exits 0 when `request.json` is missing or already claimed. One active coordinator per bridge directory. | Owner checklist C: a silent exit 0 led to an empty syscall trace downstream. | open |
| TS-38 | RL Gym | **Symmetric health gates and memory limits.** Every container that `deploy.sh` checks must also be verified healthy by `startup.sh` before it exits 0. Every compose service has an explicit `mem_limit`, so parallel rollouts cannot trigger the OOM killer. | Owner checklist C: an OOM risk to PostgreSQL during parallel rollouts. | open |

### J. Template versioning (owner decision, 20 Nov 2026)

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-39 | All | **Every template change goes through the Studio.** This covers requirement, form, execution, skills, schema, seed, policy bindings and image, and even a wording-only form fix. Each change is a new Studio release with `successor_of`, a part diff and a person's approval (TS-26, TS-31). ADI Forge no longer creates template versions. It can only send a **change request** to the Studio, naming the template and the change wanted. Projects move to a new release only through the successor process (TS-21). | Owner decision, 20 Nov 2026: one place for versioning, so every release RL Gym qualifies is the one ADI Forge authors against. Today ADI Forge creates versions itself (e.g. Marketing v2 form, KYC v8). | agreed (owner) |
| TS-40 | Forge | **Retire in-tool template versioning when the Studio ships.** Remove or disable "create new version" for templates in ADI Forge (the console and the SME app), and the draft-version editing that goes with it. Keep read-only views of releases and the change-request form. Versions already published stay unchanged and readable. | Follows from TS-39. Until the Studio exists, today's in-tool versioning stays, so QA and RL Gym runs are not blocked. | open |

### K. Who may change templates and data (owner decisions, 20 Nov 2026)

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-41 | Forge | **SMEs author only what the release supports.** An SME can write a task only for a scenario the release's schema and data can represent. ADI Forge offers only the case-selector values and rules the release declares. If a scenario is not supported, the SME cannot write it; there is no SME path to request it. | Owner decision, 20 Nov 2026. | agreed (owner) |
| TS-42 | Studio | **Only a PM or Admin requests enhancements, and the Studio decides how.** A PM or Admin sends the Studio an enhancement request: the scenario wanted, the reason, and the projects affected. The Studio decides how to implement it: a new release (schema, seed, tools, form), new data, or both. It records that decision on the request. | Owner decision, 20 Nov 2026. | agreed (owner) |
| TS-43 | All | **Neither ADI Forge nor RL Gym changes a template.** Both only consume Studio releases. ADI Forge sends enhancement requests (TS-42). RL Gym raises its needs the same way. **Contract impact:** the agreed contract has RL Gym (Anvil) proposing new and changed templates (`PRAXIS-ANVIL-CONTRACT-FINAL.md`, sections 1 to 3) and ADI Forge creating drafts from those proposals. Both roles move to the Studio, so the contract needs a change agreed with RL Gym. | Owner decision, 20 Nov 2026; extends TS-39 to RL Gym. | agreed (owner); contract change open |
| TS-44 | All | **Real enterprise data (future).** Not in current scope (owner, 20 Nov 2026): all data stays synthetic until this row is taken up. Later, the owner plans to buy enterprise data, actual records rather than generated ones, so the data covers real scenarios. This **conflicts with a non-negotiable** (CLAUDE.md, SPEC.md): *task content is synthetic only; no real customer or employer data*, and *identity images and ID numbers are never stored in this platform*. Before anything is built, the owner must decide and record in `docs/`: (a) where real data may live (only in Studio or RL Gym environments, or also in ADI Forge); (b) whether SMEs and reviewers may see it, or author only against schema, case types and de-identified views; (c) how it is de-identified, especially identity numbers and images; (d) licence and data-rights terms and retention per supplier; (e) a separate GCP project and access controls; (f) how tasks and exports are labelled (`content_classification` is `synthetic` today). | Owner direction, 20 Nov 2026. Conflicts with the current non-negotiables and the QA/staging rule "synthetic only". | future (needs owner decision + spec change before work starts) |

### L. Domain packs: how the schema grows (owner decision, 20 Nov 2026)

| ID | Owner | Requirement | Why (evidence) | Status |
|---|---|---|---|---|
| TS-45 | Studio | **Layered domain packs.** The data model is built in layers. (1) A **domain core** per domain: e.g. Banking core with party, account, product, relationship (owner, joint, custodian, minor), document and case or decision. (2) **Region packs** on top: e.g. US with SSN/ITIN, CIP (31 CFR 1020.220), OCC or state charter and state modules; India with PAN, a masked Aadhaar reference only, CKYC and the RBI KYC Direction. (3) **Process packs**: e.g. KYC onboarding and refresh, AML alert review, loan origination. A template is a slice, core + one region + one process, plus its seed data. Packs grow only when a template needs them: a new process reuses the core and region; a new region reuses the core and process; a new domain gets its own core. Packs define identity-number *formats* only, and seed values are clearly synthetic. Packs name rule references, but the rules stay hashed policy artifacts (TS-07). Prefer existing vocabularies (BIAN, ISO 20022, FIBO) over inventing new ones. A core change is checked against every template that uses it. | Owner decision, 20 Nov 2026: build schemas for US banking, India banking and others. Start with the US pack from KYC v7/v8, and make India the second pack so the layering is proven early. | agreed (owner) |
| TS-46 | Studio | **Each release records its pack versions.** Every pack has its own version and content SHA-256. The release manifest (TS-26) lists the exact core, region and process pack versions it was built on. Changing a pack creates a new pack version and, through the Studio, new template releases (TS-39). An existing release never changes when a pack grows. | Follows from TS-45 and TS-26. Without it, the same template hash could mean different data models over time. | agreed (owner) |

## Change log

- 20 Nov 2026: added TS-45 (layered domain packs: core, region, process) and TS-46 (pack versions in the release manifest).
- 20 Nov 2026: added TS-41 to TS-43 (SME scope, PM/Admin enhancement requests, no template changes in ADI Forge or RL Gym) and TS-44 (real enterprise data; future, not current scope; conflicts with the synthetic-only rule).
- 20 Nov 2026: owner decided every template change goes through the Studio (TS-39). Added TS-40, dropped TS-34.
- 20 Nov 2026: added TS-26 to TS-38 from the owner's target release flow and inspection checklist. TS-34 needs an owner decision.

- 18 Nov 2026: added TS-24 and TS-25 from building the KYC v8 successor package.
- 18 Nov 2026: added TS-21 to TS-23 from RL Gym's v8 successor-package request.
- 18 Nov 2026: started with TS-01 to TS-20 from the manual hand-off of KYC v7 and Marketing VEYRA to RL Gym (H0).
