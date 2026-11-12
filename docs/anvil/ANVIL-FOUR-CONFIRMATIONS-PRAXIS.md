# Anvil's four confirmations: what Praxis built, and what is still incompatible

12 Nov 2026. This answers `Anvil-Praxis-four-confirmations-v1.md` (11 Nov 2026) and Anvil's generic export packet
`praxis-generic-v1`. All work is in Praxis only. There are no live calls, no credentials and no paid calls; tests use
mock transports.

## Built

| Confirmation | Praxis |
| --- | --- |
| 1. Whole-spec hash | `praxis.anvil.template-spec.v1` proposals are accepted alongside the earlier format. The parts are stored exactly as received. Praxis assigns `template_id` (the stable template lineage UUID) and the integer `version`. `GET /proposals/{id}` returns `template_spec`, `template_sha256`, `part_hashes` and `publication_status` (`candidate` / `published`) as separate fields. A joint template's qualification hash is `template_sha256`. RFC 8785 hashing reproduces Anvil's vector, Anvil's synthetic whole-spec hash and all three part hashes. |
| 2. Authoring wrapper | `authoring = {profile, template?, examples?}`. Praxis's authoring schema is published at `GET /integrations/anvil/templates/contracts` (`authoring_schema`). The form file in a package is `authoring.profile`, unchanged. |
| 3. Discovery and evaluators | Generic support means the exact ID is in `data.contracts` and `data.enabled` is true. Nothing else counts. Each criterion now records `evaluatorVersion` beside `evaluatorKind`. On a joint template, submission checks that every criterion uses the exact `(id, version)` its template maps to that criterion ID. Output checks must also name a declared output field and a private expected value, and at least one criterion must be critical. |
| 4. Revocation | `POST /integrations/anvil/templates/qualifications` accepts `{kind: "revocation", event, event_sha256}`. See "Revocation behaviour" below. |
| Package builder | Builds `praxis.authored-task-export.v1` ZIPs in the layout Anvil describes. Details under "Package builder" below. |
| Validate and resolve | On validate, a project sends its packages to Anvil's `/validate` and reports Anvil's verdict per task. On export, a valid package is also sent to `/resolve`. Details under "Validate and resolve" below. |

### Revocation behaviour

- **Checks:** Praxis verifies `event_sha256` (JCS of `event`) and the event schema.
- **Binding:** the event must match this environment's Anvil binding: `ANVIL_ENVIRONMENT` plus the project in `ANVIL_EXPORT_BASE_URL`. An unbound Praxis refuses revocations.
- **Template and receipt:** the template hash and the original receipt's `receipt_hash` must match.
- **Acknowledgement:** `{event_id, event_sha256, status: applied|already_applied, sequence}`.
- **Repeats and conflicts:**
  - A repeat is acknowledged and creates no new row.
  - The same event ID or the same sequence with other content is a 409 conflict.
  - An older event for an already revoked receipt never reopens it.
  - Sequences are compared per receipt.
- **Scope:** revoking an old receipt leaves an unrelated newer receipt standing.
- **Storage:** events are kept in the append-only `AnvilRevocationEvent` table.
- **Effects:** every project pinned to the version gets an audit entry. Authoring, history and scores are unchanged.

### Package builder

- **Files:**
  - `praxis-export.json`;
  - `forms/<profile>.json` (exactly `authoring.profile`);
  - `tasks/<task>/actor.json`, computed with Anvil's projection;
  - `private/<task>/reference.json` (`grader_only_reference_and_rubric`, `private_rubric`, complete authored record).
- **Format:** every file is RFC 8785 JSON. The ZIP is deterministic DEFLATE.
- **Manifest:** binds each task revision to the template UUID, integer version and whole hash.
- **Provenance:** review provenance is an opaque record reference, never a person.
- **Identifiers:** content-derived, so the same tasks always give the same package.
- **Splitting:** at most 200 tasks and under 1 MiB per part, with one batch ID, a consistent part count and unique indexes.
- **Verified against Anvil's fixture:** the actor file is identical to Anvil's. The form, private reference and template hashes match.

