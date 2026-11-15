# Owner spec (15 Nov 2026): simplified rubric editor

Given by the owner on 15 Nov 2026 and passed to this work by the DevOps session. Reproduced verbatim below. It is
combined with `docs/prd/PRD-RUBRIC-RECOMMENDATIONS.md`, D8 and D9 in `docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md`, whose
section 14 lists the conflicts and decisions. The mockup to approve is `docs/design/mockups/rubric-editor.html`.

---

Implement the simplified rubric editor shown in the agreed mockup in **Authoring's existing Rubrics section**.

**This is an Authoring-only enhancement. Preserve the current export contract and payload semantics. Do not make it a dependency or release gate for the current RL Gym QA deployment.**

### 1. Author-facing editor
Show these fields in this order:
| Field | Behaviour |
|---|---|
| Criterion name | Load from the template; editable according to existing template/task permissions. |
| What should the agent do? | Editable plain-English description of the assessed behaviour. |
| Derived from | Automatically suggested, clickable source links. |
| When does this apply? | Readable applicability statement with a **Change** button. |
| How should we score it? | Editable Pass, Partial and Fail descriptions, showing the template's existing numeric values. |
| Whole-task failure | Checkbox with an editable, explicit failure condition when enabled. |
| What evidence should support the score? | Editable evidence requirements. |
| How it will be checked | Readable explanation of the inherited evaluation method. |
| Technical grading settings | Collapsed by default; inherited settings displayed for reference. |
Use the existing Save action. Do not introduce another approval stage.

### 2. Automatic source links
Generate source-link recommendations from the selected template version and authored task sections, including S1–S4 and all other relevant sections.
Use each section's actual field definitions; do not assume section numbers mean the same thing across templates.
Link a criterion to relevant:
- Task sections and fields.
- Workflow steps.
- Agent roles.
- Selected policy rules.
- Policy document passages.
- Required outputs.
Display readable labels such as:
**S2 · Inputs** · **S3 · Permitted tools** · **S4 · Policy rules** · **Workflow · Verify identity**
Clicking a link must open the corresponding source passage in Authoring, with its section and version identified.
Store stable identifiers and version references behind each link. Preserve the supporting passage used during derivation.
Allow the author to add, remove or correct suggested links by selecting readable source names—not typing IDs.
If a reliable source link cannot be established, show **"Source link needed"** rather than inventing one.
When linked content changes, mark the affected criterion **"Source changed—check rubric."** Preserve author edits; do not silently regenerate or overwrite them.

### 3. Applicability
Show a suggested condition derived from the workflow and selected policies. Allow editing through **Change**.
Distinguish:
- Required throughout the stated workflow scope.
- Required only when a condition applies.
- A permitted option and its accompanying conditions.
- A responsibility belonging to a human officer or another role.
Do not require every party to undergo identical checks unless the applicable policy requires that.
A conditional criterion must not automatically receive full marks when its trigger is absent. Preserve the existing supported treatment of Not applicable, Unknown and missing evidence; do not silently change exported scoring behaviour.

### 4. Editable scoring
Load the approved template's criterion IDs, scoring scale, weights, thresholds and critical-failure rules.
- Preserve stable criterion IDs.
- Allow authors to edit scoring descriptions within existing permissions.
- Do not substitute newly generated criteria for approved template criteria without showing the change.
- Do not apply KYC's scoring scale to Marketing or other templates.
- Keep unsupported changes to scales, weights or thresholds out of the current executable export.
AI suggestions must remain distinguishable from author edits and approved definitions.
Prevent duplicate weighting when the same requirement is supported by multiple sections.

### 5. Whole-task failure
Replace the ambiguous **Critical** explanation with:
**"Make this a whole-task failure when…"**
When enabled, require an explicit condition, for example:
> The agent recommends clearance while mandatory identity verification remains incomplete.
Explain the existing template's relationship between this condition and Pass/Partial/Fail scores. Do not assume a partial score triggers whole-task failure unless the approved configuration says so.
**Compatibility safeguard:** the editor must reflect the critical-failure behaviour the current contract supports. If a proposed condition cannot be represented, flag it as requiring evaluation setup; do not imply that new executable behaviour has been saved.

### 6. Inherited technical settings
Move the following fields into a collapsed **Technical grading settings · From template** section:
- Evaluator kind.
- Evaluator version.
- Output field mapping.
- Comparison operator.
- Expected value or threshold.
- Existing evaluator-specific configuration.
Populate them from the exact approved template/execution configuration associated with the task.
These settings are read-only for ordinary task authors. Existing authorised template administrators retain their current configuration permissions.
Do not guess evaluator identifiers, versions, output paths, operators or expected values. Do not replace a missing mapping with a plausible-looking default.
Show a readable explanation under **How it will be checked**, derived from that configuration. If no reliable mapping exists, show **"Evaluation setup needed."**
A template mapping does not establish runtime availability or evaluator qualification in RL Gym. Do not display "Ready" solely because these fields are populated.

### 7. Draft saving and validation
Allow the author to save an incomplete draft.
Clearly identify:
- Missing source links.
- Undefined applicability.
- Missing scoring descriptions.
- Incomplete whole-task failure conditions.
- Missing or incompatible technical mappings.
Preserve the existing validation rules for approval and executable export. Do not bypass them to make the simplified editor appear complete.
Reuse existing edit history and record author, timestamp and version. Preserve original AI suggestions separately from subsequent edits.

### 8. Export contract unchanged
For this release:
- Continue populating existing supported export fields from the saved rubric and inherited template configuration.
- Keep existing field names, types, identifiers, versioning, authentication and receipt behaviour.
- Preserve scoring semantics, including critical-failure behaviour.
- Store new source-link, explanation and derivation metadata internally where the current contract does not support it.
- Do not add fields, repurpose unrelated fields or place unsupported metadata into improvised payload locations.
- Identify internally which new annotations RL Gym does not yet receive.
Any later export extension or RL Gym consumption of new metadata requires a separately agreed change.

### 9. Acceptance criteria
1. An SME can edit a rubric without entering evaluator IDs, versions or output paths.
2. Existing technical settings remain populated and are preserved through save/reload and export.
3. Source links are suggested automatically, editable and open the correct versioned passage.
4. Source changes flag affected criteria without overwriting author edits.
5. Pass/Partial/Fail values follow the selected template.
6. Whole-task failure behaviour is explicit and consistent with the existing executable configuration.
7. Missing mappings are visible; they are not invented or silently treated as ready.
8. Incomplete drafts can be saved without bypassing existing approval/export validation.
9. The existing export consumer accepts the resulting payload without modification.
10. No additional approval workflow is introduced.
11. No RL Gym code change is required for this phase.
12. The current RL Gym QA deployment proceeds independently of this enhancement.
