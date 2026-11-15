# Plan: policy rule classification, mandatory marking and editable annotations

| Item | Value |
| --- | --- |
| Status | **Draft, waiting for the owner.** Nothing is built until the owner confirms (CLAUDE.md, "How to work" 2). |
| Implements | [PRD-POLICY-RULE-ANNOTATIONS.md](../prd/PRD-POLICY-RULE-ANNOTATIONS.md) (owner spec, 15 Nov 2026, copied unchanged) |
| Builds on | [PRD-POLICY-RULES.md](../prd/PRD-POLICY-RULES.md), [PLAN-POLICY-RULES.md](PLAN-POLICY-RULES.md), [ANVIL-PROJECT-POLICY-V1.md](../integrations/ANVIL-PROJECT-POLICY-V1.md) |
| Branch | `claude/policy-rule-annotations-3ca355` (draft PR). No merge or deploy from this branch. |
| Reference data | RL Gym review of project 7e5e96c5 (318 rules, 7 categories, 5 SME questions); synthetic policy texts `00-US-federal` … `05-IL` |
| Prepared | 15 Nov 2026 |

## 0. What the code does today (the starting point)

- **Rules.** `PolicyRule` holds `ruleKey`, `sourceKey` and a `required` boolean that defaults to `true`. That is why all
  318 rules on 7e5e96c5 say `required: true`. `PolicyRuleVersion.body` is `PolicyRuleBody` (`packages/shared/src/policy.ts`):
  `requirement`, `requirementType` (obligation, prohibition, permission, definition, unknown), `applicability` (actors,
  actions, entities, channels, locales, jurisdictions, `conditionText`, `universal`), `prerequisites`, `precedence`
  (`overrides`, `overridden_by`, `requires_before`), `exceptions` (`none`, `unknown` or `listed`), `effective`,
  `evidenceNeeds`, `verificationHint` and `uncertainty`. `PolicyCitation` keeps the verbatim quote, a locator (page,
  lines, section, characters) and whether Praxis found the quote in the document (`resolution`).
- **Versioning and approval.** A Draft or Needs definition version is edited in place. A Reviewed or Excluded version is
  immutable (database trigger), so editing it creates a new Draft version. "Apply to project" (PM/Admin) **is** the
  review: it marks the latest version Reviewed. Publishing freezes the Reviewed versions into an append-only
  `ProjectRuleSet` (content + digest). Every step is audited, guarded by `expectedContentHash`, and idempotent.
- **AI.** Extraction (LlamaExtract, or Google) splits compound rules into separate atomic rules with nothing linking
  them. "Suggest" marks rules that match the PM's prompt (not stored). "Define with AI" rewrites a draft's body in place,
  so the AI's first answer is lost as soon as anyone edits it.
- **Export to RL Gym.** Rules reach RL Gym only through the project policy manifest
  `praxis.anvil.project_policy.v1` (`GET /projects/:id/anvil/project-policy`, pull, Admin / owning PM / `RL_GYM` key).
  Per rule it carries `rule_id`, `requirement`, `source_location` (a locator, never the quote), `severity` (always
  `high`) and `visibility`. The task package `praxis.authored-task-export.v1` does not carry project rules. The task
  policy snapshot sidecar `praxis.anvil.policy.v1-proposed` was never agreed with RL Gym.
- **No extension slot.** Every object in the v1 manifest schema (`contracts/anvil/project-policy-v1/schema.json`) has
  `additionalProperties: false`, and RL Gym parses it with a strict model. **There is no supported metadata extension**,
  so none of the new annotation fields can be added to v1 without breaking RL Gym's import.

## 1. Export field mapping (spec section 6)

Key: **S** = already supported by the v1 manifest. **E** = no extension slot exists, so it goes in the proposed
annotations document (section 2). **N** = new data that Praxis must also start storing.