### Validate and resolve

- **Verdict per task:**
  - **PX errors** are attributed to the task their file or pointer names.
  - **AV requirements** are shown as Anvil's work, never as task repairs.
  - **`valid:null`** means not validated.
- **Resolve:**
  - A valid package is sent to `/resolve` with `Idempotency-Key: praxis-<package_sha256>`. A retry is the same request; changed content is a new one.
  - Resolution never claims a Run.
- **Records kept:**
  - Package IDs, hashes, Anvil statuses and request IDs are kept on the run (`ProjectValidationRun.anvil`).
  - Export ZIPs go to private storage.

## Still incompatible

These need a decision by Anvil (Keystone) or the owner. None is papered over in code.

1. **Graph schema ID.**
   - Praxis graphs are `praxis.workflow_graph.v1-proposed`. Anvil accepts only `praxis.workflow_graph.v1` and does not convert.
   - Every multi-agent task with a workflow therefore gets `PX_GRAPH_REFERENCE`. Multi-agent runtime is unqualified at Anvil anyway (`AV_GRAPH_RUNTIME_UNQUALIFIED`).
   - Fix: agree that `.v1` is final and Praxis renames, migrating stored outputs, or Anvil accepts the proposed ID.
2. **Private sub-fields of built-in items.**
   - Anvil's projection copies whole items of fields without `itemFields`. Praxis's built-in item fields keep some sub-fields private, for example a policy citation's `rationale`, `appliesTo` and `exception`.
   - Praxis refuses to send such a task (`GENERIC_PRIVATE_EXPOSURE`). Today every task that cites a policy is held back.
   - Fix options:
     - Anvil applies Praxis's built-in item visibility;
     - the published form declares S4 citations as a `repeated_array` with explicit `itemFields` (`rationale` marked private).
3. **Required-field conditions.**
   - Praxis forms may use `in`, `filled`, `unless` and sibling-relative fields. Anvil accepts only `{anyOf: [{field: "Sx.key", equals}]}`.
   - A form using the others is rejected by Anvil at registration.
4. **Recorded tool calls.**
   - Praxis stores recorded `arguments` and `response` as text. Anvil validates them against the tool's JSON schemas, so object schemas give `PX_TOOL_CALL_SCHEMA`.
   - Fix: Praxis structured recorded calls, or string schemas for now.
5. **Expected values are text.**
   - A criterion's private `expectedValue` is a text field. Number or boolean output fields cannot be matched.
6. **Per-template evaluator mapping vs per-task rubrics.**
   - Anvil maps evaluators by criterion ID in the template, while SMEs write criteria per task.
   - Authors must reuse the template's criterion IDs. Praxis now checks this at submission, but the form does not yet offer them as a pick list.
7. **Qualification receipt envelope.**
   - Anvil defined only the revocation envelope. Praxis accepts a joint qualification as `{template_id (stable), version, template_version_hash (= template_sha256), status, receipt_id, receipt}`.
   - `receipt_hash` in a later revocation is checked as the JCS SHA-256 of that `receipt` object. Anvil needs to confirm this.
8. **Duplicate JSON keys on inbound events** are not detected before parsing. A duplicated key still fails the `event_sha256` check unless both sides parse it the same way.
9. **Anvil's synthetic form is not a valid Praxis form.** It lacks `label` and `help`. Real proposals must follow Praxis's profile schema, which is published in the contracts.
10. **Not in this build:** Marketing Task2's 0–4 rubric and its `external_system` graph step. They are on an unmerged branch.

## Configuration (QA)

- **`ANVIL_ENVIRONMENT=qa`** is written by the deploy script.
- **Secrets:** `anvil-export-base-url` (the generic base URL, including the Anvil project UUID) and `anvil-export-token` must be created in QA Secret Manager before Praxis can call Anvil or accept revocations.
- **Without them** Praxis keeps its pre-check, marks tasks "not validated by Anvil" and refuses revocations with `ANVIL_STREAM_UNBOUND`.
