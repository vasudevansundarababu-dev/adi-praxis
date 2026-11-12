# Marketing Task2: five-agent campaign task in Praxis

Owner decisions of 12 Nov 2026, on the review of the Golden Task2 Marketing authoring handoff v1.1
(`golden-marketing-design/outputs/Praxis-Golden-Task2-Marketing-Authoring-Handoff-v1.1`). The owner accepted all four
recommendations. Praxis authors and reviews the task; Anvil owns the environment, the private evaluator, data release,
reset and run admission.

## What is built

| Part | Where | Notes |
| --- | --- | --- |
| Template version | DM03 "Launch of Noise Cancelling Phone", version 2 | An Admin creates version 2 and chooses the form `marketing-campaign-task2`. Version 1 keeps its single-agent form. |
| Agent mode | Template version | Follows the chosen form: this form makes the version multi-agent. Audited on the template update. |
| Form | `packages/shared/src/template-profile/profiles/marketing-campaign-task2.ts` | Locales, budget authority, calendar, limits, Task3 execution mode; evidence release schedule (week 0-12); source data references; expected work by role; expected weekly decisions; expected budget handling; case outcome. |
| Rubric | Criterion field `scale: zero_to_four` with `groups` | Levels 0-4 (level 4 = pass condition, levels 2 and 0 required); groups A-G with weights 10/20/15/10/15/15/15; B needs 12 of 20 to pass. A group's criteria must total its weight. Six critical failures CR-01 to CR-06. |
| Starting workflow | `packages/shared/src/workflow-graph/marketing-task2-graph.ts` | Five roles; intent and performance in parallel to a join; Task3 as an external system; a simulated approver; revision loops of 2; a weekly loop of 12; 400 transitions. |
| Graph additions | `external_system` step; `simulated` on a person step | Shared by every template. Documented in `contracts/praxis/workflow-graph/README.md`. |
| Worked case | `GOLDEN_MARKETING_EXAMPLE` | US pair: hold at window 4, act at window 5 with the approved-creative reuse test inside the cap. |
| Tests | `packages/shared/test/marketing-task2.test.ts`, `apps/api/test/golden-marketing.test.ts` | Full cycle: template version, project, rules, staffing, authoring, checks, Expert pass, PM approval, dataset record. |

## Rules the build keeps

- **Source data by reference.** FineQuestions and ESCI rows are never copied into a task. The form records dataset,
  record range, checksum and licence; the rows stay in Anvil's fixture archive. FineQuestions may not be sold without
  further permission.
- **No private material to agents or external systems.** Reference outcomes are `private_reference`; an external
  system may not receive private artifacts.
- **The simulated approver is not a human decision.** The person step is marked `simulated`.
- **Executable Anvil export stays blocked** (`ANVIL_MARKETING_PROFILE_NOT_REGISTERED`, `ANVIL_ENVIRONMENT_NOT_QUALIFIED`)
  until Anvil registers a Marketing profile and qualifies its environment.

## Known limits

- The graph checker warns "several incoming routes" on the policy review and the weekly review. Both are reached by
  exclusive routes, never in parallel; the warning is advisory and does not block submission.
- The controller's weekly release and "apply" are not graph steps: the weekly cycle is the loop back to intake, and
  release timing is the evidence release schedule.
- Ten review cases are development material; the 200-case pilot is not authorised.

## Needs Anvil (Keystone)

1. **0-4 rubric.** Anvil's answer Q4 fixed 5/2/0 anchors. The owner keeps the author's approved 0-4 scale for Task2.
   Praxis asks Anvil to accept `zero_to_four` with groups and group minimums as a declared scale.
2. **`external_system` and `simulated`** graph additions, proposed for Anvil's runtime.
3. A Marketing evaluation profile, the gateway tools, the time-released fixture data (2.8 MB, over the 1 MiB upload
   bound) and the environment.

## QA setup (owner)

In QA the catalog job retired the Marketing domain for new projects. To try Task2 in QA an Admin opens DM03, creates
version 2, chooses the form "Golden Task2: campaign planning and weekly intent optimisation (five agents)" and
publishes it.
