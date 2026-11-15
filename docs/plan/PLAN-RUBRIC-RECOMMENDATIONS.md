# Plan: simplified rubric editor with recommendations (combined: rubric recommendations, simplified editor, D8, D9)

| Item | Value |
| --- | --- |
| Status | **Plan only, awaiting the owner's approval.** No code yet. |
| Requirements | `docs/prd/PRD-RUBRIC-RECOMMENDATIONS.md` and `docs/prd/PRD-SIMPLIFIED-RUBRIC-EDITOR.md` (owner specs, 15 Nov 2026, verbatim). Section 14 reconciles them. |
| Mockup | `docs/design/mockups/rubric-editor.html` (**owner approval needed before any build**) |
| Related | QA defects D8 (S7 typed by hand), D9 (technical criterion fields typed with no source) and D6 (S4 picked from the policy library); policy rule annotations plan (PR #81) |
| Code baseline | `main` at `4b424b00` |
| Release boundary | Everything ships behind flags that are **off** by default. With the flags off, nothing changes for users, exports or the RL Gym QA deployment. |

Section 10 lists the decisions I took so we don't need a round of questions. Section 11 has the only two points where the owner might want to choose differently. Section 14 lists where the two specs, D8 and D9 conflict and what I decided. Section 15 maps the simplified-editor acceptance criteria to tests.

---

## 1. What the code does today (findings that shape the plan)

1. **The rubric is the S7 `criterion` field.** It's edited in the candidate app's sections form
   (`apps/candidate/components/work/profile-editor.tsx`, `ArrayControl`) with autosave and optimistic revision. The
   console shows it read-only (`apps/web/components/forge/task-page.tsx` `AuthoredForm`), and so does the external
   Reviewer page (`apps/candidate/components/forge/review-page.tsx`). PM/Admin decide in `DecisionBox`. There is no
   separate "Rubrics" screen. The criterion item fields are defined once in
   `packages/shared/src/template-profile/helpers.ts` (`itemFieldsOf`, case `criterion`): `id`, `name`, `weight`,
   `passCondition`, `partialCredit`/`failCondition` (5/2/0) or `level3..failCondition` (0–4), `group`, `critical`,
   `evidenceRefs`, `evaluatorKind`, `evaluatorVersion`, plus the output binding fields.
2. **Exports carry S7 verbatim.** The RL Gym package (`apps/api/src/anvil/generic-package.ts`) puts the whole
   `output.sections` of the approved record into `private/<task>/reference.json`, and the actor view drops `criterion`
   fields. `ApprovedTaskRecord.contentHash` is computed over `output`. **So any new key inside a criterion item,
   or anywhere in `output`, would change export bytes and record hashes.** All new information must live outside
   `TaskInstance.output`.
3. **KYC v7 (and v6) templates carry only the criterion IDs as data.** `execution.evaluators[]` maps 20 IDs
   (`identification_parties` … `state_instrument`) to `golden-kyc-rubric-v1`. Names, Pass/Partial/Fail text, Critical
   flags and the per-criterion weight are **not** structured template data: "weight 5 each, pass 5 / partial 2 /
   fail 0" is only in the S7 field's help text, and the scale comes from the field's `scale` (default `five_two_zero`).
   So D8's "template default" needs default data the template doesn't have yet (see section 8).
4. **Marketing has a different convention.** The S7 field has `scale: zero_to_four`, groups A–G with weights
   (`MARKETING_T2_GROUPS`), the B-group minimum, and critical failures as a separate S7 `criticalFailures`
   multi-select (CR-01 … CR-06). The execution v3 `rubric` descriptor is checked by `rubricDescriptorProblems`.
5. **Section numbers don't carry meaning across templates.** On v7, `profile.contract` points to the objective
   (`S1.businessContext`, `S1.deliverable`), the actor evidence (`S2.inputContract`) and the criteria (`S7.criteria`);
   `contract.policies` is null and S4 is a `repeated_array` (`statePolicies`), not `policy_citation`. Marketing and the
   registered KYC profile differ again. The task's real policy is the project's published rule set
   (`effectivePolicy`/`snapshotTask` in `apps/api/src/policy/task-policy.ts`), and multi-agent tasks have
   `output.workflowGraph` (roles, agent/human steps, handoffs).
6. **Submission checks** (`apps/api/src/tasks/submission.ts`) already require, on joint templates, an evaluator kind on
   each criterion and weights totalling 100. Export refuses a criterion with no evaluator mapping.
7. **An existing "AI suggests, human decides" pattern** to copy: `apps/api/src/policy/rule-assistant.ts` (interface +
   Vertex implementation + mock, model from config, suggestions stored, a person decides).

## 2. Where the UI lives: the simplified rubric editor

**Mockup for approval:** `docs/design/mockups/rubric-editor.html`. It's a clickable mockup on the KYC v7 Custodian
task, showing `identification_verification`, `revision_integrity` and `account_authority` plus one suggested
addition. The picker bar at the bottom jumps to each requested state.

No new screen and no new approval stage. The editor *is* S7 ("Rubric") in the candidate task form, where the SME
edits the rubric today. The console and Reviewer views show the same layout read-only.

**Each criterion is a collapsible card.** The header shows the read-only ID, the name, an applicability pill and
status chips: *Template default*, *Edited*, *Whole-task failure*, *Source changed — check rubric*, *Source link
needed*, *AI suggestion*, *Internal only — not sent to RL Gym*, *Evaluation setup needed*. The body has the
simplified-editor fields in the owner's order:

| # | Field | Behaviour | Stored in |
| --- | --- | --- | --- |
| 1 | Criterion name | From the template (D8 default); editable, with "Reset". The ID is read-only. | S7 item `name` (exported, as today) |
| 2 | What should the agent do? | Plain-English behaviour, editable. | annotation `assesses` (internal) |
| 3 | Derived from | Suggested source links as readable chips (**S2 · Inputs**, **S3 · Permitted tools**, **S4 · Policy rules · GB-02**, **Workflow · Verify identity**, **S6 · Required output**). Each is ✓ confirm or ✕ remove; "+ Add source" picks from readable names, never typed IDs. **Source link needed** when none is reliable. Below it: the chain *source → step/role → skill → this criterion* and "Why suggested". | annotation `sources` (internal). Confirmed rule, step and evidence IDs also fill `evidenceRefs` (D9). |
| 4 | When does this apply? | A readable statement, an applicability pill and **Change**. The dialog offers the four kinds (required throughout; required when a condition applies; permitted option; human officer or other role), the condition and exceptions. The Not applicable, Unknown and missing-evidence wording is shown. | annotation (internal) |
| 5 | How should we score it? | Pass, Partial and Fail text, labelled with the template's points (5/2/0 for KYC, levels 0–4 for Marketing). Each shows *Template default* or *Edited · Reset to template*. | S7 item `passCondition` / `partialCredit` / `failCondition` (or `level*`), exported as today |
| 6 | Whole-task failure | "Make this a whole-task failure when…" with a required condition. A radio says whether it's what a **Fail (0)** on this criterion means (*Supported*) or a behaviour the Fail doesn't cover (**Evaluation setup needed**, kept as a note). The line below explains this template's rule. | S7 item `critical` (exported, unchanged meaning); the condition is in the annotation |
| 7 | What evidence should support the score? | Editable. | annotation `evidenceRequired` (internal) |
| 8 | How it will be checked | Read-only sentence built from the template mapping (e.g. "RL Gym scores this from the recorded run … KYC rubric evaluator, version 1"). It never says "Ready". With no mapping: **Evaluation setup needed**. | computed |
| 9 | Technical grading settings · From template | Collapsed by default and read-only: evaluator, version, evidence source, output field, comparison, expected value, weight, scale, whole-task flag, and the evidence or rule IDs sent. Each is "Not used" when it doesn't apply (`run_evidence`). There's a lock note. | S7 item `evaluatorKind`, `evaluatorVersion`, binding fields, `weight` (exported, filled from the template) |

**Above the cards:** a summary ("20 criteria … Pass 5 · Partial 2 · Fail 0, 100 points"), a coverage pill, an "N to
finish" pill and **Refresh suggestions**. **Below them:** suggested additions. On a fixed evaluator map these are
internal only and *Evaluation setup needed*. **Save** is the existing save: an incomplete draft saves, and a panel
lists what's still to finish, each item linked:
- missing or unconfirmed source links;
- undefined applicability;
- missing score text;
- an empty or unsupported whole-task condition;
- missing technical mapping.

Submit runs the existing checks unchanged.

**Source links open the source in Authoring.** A side panel shows the passage with its section, task revision or
rule/document version, and the template version, with the derivation-time passage highlighted. "Open in the form"
goes to that section and field. In the console, a policy link opens `/projects/[id]/policy/rules/[ruleId]`.

**Console (PM/Admin) task page and Reviewer page:** the same cards read-only (`AuthoredForm`, `review-page`), with
"Edited from template default" markers (D8) and the to-finish list. The decision buttons and their meaning don't change.

**Template builder (`components/templates/compiler/*`):** no change. Template admins keep their current permissions
over the template's technical configuration.

## 3. Data model (internal only, new tables, additive migration)

Nothing is added to `TaskInstance.output`, `TaskSubmission.output`, `ApprovedTaskRecord` or any template part.

```prisma
/// One request to derive rubric recommendations for a task. Append-only.
model RubricRecommendationRun {
  id, clientId, taskInstanceId
  mode            String   // DERIVED (rules, no model) | AI (rules + model wording)
  model           String?  // null for DERIVED
  promptVersion   String
  templateId      String   // Template.id = lineage + version
  templateVersion Int
  taskRevision    Int      // TaskInstance.revision read
  policySnapshotId String? // the task's effective rule-set snapshot used
  inputDigest     String   // sha256 of everything read; same digest + mode -> same run reused (idempotent)
  status          QUEUED | RUNNING | SUCCEEDED | FAILED
  items           Json     // RecommendationItem[] (below), frozen
  requirements    Json     // RequirementItem[] used for coverage, frozen
  notes, error, requestedById, createdAt, finishedAt
}

/// The internal annotation of one criterion of one task. Append-only versions; the latest version is current.
model RubricCriterionAnnotation {
  id, clientId, taskInstanceId
  criterionId     String   // the S7 item id (stable)
  version         Int      // @@unique([taskInstanceId, criterionId, version])
  origin          TEMPLATE | TEMPLATE_DEFAULT | RECOMMENDED | AI_RECOMMENDED | CUSTOM
  status          ACTIVE | REMOVED
  exportable      Boolean  // false = internal only (id not in the template's evaluator map)
  fromRunId       String?  // the run it was accepted from
  details         Json     // see AnnotationDetails
  editedFields    String[] // fields the author changed by hand (never overwritten by regeneration)
  sources         Json     // SourceLink[] with snapshots
  createdById, createdAt
}
```

`AnnotationDetails` (Zod in `packages/shared/src/rubric/`): `assesses`, `stepId?`, `roleId?`, `skill`,
`applicability: REQUIRED | REQUIRED_WHEN | PERMITTED_OPTION | OTHER_ROLE | UNSET` (UNKNOWN for a derived requirement
whose applicability can't be decided), `condition?`, `exceptions?`, `wholeTaskFailure?: { condition: string, kind:
FAIL_OF_CRITERION | OTHER_BEHAVIOUR }` (OTHER_BEHAVIOUR = evaluation setup needed; never exported), `evidenceRequired`, `explanation`, `unresolved: string[]`,
`coversRequirements: string[]` (requirement keys), and `stateRules` (fixed wording of the §7 scoring states:
Not applicable, Unknown, Missing evidence ≠ incorrect behaviour).

`SourceLink` also has `state: SUGGESTED | CONFIRMED | NEEDED` (NEEDED = a "Source link needed" placeholder naming the
missing kind) and a readable `label` (e.g. "S4 · Policy rules · GB-02"). `kind` (TEMPLATE_FIELD | TEMPLATE_EXECUTION | TASK_FIELD | WORKFLOW_NODE | WORKFLOW_ROLE | POLICY_RULE |
POLICY_DOCUMENT | OUTPUT_FIELD), `templateId`, `templateVersion`, `taskId?`, `taskRevision?`, `section?`, `field?`,
`itemPath?` (e.g. `S5.steps[2].action`), `stepId?`, `roleId?`, `ruleKey?`, `ruleVersionId?`,
`documentVersionId?`, `locator?` (page, section, from `PolicyCitation.locator`), `excerpt` (at most 280 characters),
and `snapshot: { sha256, capturedAt }`, the hash of the exact value at that path when it was derived or accepted.

Why this shape: append-only versions give restore and audit for free and match the platform's other versioned
records. Keeping the current state per criterion means a fixed set of criterion IDs (v7) works the same way as free
criteria (Marketing). No foreign key reaches into the export tables.

**Restore (spec §6)** uses existing history. Criterion values come from the task's previous `TaskSubmission`
versions (the existing saved history) and are written back through the ordinary autosave. Annotations are restored by
appending a copy of the annotation version that was current at that submission's `submittedAt`. No new history
system.

## 4. How recommendations are generated

Two layers. The first is always available behind the feature flag and costs nothing. The second is optional.

**Layer 1: derivation (no model, deterministic).** In `packages/shared/src/rubric/derive.ts`, a pure function:
`derive({ template, profile, execution, task, policy, defaults }) -> { requirements, items, unused }`.

1. **Classify each field of the selected template version by role, never by section number.** Precedence:
   (a) `profile.contract` pointers (objective, actorEvidence, policies, decisionFields, criteria);
   (b) field type (`tool_call`, `policy_citation`, `evidence_record`, `graph_binding`, `criterion`);
   (c) a multi-select whose options are the template's execution tools counts as the permitted tools;
   (d) the task's `workflowGraph` (agent and human steps, branches, loops, roles, handoffs, parallel work);
   (e) `execution.output_schema` required properties, which are the required outputs;
   (f) otherwise a labelled heuristic on the field's key, label and help (procedure/steps, output, revision,
   safety/prohibited, scope), with the reason shown ("read as workflow steps from its label 'Reusable procedure'").
   A field with no role is listed under **"Sources not used"**, so nothing is skipped silently.
2. **Build requirements** from what the task actually contains, each with sources. Examples: one per selected policy
   rule version in the task's effective rule set (using the PR #81 annotations when present: mandatory marking,
   applies-when, responsible actor), one per required output field, one per workflow step, human step and handoff,
   one per permitted tool, the objective, revision handling when the inputs or tools include versions or comparison,
   and safety (prohibitions, the template's critical rules). Requirements are **de-duplicated by key** (rule key,
   output path, tool id, step id), and one requirement keeps all the places it appears. This is how shared
   requirements avoid duplicate weight.
3. **Applicability, per §7:**
   - a "Mandatory when applicable" or permitted-option rule gives a CONDITIONAL requirement with its condition;
   - an optional route never becomes mandatory;
   - a human-actor duty (human step, or a rule whose responsible actor is a human officer) becomes "the agent routes
     or escalates to the human and does not exercise the approval itself";
   - product and state conditions point at the case selector's real application field (v7: `product` from
     `S1.applicationType`), never at an example value (v7 `exampleGoverningState` never filters);
   - a requirement whose applicability can't be decided from the data is UNKNOWN and listed as unresolved, never
     NOT_APPLICABLE.
4. **Match requirements to existing criteria first** (spec §2). For each template criterion, a link is suggested when
   the requirement's terms match the criterion's ID, name or default text. It's shown as a *suggested coverage link*
   for the author to confirm. Only requirements left uncovered produce **proposed new criteria**. Existing criteria get
   proposed *changes* only as field diffs (for example, an assessment note or the critical trigger), never replacements.
5. **Items** carry the full derivation chain (source → step/role → skill → criterion), the explanation, source links
   with snapshots, the applicability, and `unresolved` entries for missing information ("No rule in the task's rule
   set covers sanctions screening; requirement not invented").
6. **Scoring is never invented.** Recommendations fill weight, scale or thresholds only from structured template data
   (the field's `scale`, `groups`, `weightTotal`, or D8 defaults). Otherwise weight is left empty, with the note "not
   set by the template — author decides". The KYC scale is never applied to Marketing. Each criterion uses its own
   template's field definition.

Layer 1 gives honest skeletons: the right chain, links and coverage, but plain wording ("Applies rule R-ID-3 v2 as
written; see source").

**Layer 2: AI wording (optional, `RUBRIC_AI_ENABLED`, off by default).** An interface `RubricAssistant` with a
Vertex implementation (model from `RUBRIC_AI_MODEL`, which follows `AUTHORING_MODEL` when empty, as the other
assistants do) and a mock for tests. It receives the Layer 1 skeletons and the cited source text only, as data
inside tags. It returns *wording only*: assesses, skill, Pass/Partial/Fail or level text, evidence required and
explanation. Its output is sanitised: it can't add or rename IDs, change weights, scale, critical status,
applicability or sources, and anything outside the skeleton is dropped. Every AI-written field is labelled *AI
suggestion*. One model call per run, bounded input, rate-limited per task. It is never called from tests or in QA
unless the owner turns the flag on.

**Regeneration (spec §6).** A new run is computed against the current annotations. Fields in `editedFields` are never
overwritten. Differences show as "Proposed change" diffs to accept one field at a time. A dismissed recommendation with
the same derivation key isn't offered again unless its sources changed. The same `inputDigest` and mode reuse the
existing run (idempotent, no new model call).

## 5. Coverage, unresolved items and duplicate scoring (spec §6–§8, AC 8)

Computed on read from the latest run's requirements and the current annotations and criteria:

- **Gap:** a mandatory requirement no active criterion covers. This includes the gap created by removing a criterion.
- **Unresolved:** every `unresolved` entry and every requirement with UNKNOWN applicability.
- **Possible duplicate weight:** one requirement covered by more than one weighted criterion as its main target.
- **Lint warnings:**
  - a conditional criterion with no condition;
  - a critical criterion with no trigger, or with a ZERO trigger on a conditional criterion without the
    Not-applicable rule;
  - a criterion whose Pass text only checks that a tool was called ("calling the tool is evidence of an action, not
    proof").

All of this shows in S7 and in the existing pre-check as **warnings, not blockers**. Submit and approval rules don't
change (AC 11). The Reviewer and PM see the same summary read-only.

## 6. Source links and "Source changed — check rubric" (spec §5, AC 2 and 6)

Each link stores the snapshot hash of the value it points to. On read, the API recomputes the current hash at the
same path: the task field at the current revision, the rule's current version in the task's effective rule set, the
template field of the task's template version (fixed), or the document version (immutable). If they differ, the
criterion shows **Source changed — check rubric**, with the old excerpt and the new value. The criterion and its
annotation are **never rewritten**. The author clicks *Reviewed, keep* (which re-snapshots and appends an annotation
version) or edits. A link whose target no longer exists (item removed, rule excluded) shows **Source removed**.

## 7. Editing, saving and approval (spec §6, AC 4, 5 and 11)

- Criterion values (the existing S7 item keys) are saved exactly as now: autosave of `output.sections.S7`.
  Accepting a recommendation writes only keys the template's criterion definition already has. Source links, step and
  role, skill and the rest go to the annotation, never into `evidenceRefs` or any other exported field.
- Annotations are saved through new endpoints:
  - `GET /me/tasks/:id/rubric` returns criteria status, annotations, recommendations, coverage and source states;
  - `POST /me/tasks/:id/rubric/runs` generates, `{ mode }`;
  - `PUT /me/tasks/:id/rubric/criteria/:criterionId` saves an annotation, `{ expectedVersion, details, sources, editedFields }`;
  - `POST /me/tasks/:id/rubric/recommendations/:itemKey/decision` accepts or dismisses, `{ runId, decision, edits? }`;
  - `POST /me/tasks/:id/rubric/criteria/:criterionId/restore` restores, `{ submissionVersion }`;
  - read-only console and Reviewer `GET`s for the same view.
- **Authorised:** only the assigned author, while the task is editable (the same rule as autosave). PM, Admin and the
  task's Reviewer get read access. **Idempotent:** an `Idempotency-Key` on every POST/PUT (existing
  `IdempotencyKey` table) and `expectedVersion` on annotation writes; a stale version returns 409. **Audited:**
  `writeAudit` for each run, accept, dismiss, annotation save, remove, restore and "reviewed, keep".
- **Removing** an optional criterion (a custom one, or an accepted recommendation not in the evaluator map) is allowed.
  Template criteria of a fixed evaluator map can't be removed (D8). Removal appends a REMOVED annotation and leaves the
  coverage gap visible.
- **Approval:** unchanged. Accepting a recommendation is an author edit like any other: it goes through the existing
  submit → Reviewer (if any) → PM/Admin decision. AI never accepts, submits or approves anything.

## 8. How the owner's D8 decision fits in

D8 ("template default, SME edits") becomes the base layer of this work:

1. **Pre-listed criteria.** On a template with an evaluator map, S7 is seeded with one item per mapped criterion ID
   (v6/v7: 20). The ID is read-only. Submit refuses missing or unknown IDs for those templates. This uses data the
   template already has.
2. **Template defaults as data.** A new optional key on the criterion field definition in the authoring profile,
   `criterionDefaults: [{ id, name, weight?, passCondition?, partialCredit?, failCondition? | levels…, critical?,
   criticalTrigger? }]`. It's validated against the field's scale, so 0–4 defaults can't be given to a 5/2/0 field.
   It's data in the template, read only from the selected template version. **Existing template versions don't have
   it, and their bytes and hashes don't change.** A future RL Gym proposal (or a Praxis-built template) can carry it.
   Until then, D8's fallback applies: IDs pre-filled, name prefilled from the ID (labelled "from criterion ID",
   editable), anchors blank. The arrival check accepts a template without defaults and warns.
3. **Provenance per field:** template default → AI/derived suggestion → author edit. A recommendation never silently
   replaces a template default. It shows as a proposed change against the default. **Reset to default** is per field.
   The Reviewer and PM see which anchors changed from the default (D8). The diff is computed from the template version
   and isn't stored in `output`.
4. **Marketing:** no evaluator-map seeding (its criteria are authored per task within groups A–G). Defaults apply
   only if a Marketing template version ever carries `criterionDefaults`.

### 8a. D9: the technical fields on each criterion get a source instead of free typing

D9 (owner, 15 Nov 2026) is folded in. Today the SME types five grading fields with no source, and the help text says
"Anvil". They are existing criterion item keys, so the stored and exported shape doesn't change. Only where the values
come from changes.

- **Evaluator kind and version.** These are filled automatically from the selected template version's
  `execution.evaluators[]` for the criterion's ID (`evaluatorMap` in `joint-template.ts`), and are read-only:
  - kind is `capability.id`, e.g. `golden-kyc-rubric-v1`;
  - version is `capability.version`, e.g. `1`.

  This is exactly what the existing joint-template submit check already requires (`submission.ts`: kind and version
  must equal the mapped capability). So a filled-in task gets the same bytes an SME who typed the correct values gets
  today. The current help text's "e.g. run_evidence" contradicts that check and is corrected. The fields are hidden
  when the template has no evaluator spec. They're also hidden for an internal-only criterion, which has no mapping.
- **Evidence or rule links (`evidenceRefs`, still a string array).** These become a picker with no free typing. It
  lists the task's selected policy rules (rule keys from the task's effective rule set; the D6 picker once it ships),
  the workflow step IDs (from S5 steps or the workflow graph) and the evidence item IDs (from the task's
  `evidence_record` fields). Values that were already saved and aren't in the list are kept, never deleted, and are
  marked "not found in this task" as a warning. The picker offers IDs only. The richer source links of section 6
  stay internal and are never written here.
- **Output field, Comparison and Expected value.** These are shown only when the template's evaluator for that
  criterion compares the output, meaning its `evidence_source` isn't `run_evidence`. For KYC v6 and v7 (all
  `run_evidence`) they're hidden, which matches the template's "no per-case reference answers". When they're shown,
  Output field is a picker of the properties in the template's `execution.output_schema`. Expected value follows the
  property's type and enum. Values already saved on a hidden field are kept (not stripped, so bytes don't change) and
  flagged for the author.
- **Wording.** All criterion help text in `helpers.ts` says "RL Gym", never "Anvil". Code comments can keep internal
  names.

These are display and fill rules on the existing keys, so they work on old tasks too. They sit behind the same flag as
the rest of this work. With the flag off, S7 renders as today. Tests:
- the auto-fill values pass the existing submit check unchanged;
- export bytes are identical whether a value was auto-filled or typed;
- the picker refuses free text but keeps legacy values;
- binding fields are hidden for `run_evidence` and shown with an output-schema picker for a synthetic output-comparing
  evaluator;
- no user-facing "Anvil" string remains in the criterion help (string scan).

D6 is used, not changed: once S4 is a picker, its picked rule versions are exact policy sources. Until then the
derivation reads the task's effective rule set, which is already exact.

## 9. Export stays byte-identical, and the tests that prove it (spec §8, AC 10 and 12)

**Why it holds by construction:**
- the new data lives only in new tables;
- the export builders (`generic-package.ts`, `dataset/praxis-export.ts`, the project export) don't import or query
  them;
- accepted recommendations write only existing criterion keys;
- an ID not in the template's evaluator map is stored as an **internal-only** annotation and never enters
  `S7.criteria` on templates with an evaluator map, so no improvised field and no ungradable criterion reaches the
  package;
- template versions already published are untouched.

**Tests:**

1. **Golden bytes:** the existing v6 package test ("stays byte-identical … same hashes as before step 4") and the v7
   case-selector package test, re-run with annotations, runs and internal-only criteria present for the same tasks.
   The ZIP bytes, part hashes, `reference.json` and `actor.json` JCS hashes must be identical to the stored goldens.
2. **Record hash:** approving a task that has annotations gives the same `ApprovedTaskRecord.contentHash` as the
   same output without them.
3. **Static guard:** a test asserting the export modules don't reference the rubric tables or the `rubric/` shared
   module (import-graph check), so a later change can't leak them.
4. **Template hash:** `jointHashes` of the v6/v7 fixtures is unchanged after the profile schema gains the optional
   `criterionDefaults`.
5. **Flags off:** with `RUBRIC_RECOMMENDATIONS_ENABLED=false`, the rubric endpoints return 404, S7 renders exactly as
   today (snapshot test), and the full API/web/candidate suites pass unchanged.

**What RL Gym doesn't receive yet** (to be listed in the PR and in `docs/integrations/`): the annotation details
(assesses, step and role, skill, applicability and condition, critical trigger, evidence required, explanation,
unresolved), source links and snapshots, coverage results, run records, internal-only criteria, and the
template-default provenance.

## 10. Decisions taken (logged in `docs/DECISIONS.md`)

1. Feature flag `RUBRIC_RECOMMENDATIONS_ENABLED` (default false) gates the whole feature, D8 seeding and defaults
   included, so merging changes nothing in QA. `RUBRIC_AI_ENABLED` (default false, needs the first) gates model
   wording. No paid call is possible with the defaults.
2. Deterministic derivation first; AI writes wording only, labelled, and never IDs, scoring, applicability or sources.
3. The internal data goes in new append-only tables, never in `output`. Restore uses `TaskSubmission` history.
4. New criteria on an evaluator-map template are **internal only** and labelled, never exported, until a contract
   change is agreed.
5. Coverage, unresolved items and duplicate weight are warnings in S7 and the pre-check, never new blockers. No new
   approval stage.
6. D8 defaults are an optional template field key (`criterionDefaults`), so they're data, not code. Old template
   versions are unchanged; the fallback is IDs plus an ID-derived name and blank anchors.
7. Weights and thresholds are filled only from structured template data. The help text "weight 5 each" is shown as a
   linked note, not applied.
8. The PR #81 rule annotations are used through a small interface when present. Without them, rules fall back to
   `PolicyRule.required` with applicability UNKNOWN where the body doesn't say. No hard dependency on that branch.
9. User-facing text says ADI Forge and RL Gym only.

## 11. For the owner (only if you want something different)

- **A. Where KYC default anchors come from before RL Gym sends them.** Planned: wait for a template version that
  carries `criterionDefaults` (D8 said "Needs RL Gym"). Until then, v7 S7 shows the 20 IDs with blank anchors.
  *Alternative:* an Admin-only, audited "Template rubric defaults" editor in the console, stored internally per
  template version and never exported, so the owner's 20-row table can be loaded now without RL Gym. I'd add this only
  if you say so.
- **B. Weight on v7.** Planned: weight isn't prefilled (it isn't structured data), so the SME enters 5 twenty times,
  guided by the linked help text. *Alternative:* treat the field help's "weight 5 each" as the template's stated
  default. That's parsing prose, so I've not done it by default.

## 12. Build steps (after approval), each its own commit and test set

1. Shared: `rubric/` Zod types (annotation, source link, requirement, item), `criterionDefaults` on the profile
   schema with scale validation, and the pure `derive()` with role classification, requirements, applicability,
   matching, coverage and lint.
2. API: migration (two tables), config flags, service and routes (authorisation, idempotency, audit), source-change
   detection, restore, the `RubricAssistant` interface with a mock and a Vertex implementation, and D8 seeding and
   submit ID checks behind the flag.
3. Candidate app: the simplified editor cards as in the approved mockup (the 9 fields, the Change dialog, whole-task failure, collapsed technical settings, the source panel, the to-finish list on save), then D9 sourcing, suggested additions, coverage and source-link navigation,
   reset to default, restore.
4. Console and Reviewer: read-only chips, details, coverage and "changed from default".
5. Export-compatibility tests (section 9), the docs (`docs/integrations/` note of what RL Gym doesn't receive, and a
   user-guide paragraph), then the PR. It's merged only with the owner's yes.

## 13. Test plan by acceptance criterion

Every API test uses a per-run docker `pgvector/pgvector:pg16` on a free port with `DATABASE_URL` and
`TEST_DATABASE_URL` set. There are no live model calls (the mock assistant).

| AC | Tests |
| --- | --- |
| 1 | `derive()` on the v7, v6 and Marketing fixtures: roles come from contract, type, graph and output schema, not section number. A synthetic profile with S2 and S5 swapped gives the same requirements. Unclassified fields are listed under "Sources not used". |
| 2 | Each item has an explanation and links. Link targets resolve (API `GET` returns resolvable section, field and item paths, rule and document IDs). Web test: clicking a link switches to that section and focuses the field; a policy link opens the rule. |
| 3 | v7: 20 template IDs seeded and read-only; evaluator kind and version auto-filled from the evaluator map and passing the existing submit check (D9); regeneration never renames, drops or replaces them; submit refuses unknown or missing IDs; `criterionDefaults` text kept exactly. |
| 4 | Annotation PUT edits applicability, condition, evidence required and the critical trigger. S7 edits of Pass/Partial/Fail and weight save through autosave. A 409 on a stale version. Only the assigned author can write. |
| 5 | Author edits a recommended field, regenerates: the field is unchanged and the new value appears as a proposed change. A dismissed item is not re-offered unless its source changed. The same digest reuses the run. |
| 6 | Change a linked task field or rule version: the criterion shows "Source changed"; criterion and annotation bytes unchanged; "Reviewed, keep" re-snapshots and is audited. |
| 7 | Permitted-option rule gives a conditional criterion with its condition, never mandatory. A human step gives "escalates; doesn't approve". The v7 product condition uses `S1.applicationType`, not the example state. Missing applicability data gives UNKNOWN, not N/A. Lint flags a conditional criterion without a condition and a critical criterion without a trigger. |
| 8 | Removing a covering criterion shows the gap. One requirement in three sections is one requirement (no duplicate). Two weighted criteria on one requirement raise a duplicate warning. Unresolved items are listed. S7 progress reads "Filled — N gaps". |
| 9 | Marketing recommendations use 0–4 levels and groups; KYC uses 5/2/0. KYC defaults on a 0–4 field are refused by schema validation. Marketing groups still total their weights. |
| 10 | Section 9 tests 1–4. |
| 11 | Submit and decision routes unchanged (existing review tests pass). No new statuses or stages; the enum and route diff is asserted in a test. |
| 12 | Flags-off tests (section 9.5). The migration is additive only (a test checks no existing column changes). The full suites stay green. No deploy. |

## 14. Reconciling the two specs, D8 and D9

The decisions are also in `docs/DECISIONS.md`. Where the specs differ, the simplified-editor spec (the later one) wins
on what the author sees. The recommendations spec wins on how suggestions are derived and stored.

| # | Conflict | Decision |
| --- | --- | --- |
| 1 | **Field list.** Recommendations §4 lists 14 fields (incl. step/role, skill, exceptions, why, unresolved). The editor §1 lists 9 in a fixed order. | The editor shows only the 9, in order. Step/role and skill appear in the "Derived from" chain; exceptions in the Change dialog; "why" under the links; unresolved items in the to-finish list. Nothing is lost and no extra top-level fields are added. |
| 2 | **Critical trigger.** Recommendations §4 asks whether zero, partial or a specific behaviour triggers it. Editor §5 says don't assume partial triggers it, and reflect only what the contract supports. | The editor offers only what the template supports. For KYC v6/v7 that's "a Fail (0) on this criterion fails the whole task", per the S7 scoring rule. "Partial triggers it" isn't offered. A behaviour the Fail doesn't cover is saved as a note and flagged **Evaluation setup needed**. Only the existing `critical` flag is exported. |
| 3 | **Criterion name.** D8 said ID and name read-only. Editor §1 says the name is editable under existing permissions. | The ID stays read-only. The name is editable, as it is today, with "Reset to template" and an "Edited from template" marker for the Reviewer and PM. This is D8's "template default, SME edits" applied to the name. |
| 4 | **Applicability kinds.** Recommendations uses mandatory/conditional plus §7 rules. The editor names four kinds. | Four kinds (required throughout, required when, permitted option, human officer or other role), plus UNKNOWN for derived requirements and UNSET for a new suggestion. The Not applicable, Unknown and missing-evidence treatment stays as the template's scoring rule defines it, and nothing in the export changes. |
| 5 | **"Evidence or rule links" (D9 picker) vs "Derived from" (editor §2).** These are two link controls for one idea. | One control: "Derived from". Confirmed links of exportable kinds (policy rule keys, step IDs, evidence IDs) fill the existing `evidenceRefs` list. Suggested-but-unconfirmed links don't. `evidenceRefs` is then shown read-only under Technical settings ("Evidence or rule IDs sent"). Existing saved values are kept. The field's meaning ("IDs this criterion checks") is unchanged, so nothing is repurposed. |
| 6 | **Technical fields.** D9 auto-fills and hides them. The editor puts them in a collapsed read-only "From template" section. | Collapsed and read-only in "Technical grading settings · From template", shown with "Not used" rather than hidden. It's filled only from the exact template mapping, never guessed; with no mapping it reads **Evaluation setup needed**. This is D9's sourcing with the editor's presentation. |
| 7 | **Weights.** Editor §4 says load the template's weights. Plan option B left v7's weight (help prose only) unfilled. | Weight is shown read-only from structured template data: D8 `criterionDefaults`, `groups` or `weightTotal`. The mockup assumes a template version carrying D8 defaults (weight 5). On today's v7 without defaults, weight stays author-entered with the prose shown as a note, unless the owner picks option B. |
| 8 | **New criteria.** Recommendations proposes additions; editor §4 says keep unsupported changes out of the executable export. | Additions are shown separately under the cards, labelled *AI suggestion* / *Internal only — not sent to RL Gym* / *Evaluation setup needed*. They never enter `S7.criteria` on a fixed evaluator map. |
| 9 | **History.** Editor §7 asks to record author, timestamp and version, and keep the AI original. | Annotation versions record author and time. The S7 values keep the task revision and `TaskSubmission` history. Run items are frozen, so the original AI suggestion stays separate from edits. No new history system. |
| 10 | **Validation.** Recommendations treats coverage gaps as warnings; editor §7 asks for draft saving with gaps listed. | These agree. Save always works (existing autosave), and the to-finish list is computed. Submit, approval and export validation are unchanged and are never bypassed. |

## 15. Test plan: simplified-editor acceptance criteria

| AC | Tests |
| --- | --- |
| 1 | The candidate S7 render of a v7 task has no editable input for evaluator, version, output field, comparison or expected value. It's a component test, plus an API check that the annotation and S7 endpoints refuse writes to them from an author. |
| 2 | Auto-filled `evaluatorKind`/`evaluatorVersion` survive save/reload, pass the existing submit check, and appear in the export package byte-for-byte as when typed correctly. Legacy values on hidden fields are kept. |
| 3 | Derivation suggests links for the v7 fixture (S2, S3, S4 rules, workflow steps, S6). Confirm, remove and add (picker only, no free-text path in the API schema) all work. A link's GET resolves to the versioned passage. Clicking it opens the source panel and "Open in the form" focuses the field. |
| 4 | Edit a linked S2 field: the criterion is flagged "Source changed"; its S7 values and annotation are unchanged; "Reviewed, keep" re-snapshots and is audited. |
| 5 | Score labels and defaults follow the field's scale: 5/2/0 on KYC, 0–4 levels and groups on Marketing. Reset to template restores the default. KYC defaults on a 0–4 field are refused. |
| 6 | Whole-task failure: ticking it without a condition is listed as incomplete. FAIL_OF_CRITERION sets the existing `critical` flag. OTHER_BEHAVIOUR is flagged "Evaluation setup needed" and doesn't change the exported payload. The explanation text matches the template's scoring rule. |
| 7 | A criterion ID without a mapping shows "Evaluation setup needed" and empty technical settings, with no default invented. "How it will be checked" never contains "Ready". |
| 8 | Saving with every to-finish category present succeeds (autosave 200), lists each gap, and submit still fails on the existing checks (e.g. empty Fail text on a joint template). |
| 9 | The export golden tests (section 9) pass with the new data present. RL Gym's offline validation fixture (`synthetic-offline-validation.json`) accepts the package unchanged. |
| 10 | No new task statuses, review stages or decision routes (enum and route snapshot test). |
| 11 | No change under RL Gym contract fixtures (contract files byte-identical; template hashes unchanged). |
| 12 | Flags-off tests: S7 renders as today and the endpoints return 404. The migration is additive only. No deploy. |
