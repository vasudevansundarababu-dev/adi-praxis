# Owner spec (15 Nov 2026): policy rule classification, mandatory marking and annotations

Pasted by the owner in the DevOps session on 15 Nov 2026. It is reproduced verbatim below.
Related input: the RL Gym (Atlas) review file `QA-all-policy-rules-TX-v7-20261115-Atlas-KYC-review.json` in the shared outputs folder. It classifies the 318 rules of project 7e5e96c5 into CORE_MANDATORY, CONDITIONAL_MANDATORY, PERMITTED_OPTION, REQUIRED_POLICY_REFERENCE, AUTHORING_GOVERNANCE, BANK_OPERATIONS_OR_OTHER_PRODUCT and SME_CLARIFICATION_REQUIRED, with per-rule reason, conditions, scope, evidence and flags, plus 5 SME questions.

---

Implement this in **Authoring → Project creation/setup → Policy Upload and Rules**. Preserve the existing navigation, rule editing and review/approval process. Do not add another approval stage.

### 1. Policy upload and extraction

When a policy document is uploaded:

1. Extract individual rules.
2. Preserve each rule’s original supporting text and source location.
3. Recommend its classification, applicability and responsible actor.
4. Display the recommendations as editable annotations on the Rules page.

Do not automatically mark every extracted rule as mandatory. Extraction does not constitute approval or legal validation.

### 2. Classification logic

Classify each rule using its meaning and surrounding policy context—not keywords alone.

| Classification | Meaning |
|---|---|
| Obligation | An action is required. |
| Prohibition | An action is forbidden. |
| Permission | An option is allowed but is not compulsory. |
| Definition | Defines a term, threshold, period or other parameter. |
| Applicability/precedence | Determines which policy applies or takes priority. |
| Unresolved | Insufficient or conflicting information prevents reliable classification. |

Handle compound statements explicitly:

**“The bank may accept a foreign passport only with a non-documentary check.”**

Extract two linked components:

- Permission to accept the passport.
- Mandatory non-documentary check **when that identification route is chosen**.

Similarly:

- “Must … unless …” is an obligation with an exception.
- “Must not …” is a prohibition.
- “May not …” requires interpretation in context; it must not automatically become permission.
- “Should …” must not automatically become mandatory unless the policy defines it that way.
- Definitions containing binding thresholds must remain linked to the rules that use them.

Preserve the original compound statement and the relationship between its extracted components.

### 3. Mandatory marking

Assign a separate, editable mandatory marking:

| Marking | Use |
|---|---|
| Mandatory | Required within the stated workflow scope. |
| Mandatory when applicable | Required when a specified condition is satisfied. |
| Permitted option | An allowed choice, with any mandatory companion conditions linked. |
| Required reference | Needed to interpret or apply another rule. |
| Other responsibility/scope | Belongs to another actor, product or operational process. |
| Needs clarification | Cannot be applied reliably until a gap or conflict is resolved. |

“Other responsibility/scope” does not mean the bank’s obligation is optional.

Do not use a single `required: true` flag as a substitute for these distinctions.

### 4. Editable annotations on the Rules page

Alongside each rule, show:

- **Mandatory marking**
- **Applies when**
- **Why**

Example:

> **Mandatory marking:** Mandatory when applicable  
> **Applies when:** A foreign passport is selected for the specified identification route.  
> **Why:** Accepting the passport is permitted; “only with” makes the accompanying non-documentary check compulsory.

Through the existing rule editor, allow the author to change:

- Classification and mandatory marking.
- Responsible actor.
- Applicable products/application types and jurisdictions.
- Trigger, prerequisites and exceptions.
- Workflow stage and deadline.
- Effective dates.
- Explanation.
- Dependencies and linked rules.

Show the supporting policy passage and page/section. Preserve the original extraction and record author edits with the editor identity, timestamp and annotation version. Do not overwrite the source quotation.

Missing information must remain explicitly unknown; the system must not invent conditions, deadlines or exceptions.

### 5. Applicability rules

Determine applicability from each application’s actual attributes.

For KYC:

- Application type determines the relevant processing requirements.
- Governing state determines the applicable state-policy conditions.
- Federal requirements and applicable state requirements are combined according to the approved precedence rules.
- A Project name or example state must not exclude an otherwise supported application.

For example, a **California Joint application** must receive the Joint requirements and applicable California policy rules. It must not be ignored because an authored example uses New York.

Distinguish agent actions from human-officer decisions, bank infrastructure duties and task-author responsibilities. Do not convert a human approval requirement into permission for the agent to approve.

Flag conflicts and unresolved dependencies rather than silently choosing an interpretation. Avoid double-counting duplicate or overlapping rules.

### 6. Export to RL Gym

Include the annotations with the approved exported rule versions.

For each rule, export:

| Information | Required contents |
|---|---|
| Identity | Stable rule ID, rule version and associated Project/template identifiers. |
| Source | Policy document ID/version/hash, supporting quotation and page/section or equivalent locator. |
| Meaning | Rule text and classification. |
| Mandatory annotation | Marking and plain-English explanation. |
| Applicability | Actor, application/product types, jurisdictions, trigger, prerequisites, workflow stage and effective dates. |
| Exceptions/timing | Exceptions, deadlines and the event from which a deadline is measured. |
| Relationships | Referenced policy/rule IDs and versions, compound-rule relationships and precedence. |
| Evidence | Known evidence requirements, with missing requirements identified explicitly. |
| Uncertainty | Unresolved questions, conflicts and dependencies. |
| Provenance | Original AI suggestion, current edited annotation, annotation version, editor identity/timestamp and existing approval status. |

Preserve existing identifiers, authentication, receipts and export semantics.

**Compatibility requirement:** first check whether the existing package supports these fields. Use its supported metadata extension where possible. If a schema change is necessary, document and agree a versioned change with RL Gym before release; do not silently change the contract.

Export annotations as structured data as well as readable text. Do not present AI suggestions as human-approved decisions. An edited rule or annotation must follow the existing versioning and approval rules before appearing in an approved export.

### 7. RL Gym interpretation

The exported annotations support policy-to-evaluator binding. They do not establish that an evaluator is installed, calibrated or qualified.

RL Gym must be able to distinguish:

- A mandatory rule that applies.
- A conditional rule whose trigger is not satisfied.
- A permitted option that was not chosen.
- A duty assigned to another role.
- Applicability that remains unknown.
- A rule that cannot yet be evaluated because evidence or dependencies are missing.

Unknown applicability or missing evaluation evidence must not silently become a pass or “Not applicable.”

### 8. Acceptance criteria

1. “May accept a passport” produces Permission / Permitted option, not a compulsory passport requirement.
2. “May accept … only with a check” produces linked permission and conditional-obligation components.
3. An obligation with an exception preserves both.
4. A prohibition remains a prohibition.
5. A binding threshold remains linked to its dependent rules.
6. Every rule displays editable Mandatory marking, Applies when and Why.
7. Original source text and edit history remain available.
8. Missing details and conflicts are visibly flagged.
9. A California Joint application is not excluded by an example’s different state.
10. Export preserves the exact approved rule and annotation versions, source references and relationships.
11. Existing approval, authentication and receipt behaviour is preserved.
12. No additional approval workflow is introduced.

Please confirm the proposed export-field mapping and any compatibility impact before implementing a package-schema change.
