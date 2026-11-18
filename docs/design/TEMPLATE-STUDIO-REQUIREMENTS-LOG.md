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

## Change log

- 18 Nov 2026: started with TS-01 to TS-20 from the manual hand-off of KYC v7 and Marketing VEYRA to RL Gym (H0).