| Spec group | Field | v1 manifest today | Plan |
| --- | --- | --- | --- |
| Identity | Stable rule ID | **S** `rules[].rule_id` (rule key) | Unchanged; the annotations document also keys on it |
| | Rule version | Only implied by `policies[].version` = `rs<set>.d<doc>` | **E** `rule_version_id`, `version`, `content_hash` |
| | Project / template IDs | **S** `source_project.id` (project); template not present | **E** template ID + version from the project's template |
| Source | Policy document ID / version / hash | **S** `policies[].policy_id`, `sources[].id`, `sources[].sha256` | Unchanged; repeated in **E** for one-step lookup |
| | Supporting quotation | Deliberately not exported | **E** `source.quotation` (verbatim, never edited) |
| | Page / section locator | **S** `source_location` (text) | **E** also as structured `{page, section, line_start, line_end}` |
| Meaning | Rule text | **S** `requirement` | Unchanged |
| | Classification | Not exported (`requirementType` exists in Praxis) | **E** + **N**: six values (section 3.1) |
| Mandatory annotation | Marking | Not exported (`required` boolean, not exported) | **E** + **N**: six markings |
| | Plain-English explanation | — | **E** + **N** `why` |
| Applicability | Actor | Praxis has free-text `actors` | **E** + **N** responsible actor type + note |
| | Application / product types | — | **E** + **N** (KYC: individual, adult_joint, teen_joint, custodial) |
| | Jurisdictions | Praxis has `jurisdictions` | **E**, as all / listed / unknown |
| | Trigger | Praxis has `conditionText` | **E** "applies when" |
| | Prerequisites | Praxis has `prerequisites` | **E** |
| | Workflow stage | — | **E** + **N** |
| | Effective dates | Praxis has `effective` | **E** |
| Exceptions / timing | Exceptions | Praxis has `exceptions` (none, unknown, listed) | **E** |
| | Deadline and the event it is measured from | — | **E** + **N** `{kind: none / unknown / stated, text, measured_from}` |
| Relationships | Referenced policies / rules and their versions | Praxis has `precedence` by rule key only | **E** + **N** links resolved to the exact rule versions in the same published set |
| | Compound-rule relationships | — | **E** + **N** compound group + original statement + component role |
| | Precedence | Praxis has `precedence` | **E** |
| Evidence | Known evidence requirements | Praxis has `evidenceNeeds` | **E** |
| | Missing requirements stated explicitly | — | **E** + **N** `evidence.status: stated / partly_stated / unknown` + `missing[]` |
| Uncertainty | Unresolved questions, conflicts, dependencies | Praxis has `uncertainty`; conflicts are computed at preview | **E** + **N** open questions + computed conflicts + unresolved links |
| Provenance | Original AI suggestion | — (overwritten today) | **E** + **N** append-only AI revision (section 3.3) |
| | Current edited annotation + annotation version | — | **E** + **N** |
| | Editor identity and timestamp | — | **E** + **N** opaque user ID + role + time (never name or email) |
| | Existing approval status | Implied (only applied rules are in the manifest) | **E** `approval: {status: "applied", by (opaque), at}`, labelled human |
| — | Readable text | — | **E** one plain-English paragraph per rule, generated from the structured fields (no model call) |

**Result:** 5 of the 29 rows above are in v1 today (rule ID, project ID, document ID/version/hash, locator text,
rule text). Everything else needs either the new annotations document or a v2 manifest.

## 2. Compatibility impact on RL Gym and the proposed change

**Recommended: an additive, separately versioned annotations document. The v1 manifest is left byte-for-byte unchanged.**

- New schema `praxis.anvil.project_policy_annotations.v1` with a JSON Schema in `contracts/praxis/` and an RL Gym change
  note in `docs/anvil/`. Status **proposed** until RL Gym agrees in writing.
- New endpoint `GET /api/v1/projects/:id/anvil/project-policy/annotations`. It has the same authentication as the
  manifest (Admin, owning PM, tenant `RL_GYM` key), the same 403/404 rules, the same audit pattern
  (`anvil.project_policy_annotations_exported` / `…_blocked`) and the same validate-before-answering 409 rule.
  Headers: `x-praxis-schema-version`, `x-praxis-annotations-sha256`, and `x-praxis-manifest-sha256`, which binds the
  document to the exact manifest it annotates.
- Shape: `{schema_version, source_project: {id, version}, manifest_sha256, rules: [{policy_id, policy_version, rule_id,
  identity, source, meaning, mandatory, applicability, exceptions_timing, relationships, evidence, uncertainty,
  provenance, readable_text}]}`. It has exactly one entry per `(policy_id, version, rule_id)` in the manifest and nothing
  else. All of it is evaluator-side: RL Gym must never show it to agents. It quotes source text, which the v1 manifest
  deliberately avoids.
