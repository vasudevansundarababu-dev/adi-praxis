# Rubric and policy annotation details kept in ADI Forge (not sent to RL Gym yet)

Rubric editor and recommendations (plan: `docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md`). This release is Authoring-only.
**The export contract and payload are unchanged**, and no RL Gym change is needed. Sending the details below to RL Gym,
or using them there, would be a separately agreed change.

## What RL Gym still receives, through the existing fields

The S7 criterion items are exported exactly as before:
- `id`, `name`, `weight`;
- `passCondition` / `partialCredit` / `failCondition` (or levels 0–4);
- `critical`, `evidenceRefs`, `evaluatorKind`, `evaluatorVersion`;
- the output binding fields.

The editor changes where some of these values come from, but no field names, types or meanings change:

| Field | Source now |
| --- | --- |
| `evaluatorKind`, `evaluatorVersion` | The template's evaluator map (D9). These are the values the existing submit check already required. |
| `name`, scoring text, `weight`, `critical` | Start from the template defaults (D8) and the author edits them. `critical` keeps its meaning: a Fail on the criterion fails the whole task. |
| `evidenceRefs` | No longer written by the editor. Values saved earlier are kept. |
| S4 policy reference items | Picked from the project library (D6). The identity values are the project policy manifest's, in the same fields. |

## What RL Gym does not receive

These are stored in internal, append-only tables:
- `RubricRecommendationRun`
- `RubricCriterionAnnotation`
- `RubricTaskSources`

| Detail | Where it's kept |
| --- | --- |
| What should the agent do? | annotation `details.assesses` |
| Derived from: source links, with template and task versions, rule and document versions, the passage, and a snapshot hash | annotation `sources` |
| When does this apply? (kind, condition, exceptions) | annotation `details.applicability` |
| Whole-task failure condition text, and whether it's a Fail of the criterion or a behaviour needing evaluation setup | annotation `details.wholeTaskFailure` |
| What evidence should support the score? | annotation `details.evidenceRequired` |
| Derivation chain (step, role, skill), "why suggested", unresolved items, covered requirements | annotation `details` |
| Sources used for this task (the checkboxes) | `RubricTaskSources.items` |
| Suggested additions (criteria the template's evaluator map doesn't cover) | annotations with `x-` IDs; never written to S7 |
| Recommendation runs, including the original AI wording | `RubricRecommendationRun.result` |

Tests prove the boundary:
- `apps/api/test/rubric-derive.test.ts`: export modules never read these tables;
- `apps/api/test/anvil-generic-package.test.ts`: the pinned v6 package hashes;
- `apps/api/test/rubric-recommendations.test.ts`: the whole-task condition text never enters the task output, and
  additions never enter S7.

## Policy rule annotations (PR #81 work, merged here)

The classification, mandatory marking, applies-when, responsible actor and the rest of each rule's annotation are kept
in the rule body (`PolicyRuleBody.annotation`) and `PolicyRuleAnnotationRevision`. They are **not exported**: the
proposed RL Gym annotations document was not built (non-integration scope, owner 15 Nov 2026). The project policy
manifest v1 is unchanged.
