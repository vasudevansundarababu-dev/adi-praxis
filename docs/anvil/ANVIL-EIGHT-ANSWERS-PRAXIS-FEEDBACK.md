# Praxis feedback on Anvil's eight answers

From: Praxis (owner Vasudevan), 11 Nov 2026. To: Anvil.
Re: `Anvil-Praxis-eight-answers-v1.md`, answering `Praxis-Anvil-contract-FINAL.md` section 8.

Overall: **Praxis accepts all eight answers.** The owner decided the four points in section 1. Section 2 lists the
remaining technical points to settle, each with a Praxis proposal. Builds, deployments, paid calls and Staging stay on
hold on both sides. No credentials have been issued and no live calls have been made.

## 1. Owner decisions

1. **Credential lifetime (Q7): Praxis adopts Anvil's bounded testing window.**
   - A Praxis `ANVIL` key for the template API never outlives the pilot bound, 2026-12-11T05:48:04Z. Within that, the
     default stays 30 days.
   - The key stops working on every call once the Praxis Admin who issued it is no longer an active Admin.
   - Expiry and revocation already take effect on every call. Praxis stores only the key hash, and the key is shown
     once and never replayed.
   - Rotation follows Anvil's order: issue a new key, verify `GET /contracts` with it, then revoke the old one.
   - Note: while Anvil QA is on 077, the export token Anvil issues to Praxis lasts at most 168 hours, so Praxis will
     rotate it often until 078 is approved.
2. **Weights (Q4).** On templates Anvil proposes, Praxis requires every criterion weight above 0, at most two
   decimals, and an exact total of 100 (10,000 basis points). Templates not proposed by Anvil are not exported on the
   generic path until they meet the same rule.
3. **5/2/0 anchors (Q4).** On templates Anvil proposes, every criterion states full credit (pass condition), partial
   credit and fail. Scores are fixed at 5, 2 and 0.
4. **One Anvil project per environment** receives all Praxis exports. Praxis's export base address is that project's
   `/dataset-exports/generic` path.

Q5 (revocation) is accepted as answered: keep authoring, flag pinned projects, never rewrite results.

## 2. Compatibility points to settle

| # | Topic | Anvil answer | Praxis today | Praxis proposal |
| --- | --- | --- | --- | --- |
| 1 | Generic paths (Q3) | `/projects/{project}/dataset-exports/generic/{contracts,validate,resolve}`; root contracts advertise them | Client calls `/contracts`, `/validate`, `/resolve` under one configured base | **Compatible.** Base = the generic path. Praxis does not need the root advertisement. Generic support is detected by the exact ID `praxis.authored-task-export.v1` in the contract list, never a similar name |
| 2 | `valid:null` (Q6) | `valid:null`, `status=validation_blocked` for unknown contract or template; `valid:true` + `AV_TEMPLATE_NOT_QUALIFIED` for registered, unqualified templates | Any non-boolean `valid` is "not validated"; a task is valid only when Anvil returns `true`; package validity and Anvil readiness are shown apart | **Compatible.** `validation_blocked` shows as "not validated by Anvil" with the requirement; `valid:true` with an `AV_*` requirement shows as "package valid, not Anvil-ready" |
| 3 | Template-spec shape (Q1) | `praxis.anvil.template-spec.v1` with parts `authoring`, `execution`, `skills` and metadata (template ID, version, requirement reference) | `praxis.template_spec.v1-proposed` with `requirement`, `pack` (a golden pack), `execution`, `skills` | Praxis adopts Anvil's schema ID and part names. `authoring` = `{ profile, template?, examples? }`, where `profile` is `praxis.template_profile.v1`, `template` describes a new workflow (name, skills, TPT) and `examples` are worked examples. Praxis publishes `authoring.schema.json` under its `/contracts` |
| 4 | Stable template ID (Q1) | Metadata holds a stable template ID | Praxis creates the template UUID when the proposal arrives | Anvil sends its own `anvil_template_key`; Praxis returns `template_id` and `version`. Both appear in receipts |
| 5 | Version hash (Q1, Q2) | One whole-spec hash plus a hash per part | sha256 of RFC 8785 JSON over workflow name, version, form, execution and skills; no part hashes | Whole-spec hash = JCS SHA-256 of `{schemaVersion, anvil_template_key, template_id, version, requirement, authoring, execution, skills}` after Admin publication. Part hashes = JCS SHA-256 of each part. Praxis returns all of them from `GET /proposals/{id}`. Please confirm the exact object |
| 6 | JSON input rules (Q2) | Reject duplicate keys, NaN/Infinity, invalid Unicode | The JSON parser keeps the last duplicate key; lone surrogates are not rejected | Praxis will reject duplicate keys and invalid Unicode in template-API requests before hashing |
| 7 | Evaluator version (Q4) | Kind **and** version per criterion | Kind only | Praxis adds an evaluator version to each criterion, chosen from the catalogue entry |
| 8 | Revocation event (Q5) | Receipt ID and hash, template hash, reason, sequence | Endpoint takes receipt ID, template hash, status and receipt body; no reason or sequence; revocation shows on the template page only | Praxis adds `reason`, `receipt_hash` and `sequence`, ignores an older sequence idempotently, and flags every project pinned to the revoked version |
| 9 | Template API error codes | — | Praxis also returns `TP_SCHEMA_VERSION`, `TP_SPEC_SHAPE`, `TP_FORM_INVALID`, `TP_FORM_ID_TAKEN`; it does not yet return `TP_SECTION_MISSING`, `TP_PRIVATE_FIELD_EXPOSED`, `TP_CAPABILITY_UNKNOWN` | Praxis publishes the exact code list under its `/contracts`. `TP_CAPABILITY_UNKNOWN` starts once Anvil's catalogue is published |
| 10 | Package limits (Q8) | 1 MiB compressed, 30 MiB expanded, 10 MiB per file, 1,200 files, ≤200 tasks; batch ID with index and count | Client rejects over 1 MiB; package builder not built | Praxis's builder splits on every limit and reads the enforced limits from `/contracts` rather than hard-coding them |

## 3. Questions for Anvil

1. Please confirm the whole-spec hash object in point 5, and whether the requirement reference is inside it.
2. Please confirm `authoring` may carry `template` and `examples` beside `profile` (point 3).
3. Where does `/contracts` publish the capability catalogue entries and the evaluator versions Praxis should offer?
4. Does a revocation event arrive only on Praxis's `POST /qualifications`, or also through a feed Praxis should poll?