- Built **only from the published `ProjectRuleSet` content** (frozen at publication), never from live drafts. That
  meets AC10 ("exact approved rule and annotation versions") and keeps AI suggestions and unapproved edits out.
- **Impact on RL Gym today: none.** v1 bytes, the `source_project.version` hash, rule IDs, the endpoints, auth, audit
  and receipts are unchanged. Existing importers keep working. RL Gym opts in by fetching the new document.
- **Caveat for RL Gym, in the change note:** until they consume the annotations, v1 still lists every applied rule with
  `severity: high`. Their v1 import must not read "listed" as "mandatory". This is already true today (12 of the 27
  applied rules on 7e5e96c5 are permitted options), so it is not a new risk.
- RL Gym interpretation (spec section 7) is written into the change note as a vocabulary they can map to their own
  states: `mandatory` + trigger met → applies; `mandatory_when_applicable` + trigger not met → not triggered (never a
  pass); `permitted_option` not chosen → no finding; `other_responsibility` → duty of another role; any applicability
  field `unknown` → unknown (never "Not applicable"); `evidence.status != stated` or `uncertainty.unresolved_dependencies`
  non-empty → cannot evaluate yet. Praxis states that annotations do not prove an evaluator is installed, calibrated or
  qualified.

**Alternative (not recommended): `praxis.anvil.project_policy.v2`** with the annotations inside each rule. This breaks
RL Gym's strict v1 parser, forces a coordinated release on both sides, and changes the content-addressed project
version. It only makes sense if RL Gym prefers one document.

Either way, nothing is released to RL Gym until the owner sends the change note and RL Gym agrees (spec section 6). The
endpoint can be built and tested behind the "proposed" status in the meantime.

Unchanged and out of scope: `praxis.authored-task-export.v1` task packages, `praxis.anvil.export.v1` envelopes, and the
never-agreed task snapshot sidecar `praxis.anvil.policy.v1-proposed`.

## 3. Data model change

One additive migration. No existing column is dropped and no existing body changes.

### 3.1 The annotation lives in the rule version body, so existing versioning and approval cover it

`PolicyRuleBody` gets an **optional** `annotation` object (absent = not annotated yet). Because it is part of the body:

- it is part of `contentHash`, so the stale-edit 409 protects it;
- editing the annotation of an applied (Reviewed) rule creates a new Draft version that must be ticked again, exactly
  like any other edit (spec section 6: an edited annotation follows the existing versioning and approval rules);
- it is frozen into `ProjectRuleSet.content` at publication, so the export reads the exact approved annotation.

The field is optional, not defaulted, so every existing rule version, content hash and published digest stays exactly
the same (`stableStringify` drops `undefined`). Nothing is republished by accident.

`annotation` fields. Each "unknown" is explicit, never an empty list that could be read as "none":

| Field | Values |
| --- | --- |
| `classification` | `obligation`, `prohibition`, `permission`, `definition`, `applicability_precedence`, `unresolved` |
| `marking` | `mandatory`, `mandatory_when_applicable`, `permitted_option`, `required_reference`, `other_responsibility`, `needs_clarification` |
| `appliesWhen` | Text, or `null` = unknown. "Always, within the workflow scope" is an explicit value. |
| `why` | Plain-English explanation |
| `responsibleActor` | `agent`, `human_officer`, `bank_operations`, `task_author`, `customer`, `other`, `unknown`, plus a note |
| `applicationTypes` | `{kind: all / listed / unknown, items}`. For KYC v7 the items come from the template's case-selector values. |
| `jurisdictions` | `{kind: all / listed / unknown, items}` (e.g. `US`, `US-CA`) |
| `workflowStage` | Text or `null` |
| `deadline` | `{kind: none / unknown / stated, text, measuredFrom}` |
| `evidence` | `{status: stated / partly_stated / unknown, missing[]}` (the known items stay in `evidenceNeeds`) |
| `links` | `[{ruleKey, relation}]`. Relation is one of `companion_of`, `condition_of`, `uses_definition`, `defines_threshold_for`, `exception_to`, `references`, `duplicate_of`, `overlaps`. |
| `compound` | `{groupKey, originalStatement, role}` or `null` |
| `openQuestions` | List of text |
| `version` | The annotation version (section 3.3) |

