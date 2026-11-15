# Anvil project policy manifest v1 (`praxis.anvil.project_policy.v1`)

One manifest per Praxis project (= Anvil Task Group). It accompanies the unchanged `praxis.anvil.export.v1` task
exports (see [PRAXIS-ANVIL.md](PRAXIS-ANVIL.md)) and adds no fields to them. The contract is Anvil's, copied unchanged
into `contracts/anvil/project-policy-v1/` (`schema.json`, `README.md`, `example.json`). Mapping decisions and defaults:
`docs/DECISIONS.md`, section "Anvil project policy manifest v1 emitter (10 Nov 2026)".

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/v1/projects/:id/anvil/project-policy` | The manifest JSON (stable key order, so the same state gives the same bytes). Headers: `x-praxis-schema-version: praxis.anvil.project_policy.v1`, `x-praxis-manifest-sha256` (sha256 of the exact body). |
| `GET /api/v1/projects/:id/anvil/project-policy/sources/<path>` | The exact original bytes of one source declared in the manifest (`<path>` is its `path`, e.g. `policies/<document id>/v1.pdf`). Headers: `content-type` = its `media_type`, `x-praxis-source-sha256`, `x-praxis-manifest-sha256`. Any path not in the current manifest is 404. |

- **Access:** an Admin session (any project of the tenant), the project's owning PM, or the tenant's `RL_GYM` API key
  (`Authorization: Bearer …`). Other roles or client kinds: 403. Another PM's project or another tenant: 404.
- **Read-only and audited:** each export, source download and blocked attempt writes one audit event
  (`anvil.project_policy_exported`, `anvil.project_policy_source_downloaded`, `anvil.project_policy_blocked`).
- **Never invalid:** before answering, Praxis validates the manifest with `validateProjectPolicyManifest`
  (`packages/shared/src/anvil-project-policy.ts`): the schema, every semantic rule in Anvil's README, the source bytes,
  and each task binding against the real export envelope. On any problem it answers **409** `PROJECT_POLICY_INVALID`
  with `details.problems: [{ code, path, message }]` instead of a manifest. Emitter-only codes:
  `TASK_EXPORT_BLOCKED` (a record's own export is refused), `TASK_EXEMPTION_NOT_REPRESENTABLE`,
  `RULE_WITHOUT_SOURCE`, `UNSUPPORTED_INHERITANCE_MODE`, `SNAPSHOT_RULE_SET_MISSING`.
- Both routes are in the generated OpenAPI document (`/docs/json`, tag `anvil`).

## Field mapping

| Anvil field | Praxis source |
|---|---|
| `source_project.id` | Project UUID (equals `source.project_id` in the task export envelopes) |
| `source_project.version` | sha256 of the manifest content without this field (content-addressed) |
| `source_project.name` | Project name |
| `project_default_policy_refs` | Policies of the latest published `ProjectRuleSet` (inheritance mode `ALL_TASKS`) |
| `sources[].id` | `PolicyDocumentVersion.id` |
| `sources[].path` | `policies/<PolicyDocument.id>/v<version>.<pdf\|docx\|txt\|md>` |
| `sources[].media_type` | From the detected format (pdf, docx, txt, md); stored parameters such as `charset` are dropped |
| `sources[].size_bytes`, `sha256` | `PolicyDocumentVersion.sizeBytes`, `sha256` (checked against the stored bytes on every export) |
| `policies[].policy_id` | `PolicyDocument.id` |
| `policies[].version` | `rs<rule set version>.d<document version>` |
| `policies[].title` | `PolicyDocument.title` |
| `policies[].source_id` | The cited document version |
| `rules[].rule_id` | Rule key (e.g. `R-address_recency`), or `rule-<rule uuid>` if the key does not fit Anvil's id pattern |
| `rules[].requirement` | Reviewed rule version `requirement` text only |
| `rules[].source_location` | Locator of the requirement citation (document version, page, lines, section, characters); never quoted text |
| `rules[].severity` | Always `high` (Praxis has no severity) |
| `rules[].visibility` | `agent_visible` → `agent_instruction`, `evaluator_only` → `evaluator_only` |
| `rules[].rubric_criterion_ids`, `failure_mode_ids` | Omitted (no such link in Praxis) |
| `task_bindings[].task_id`, `task_version` | The record's executable contract |
| `task_bindings[].payload_sha256` | The record's `praxis.anvil.export.v1` `payload_sha256`, computed by the same code |
| `task_bindings[].policy_refs` | Policies of the rule set in the task's frozen policy snapshot (none if it had no snapshot) |
| `task_bindings[].excluded_project_policy_refs` | Every current default not in `policy_refs` (always present, may be empty) |

Only current (not superseded) approved records with an executable contract are bound. Drafts, unpublished rules,
excluded rules and SME task-source uploads never appear. Per-task clarifications and stricter constraints are not
represented (the task is bound to its base policies); an exemption blocks the export.

## What Anvil must still verify on import

Praxis validation is a pre-check; Anvil's import is the authority (README of the contract).

1. Parse the manifest bytes with its own duplicate-key-rejecting parser and its own `ProjectPolicyManifest` model.
2. Re-run every semantic check: unique ids, resolved references, default/exclusion completeness, portable paths, size
   limits (10 MiB per source, 25 MiB total, 2 MiB manifest).
3. Download each source and check its bytes against `size_bytes` and `sha256`; keep the original bytes separate from
   any extracted text. Declared media types do not establish that a file is safe.
4. Bind each task binding to the task export it actually imported: same `task_id`/`task_version`, and
   `payload_sha256` equal to that envelope's `payload_sha256` (which Anvil already verifies against `payload_json`).
   Check that `source_project.id` equals each envelope's `source.project_id`.
5. Persist policies by `policy_id` + `version` and refuse the same identity/version with different content; likewise
   decide how a re-import of the same `source_project` id with a new content-addressed `version` is handled.
6. Project only `agent_instruction` rule text and policy/rule identities to agents; never sources, `evaluator_only`
   rules or `source_location`.
7. Policy text and source provenance grant no permission; Anvil still owns verifier configuration, qualification and
   run authorisation.
