# Owner spec (15 Nov 2026): rubric recommendations in Authoring

Given by the owner on 15 Nov 2026 and passed to this work by the DevOps session. Reproduced verbatim below. The plan is
`docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md`. Related: QA defect D8 (S7 rubric typed by hand; owner decision "template
default, SME edits") and D6 (S4 policy references picked from the project library, never typed).

---

Implement rubric recommendations in **Authoring's existing Project/task setup and Rubrics section**. Derive them from the selected template and authored task content.

**This is an Authoring-only enhancement. Keep the current export contract and payload unchanged. It must not become a dependency or release gate for the current RL Gym QA deployment.**

### 1. Derive rubrics from the task
Read S1, S2, S3, S4 and all remaining relevant sections using their **actual field definitions in the selected template version**. Do not assume the same section number has the same meaning across every template.
Use the following content wherever it appears:
| Source content | What to derive |
|---|---|
| Purpose, scope and expected outcome | Task completion and outcome-quality criteria |
| Inputs and supporting documents | Information extraction, interpretation and evidence-grounding criteria |
| Permitted tools and actions | Correct tool use, result interpretation and action-boundary criteria |
| Policies and selected rules | Policy application, eligibility, restrictions and exception-handling criteria |
| Workflow steps, branches and loops | Step-specific skills, routing and completion criteria |
| Agent roles, parallel work and handoffs | Role responsibilities, coordination and handoff-quality criteria |
| Required outputs | Completeness, correctness, consistency and evidence requirements |
| Revision handling | Detection and incorporation of relevant document changes |
| Safety constraints | Applicable safety and prohibited-action criteria |
| Existing template rubrics | Preserve and reuse approved criteria rather than generating duplicates |
Use the task's selected policy-rule versions and annotations where available. Flag missing information rather than inventing requirements.

### 2. Preserve existing template criteria
Where a template already defines approved rubrics, scoring values, weights, thresholds or critical-failure rules:
- Load them as the starting point.
- Preserve their stable criterion IDs and approved definitions.
- Do not silently replace them with newly generated criteria.
- Present proposed additions or changes separately, with an explanation.
- Follow existing versioning and review behaviour for edits.
Do not automatically apply KYC's scoring scale to Marketing or another template.

### 3. Show the derivation chain
For every recommended criterion, show: **Source section → workflow step/agent role → skill → rubric**. Where relevant, also link the policy rule and required output.
Example:
> **Criterion:** Revision integrity
> **Derived from:** Supporting-document requirements and the workflow's revision-comparison step.
> **Skill assessed:** Extracting and reconciling material changes.
> **Policy link:** Applicable evidence/current-document rule.
> **Assessment:** Did the agent incorporate the relevant changes into its findings and recommendation?
Calling a comparison tool is evidence of an action—not proof that the changes were understood or applied correctly.

### 4. Editable rubric fields
Provide these fields through the existing editing flow:
- Criterion ID and name.
- What is assessed.
- Workflow step and responsible agent role.
- Skill assessed.
- Mandatory or conditional applicability.
- Applicability condition and exceptions.
- Pass, Partial and Fail descriptions.
- Numeric scoring scale.
- Weight, where supported by the template.
- Critical-failure designation and its exact triggering condition.
- Evidence required.
- Source links.
- Explanation of why the criterion is recommended.
- Unresolved questions or missing information.
Do not invent numeric weights or thresholds and present them as validated. Clearly label new AI suggestions.
For a critical criterion, define whether a zero, partial result or specific prohibited behaviour triggers the critical failure. A checkbox alone is insufficient.

### 5. Source links
Each derived criterion must link to the exact supporting content:
- Template ID and version.
- Task ID and revision, when available.
- Section ID, field ID and relevant text.
- Workflow step and agent-role identifiers, where available.
- Policy rule ID/version.
- Policy document ID/version and page/section, where available.
Links must open the relevant source in Authoring.
Preserve a snapshot or version reference for the content used during derivation. If the author later changes that source, identify the affected rubric as **Source changed—check rubric**. Do not silently rewrite an author-edited rubric.

### 6. Selection and editing behaviour
The author can:
- Accept a recommendation.
- Edit its wording, applicability or scoring.
- Add a custom criterion.
- Remove an optional criterion.
- Restore the previous saved version using existing history facilities.
If the author removes a criterion covering a mandatory requirement, show the resulting coverage gap. Do not silently describe the rubric set as complete.
Keep recommendations, author edits and existing approval status distinguishable. Reuse the existing Save and review/approval flow; do not introduce another approval stage.
On regeneration, preserve author edits and show proposed changes rather than overwriting them.

### 7. Applicability and scoring safeguards
- A conditional criterion is assessed only when its condition applies.
- Absence of a trigger is **Not applicable**, not an automatic full score.
- Missing information needed to determine applicability is **Unknown**, not automatically Not applicable.
- Missing evidence must remain distinguishable from observed incorrect behaviour.
- A human-officer duty must not become a requirement for the agent to exercise human approval authority.
- An optional permitted document or verification route must not become compulsory.
- Product and state conditions must follow the actual application.
- Shared requirements must not receive duplicate weight merely because they appear in several sections.
Source links and rubric generation do not prove that an evaluator is installed, calibrated or qualified. Automated scoring readiness remains a separate concern.

### 8. Export compatibility and release boundary
For this release:
- Store the new derivation metadata, source links and suggested annotations internally in Authoring.
- Preserve the existing export schema, fields, identifiers and semantics.
- Continue exporting existing approved rubric fields through the current supported mechanism.
- Do not add new fields or change scoring meaning in the payload without a separately agreed contract change.
- Do not export unsupported new criteria or annotations through improvised fields.
- Clearly identify any new internal information that RL Gym does not yet receive.
Exporting the additional metadata and using it in RL Gym will be a separately agreed enhancement. **No RL Gym changes are required for this Authoring-only phase.**

### 9. Acceptance criteria
1. Recommendations use S1–S4 and all other relevant sections according to the selected template's actual definitions.
2. Each criterion has a readable explanation and working links to its supporting sources.
3. Existing approved rubric IDs and scoring definitions are preserved.
4. Authors can edit applicability, evidence requirements and scoring.
5. Regeneration preserves author edits.
6. Source changes identify affected criteria without silently rewriting them.
7. Conditional, optional and human-role requirements are handled correctly.
8. Missing coverage, unresolved requirements and duplicate scoring are visible.
9. KYC and Marketing retain their respective approved scoring conventions.
10. Existing exports remain compatible and contain no unagreed schema or semantic changes.
11. No additional approval workflow is introduced.
12. This enhancement does not delay or gate the current RL Gym QA deployment.