Already in the body and reused, not duplicated: trigger detail (`applicability.conditionText`), `prerequisites`,
`exceptions`, `effective`, `precedence`, `evidenceNeeds`, `uncertainty`. The editor shows them in the annotation panel.

`classification` replaces `requirementType` as the source of truth. On save they are kept in sync, and
`applicability_precedence` / `unresolved` map to the old `definition` / `unknown`, so the snapshot sidecar and the AI
prompts that read `requirementType` keep working.

### 3.2 The `required` flag

`PolicyRule.required` is retired from use. The column stays (no destructive migration), but no screen shows it, nothing
writes it, and the "Required policy" checkbox in Mark Reviewed is removed. The API still accepts the `required` field
from an older client and ignores it, logged as deprecated. Preview counts become counts per marking.

### 3.3 Original AI suggestion kept apart from author edits

New table `PolicyRuleAnnotationRevision`, **append-only** (UPDATE/DELETE trigger, like `PolicyRuleVersion`):

| Column | Meaning |
| --- | --- |
| `ruleId`, `ruleVersionId` | The rule and the version it was written on |
| `annotationVersion` | Per-rule counter (1, 2, 3, …). It is the `annotation.version` in the body. |
| `source` | `AI_SUGGESTION` or `AUTHOR_EDIT` |
| `annotation` | The full annotation as saved |
| `model`, `promptVersion` | For AI rows only |
| `editedById`, `createdAt` | Who and when (the AI rows record the user who asked for the suggestion) |
| `basedOnRevisionId` | The revision it was edited from |

- The AI's answer is written once as an `AI_SUGGESTION` row and also becomes the body's annotation, unless an author has
  already edited the rule. In that case the AI answer is only offered next to the author's version and never replaces it.
- Every author save writes an `AUTHOR_EDIT` row. The source quotation (`PolicyCitation`) is never touched by an
  annotation edit.
- At publication, `publishRuleSet` freezes into each rule's set entry `annotationProvenance`: the latest AI suggestion,
  the current annotation's revision (version, editor, time) and the approval (applier, time). The export reads only
  this. Existing sets have no such field and still parse; their digests are unchanged.

### 3.4 Compound statements and linked components

- Extraction still produces atomic rules. The annotation pass (section 4) groups the components of one statement under
  a `compound.groupKey`. It keeps the `originalStatement` verbatim (it must match a resolved citation quote) and gives
  each component a role, e.g. "permission" plus "companion obligation when this route is chosen".
- Links are by `ruleKey` in the body (keys are stable per project). At publication each link is resolved to the exact
  `ruleVersionId` and version in the same set. A link to a rule that is not applied, or not in the project, becomes an
  **unresolved dependency**: it is flagged on the Rules page and the preview, and exported under `uncertainty`.
- A definition with a binding threshold carries `defines_threshold_for` links, and each dependent rule carries the
  reverse `uses_definition` link. Both are kept in sync on save (AC5).
- Duplicates and overlaps (`duplicate_of`, `overlaps`) are flagged, never merged silently. The preview shows them so
  that applying both is a visible choice, not a hidden double count.

## 4. Where the AI suggestion comes from

- **After each extraction finishes**, a BullMQ job (`policy-annotate`) sends the document text and its extracted rules
  in batches (about 25 rules per call) to the existing rule assistant. The Vertex model is the one the project's QA
  already uses; tests use a mock only. The prompt says to classify by meaning and context, never by keywords. It spells
  out the "may … only with", "must … unless", "must not", "may not" and "should" cases from the spec, and says to leave a
  field unknown rather than invent a condition, deadline or exception. Seeing the whole batch lets it link compound
  components and thresholds.
- Output is validated with Zod. Any `originalStatement` that Praxis cannot find word for word in the document is
  dropped (the same quote check as Define with AI). Each result is stored as an `AI_SUGGESTION` revision. Audit:
  `policy.rule_annotations_suggested` (model, document, counts).
