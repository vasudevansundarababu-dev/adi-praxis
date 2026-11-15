# Proposed change for RL Gym: policy rule annotations (`praxis.anvil.project_policy_annotations.v1`)

| Item | Value |
| --- | --- |
| Status | **Proposed. Not released until RL Gym agrees in writing.** The owner sends this note. |
| From | Authoring (Praxis), 15 Nov 2026 |
| Source spec | [PRD-POLICY-RULE-ANNOTATIONS.md](../prd/PRD-POLICY-RULE-ANNOTATIONS.md) §6–§7; plan [PLAN-POLICY-RULE-ANNOTATIONS.md](../plan/PLAN-POLICY-RULE-ANNOTATIONS.md) §1–§2 |
| Schema | [`contracts/praxis/project-policy-annotations-v1/schema.json`](../../contracts/praxis/project-policy-annotations-v1/schema.json) (generated from `packages/shared/src/policy-annotations-export.ts`) |
| Compatibility | **Additive. `praxis.anvil.project_policy.v1` is unchanged, byte for byte.** |

## Why

Your review of the 318 extracted KYC rules on project 7e5e96c5 found that every rule said `required: true` and that the
applied set did not match the mandatory rules. Authoring now records, per rule, an editable classification and
mandatory marking (an AI suggestion that a PM or Admin edits and approves by applying the rule), with applicability,
relationships and provenance. This note proposes how those annotations reach you.

The v1 manifest cannot carry them: every object in its schema has `additionalProperties: false`, there is no metadata
extension, and your parser is strict. So this is a separate, versioned document.

## What changes for you

Nothing, unless you opt in.

- `GET /api/v1/projects/:id/anvil/project-policy` and `/sources/<path>`: the same bytes, headers, authentication, audit
  and 409 behaviour as today. `severity` stays `high` for every rule.
- **New:** `GET /api/v1/projects/:id/anvil/project-policy/annotations`, with the same access (your tenant's `RL_GYM`
  key; Admin; the owning PM), the same 401/403/404 rules, and audit events `anvil.project_policy_annotations_exported` /
  `…_blocked`. It refuses with 409 `PROJECT_POLICY_INVALID` (with `details.problems`) whenever the manifest itself would
  be refused, or when the document would not validate.
  - Headers: `x-praxis-schema-version: praxis.anvil.project_policy_annotations.v1`, `x-praxis-annotations-sha256` (the
    sha256 of the body) and `x-praxis-manifest-sha256`, which equals the manifest's own header. Fetch both and check
    they match: that binds the annotations to the exact manifest bytes you imported.

## Shape (one entry per manifest rule, nothing else)

Keyed by the manifest's `(policy_id, version, rule_id)`, as `policy_id`, `policy_version` and `rule_id`.

| Group | Fields |
| --- | --- |
| `identity` | `praxis_rule_id`, `rule_key`, `rule_version_id`, `rule_version`, `content_hash`, `project_rule_set {id, version, digest}`. The document also has top-level `source_project {id, version}` (the manifest's) and `template {id, version}`. |
| `source` | `document_id`, `document_version_id`, `document_version`, `sha256`, `quotation` (verbatim), `quotation_verified`, `locator {page, section, line_start, line_end}`, `source_location` (as in v1) |
| `meaning` | `requirement`, `classification`: obligation, prohibition, permission, definition, applicability_precedence, unresolved |
| `mandatory` | `marking`: mandatory, mandatory_when_applicable, permitted_option, required_reference, other_responsibility, needs_clarification; `explanation` |
| `applicability` | `responsible_actor` (agent, human_officer, bank_operations, task_author, customer, other, unknown), `actor_note`, `actors_as_extracted`, `application_types` and `jurisdictions` as `{kind: all / listed / unknown, items}`, `applies_when`, `prerequisites`, `workflow_stage`, `effective {from, to, condition}` |
| `exceptions_timing` | `exceptions {kind: none / unknown / listed, items}`, `deadline {kind: none / unknown / stated, text, measured_from}` |
| `relationships` | `links` and `linked_from`, each resolved to the linked rule's manifest `rule_id` and exact `rule_version_id` in the **same** published set (`status: in_set / not_in_set`); `compound {group_key, original_statement, role, members}`; `precedence` |
| `evidence` | `known`, `status: stated / partly_stated / unknown`, `missing` |
| `uncertainty` | `open_questions`, `notes`, `unresolved_dependencies`, `duplicates_or_overlaps` |
| `provenance` | `ai_suggestion` (the AI's annotation, model, prompt version, time; null if none), `current` (annotation version, `source: ai_suggestion_unedited / author_edit`, `edited_by {id, role}`, time), `approval {status: applied, decided_by {id, role}, decided_at, decided_by_human: true}` |
| `readable_text` | One plain-English paragraph built from the fields above |

`annotation_status: not_annotated` means the rule was applied without an annotation: treat every annotation field as
unknown. People appear only as opaque user IDs and a role (Admin or PM), never as names or emails.

## Interpretation (spec §7)

The annotations support binding policy rules to evaluators. They do not show that an evaluator is installed,
calibrated or qualified. Praxis's reference reading, also in `packages/shared` as `ruleApplicability`, gives one of five
outcomes per application (`interpretation.outcomes`):

| Outcome | When | You should be able to report |
| --- | --- | --- |
| `applies` | marking mandatory or required_reference, in scope | A mandatory rule that applies |
| `trigger_to_check` | mandatory_when_applicable or permitted_option, in scope | A conditional rule whose trigger is not met, or a permitted option that was not chosen: **not a failure, and not a pass of the companion condition** |
| `other_role` | other_responsibility | A duty of another role (the bank's obligation is not optional) |
| `out_of_scope` | the application's type or governing state is outside a **listed** scope, or the date is outside the effective dates | Not applicable |
| `unknown` | any scope field `unknown`, missing application facts, or needs_clarification | **Unknown applicability. Never "Not applicable", never a pass.** |

Independently of the outcome, a rule with `evidence.status` other than `stated`, or with `unresolved_dependencies`,
cannot yet be evaluated, and must not be scored as passed.

Scope comes from the application only: its type (KYC v7 case selector) and governing state. Federal (`US`) rules apply
to every state, and state rules (`US-XX`) to that state only. A project name or an example state never excludes a
rule. For example, a California Joint application gets the Joint rules and the California rules even when the
project's worked examples use New York.

A human-officer duty stays with the human officer. Never treat it as permission for the agent to approve.

## Safety

- The document quotes source text and includes evaluator-only rules. It is evaluator-side only: never show it to agents.
- `provenance.approval` is the human PM/Admin decision to apply that rule version. An AI suggestion is never an
  approval, and only applied, published rule versions appear.
- Content is synthetic.

## What we need from RL Gym

1. Agreement to this additive document (or a request for changes) before Praxis releases it.
2. Confirmation that the five outcomes map onto your evaluation states as described above.
3. Whether you want `severity` in v1 derived from the marking in a later, versioned change. Praxis keeps `high` until
   you ask.