- **For existing rules** (e.g. the 318 on 7e5e96c5): a "Suggest annotations" button on the Rules page runs the same job
  for one document. It is rate-limited and inside the AI cap (`checkAiCap`). On an applied rule the suggestion is only
  offered: accepting it creates a new Draft version, which the PM must tick again.
- **"Define with AI"** also returns the annotation in the same call, saved as an AI revision.
- A failed or capped run leaves rules "Not annotated", with a retry. It never blocks extraction or the Rules page.
- **What the AI cannot do** (unchanged): review, apply, exclude or publish. The PM/Admin tick is still the only decision.
  The UI labels unedited AI annotations "AI suggestion" and never presents them as approved.

## 5. Rules page and editor (existing navigation)

- **Rules table.** The "Required" column is replaced by **Mandatory marking**, **Applies when** and **Why** (AC6), each
  with an "AI suggestion" or "Edited by <role>, v<n>" badge. A flags chip lists missing details (unknown fields),
  conflicts, unresolved links and duplicates (AC8). Marking can be changed inline (a select). Saving it is an ordinary
  rule edit through `PUT /policy/rules/:ruleId`, so it gets a new version if the rule is applied. A filter by marking
  and by flag is added.
- **Rule editor** (`rule-review.tsx` / rule detail). New "Annotation" section with classification, marking, responsible
  actor, application types, jurisdictions, applies when, prerequisites, exceptions, workflow stage, deadline and its
  starting event, effective dates, why, links and open questions. Each field has an explicit "Unknown" choice. The
  editor shows the supporting passage with page/section (already there). A new **History** panel shows each annotation
  revision (AI or author, editor role, time, version) and the original AI suggestion next to the current one (AC7).
- **Publish preview.** Counts per marking. New **non-blocking** warnings for applied rules that are not annotated,
  marked "needs clarification", have unresolved links, or are duplicates. Existing blocking rules are unchanged.
- Public text never says ADI-Labs, Praxis or Anvil; the export is called "RL Gym".

## 6. Applicability per application (spec section 5, AC9)

Praxis does not run applications; RL Gym does. Praxis's part:

1. Store scope as data (`applicationTypes`, `jurisdictions`, trigger), not as a project name or example state. Nothing
   in the annotation pass, the Rules page or the export reads the project name, `S1.exampleGoverningState` or the
   `coverage.example_governing_state` package field to decide which rules apply.
2. A pure, shared function `ruleApplicability(annotation, case)` with `case = {applicationType, governingState,
   asOfDate}` returns one of `applies`, `trigger_to_check`, `out_of_scope`, `other_role` or `unknown`. It combines
   federal (`US`) and state (`US-XX`) scope, never returns `out_of_scope` from an unknown field, and is documented in the
   RL Gym change note as the reference interpretation. It is used for the Rules page filter "Show rules for: <type> /
   <state>", which lets an author check a California Joint case on a project whose examples use New York.
3. Human-officer, bank-operations and task-author duties keep their actor type in the export. The prompt and the docs
   say that a human approval duty is never turned into permission for the agent to approve.

## 7. Acceptance criteria → tests (all with mocks; no live model calls)

| AC | Test |
| --- | --- |
| 1 | Mocked annotation pass on "The bank may accept a passport…" → `permission` / `permitted_option`, never `mandatory`. Plus a prompt-content test that the keyword rules are stated. |
| 2 | "May accept a foreign passport only with a non-documentary check" → two components in one compound group (permission + `mandatory_when_applicable` companion), linked both ways, original statement kept and quote-verified. |
| 3 | "Must … unless …" → obligation with `exceptions.kind = listed`; both survive save, apply, publish and export. |
| 4 | "Must not …" → prohibition, kept through edit, publish and export; "may not" is not mapped to permission without context (the mock returns `unresolved`, which is kept). |
| 5 | A threshold definition and its dependent rules keep reciprocal links; unapplying the definition flags the dependants as having an unresolved dependency. |
| 6 | Web: every row shows editable Mandatory marking, Applies when and Why (and "Not annotated" with a suggest action when absent). |
| 7 | API: an author edit keeps the citation quote unchanged, appends an `AUTHOR_EDIT` revision, keeps the `AI_SUGGESTION` row; the revision table rejects UPDATE/DELETE (DB trigger test); History shows both. |
| 8 | Unknown fields, conflicts, unresolved links and duplicates appear as flags on the table and in the preview. |
| 9 | `ruleApplicability`: a CA rule + Joint scope applies to a California `adult_joint` case even when the project's example state is NY; federal rules apply to both; unknown scope gives `unknown`, never `out_of_scope`. |
| 10 | Publish then export: the annotations document has exactly the published `ruleVersionId`, `contentHash`, annotation version, source hash, quote, locator and resolved links. A later draft edit does not change it until it is re-applied and republished. |
| 11 | The v1 manifest bytes for a fixture project are identical before and after the change (golden test); the new endpoint has the same 401/403/404 rules, `RL_GYM` key access, audit events and 409-on-invalid; publication idempotency and stale 409 are unchanged. |
| 12 | No new state, role check or endpoint is required between Apply and publish. Applying works with any marking, including unannotated rules. Existing apply/publish tests pass unchanged. |

Plus: schema validation of the annotations document against its JSON Schema, the Atlas review mapped onto fixtures
(the seven categories → the six markings, below) as a regression set, and the audit/idempotency tests for the new
routes.

Mapping used for fixtures (and for any later import, if wanted): CORE_MANDATORY → mandatory; CONDITIONAL_MANDATORY →
mandatory when applicable; PERMITTED_OPTION → permitted option; REQUIRED_POLICY_REFERENCE → required reference;
AUTHORING_GOVERNANCE → other responsibility (actor: task author); BANK_OPERATIONS_OR_OTHER_PRODUCT → other
responsibility; SME_CLARIFICATION_REQUIRED → needs clarification.

## 8. Build order (after confirmation)

1. Shared schema (annotation, classification, markings, `ruleApplicability`) and the migration (revision table + trigger).
2. API: save annotations through `editRule`, revisions, the annotation job and the Suggest/Define changes, preview flags,
   provenance frozen at publication.
3. Web: table columns, inline marking, editor section, History panel, preview warnings, applicability filter.
4. Export: annotations document, JSON Schema, endpoint, RL Gym change note (proposed).
5. Docs: DECISIONS.md entries, user guide page, ARCHITECTURE notes.

Each step ends with typecheck and tests green and is committed separately.

## 9. Assumptions (decided by default; say if any is wrong)

- A1. "Apply to project" keeps its meaning: include this rule version, with its annotation, in the published set. It no
  longer implies "mandatory". Permitted options, references and other-role duties can be applied so that RL Gym can see
  them; the marking says how to treat each one.
- A2. Editor identity is exported as an opaque user ID plus role, never a name or email (the same rule as the task
  package's opaque review receipt).
- A3. `severity` in the v1 manifest stays `high` for every rule. Deriving it from the marking would change v1 bytes and
  meaning.
- A4. The new preview checks warn and do not block, so no new gate is added (AC12). Existing blockers stay.
- A5. An applied rule classified `unresolved` and marked `needs_clarification` is allowed to publish (as RL Gym asked:
  "do not silently omit"). Today `requirementType: unknown` blocks publication as "incomplete"; this is relaxed for that
  one combination only.
- A6. The RL Gym (Atlas) review is used only as a test fixture and regression set. It is not imported into QA as
  suggestions.
- A7. D6 (pick S4 policy references from the library) is not part of this work.
- A8. Application-type values come from the project template's case selector (KYC v7: individual, adult_joint,
  teen_joint, custodial). Other templates get free text.

## 10. Decisions needed from the owner

1. **Export contract.** Approve the additive `praxis.anvil.project_policy_annotations.v1` document (v1 manifest
   unchanged) rather than a v2 manifest. Then confirm who sends the RL Gym change note and that the endpoint ships as
   "proposed" until RL Gym agrees.
2. **Model calls for annotation.** Approve an automatic annotation pass after every extraction, plus a "Suggest
   annotations" button for existing documents. For 7e5e96c5 that is about 13 batched model calls for 318 rules, within
   the existing AI cap.
3. **Assumptions A1 and A5** change existing behaviour (what Apply means, and publishing an unresolved rule), so please
   confirm them explicitly.
