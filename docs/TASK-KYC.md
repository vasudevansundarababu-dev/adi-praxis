# Task definition and workbench — Banking / KYC onboarding (draft)

Draft for review. Defines what an expert-authored KYC onboarding task contains, the screens an expert uses to write it, and how a Reviewer accepts it into the Approved Task Dataset. Other workflows reuse the same structure with their own fields. Built in M5.

Source: template row "KYC onboarding and refresh" in Taskflow.xlsx — primary work: assemble identity evidence, reconcile fields, detect gaps, recommend a risk-based disposition; verification: document/data checks, completeness, policy adherence, reviewer agreement; human gate: approval, rejection and high-risk classification remain authorized decisions.

## 1. Task anatomy

A KYC task is a self-contained, long-horizon case: an agent receives a synthetic onboarding file and tools, must work through several dependent steps, and ends with a recommendation that a human would approve. The author writes the case and the correct solution; RL Gym later uses both.

| Section | Fields | Notes |
| --- | --- | --- |
| Header | `title`, `slot_id`, `coverage_tags`, `difficulty` (1–5), `jurisdiction`, `language`, `estimated_steps` | Coverage tags come from the slot; open slots are tagged by the author |
| Scenario brief | `trigger` (new onboarding or periodic refresh), `customer_type`, `product`, `channel`, `business_context` | What the agent is told at the start, in plain language |
| Customer file | `parties[]` (role, name, dates, addresses, nationality or incorporation, identifiers), `ownership_structure` (for entities), `stated_purpose`, `expected_activity` | All synthetic; entities list directors, shareholders and beneficial owners with percentages |
| Evidence set | `documents[]`: type, issuer, dates, extracted fields, deliberate defects (e.g. expired, mismatched name) | Structured fields in v1; rendered document images optional later |
| Environment | `tools_available[]` from a fixed catalog: document check, registry lookup, sanctions/PEP screening, adverse media search, address check, risk calculator, request-info to customer | Each tool call returns author-defined synthetic results (below) |
| Tool responses | For each tool and input: the response the environment returns, including hits, near-matches and errors | Makes the task deterministic and replayable |
| Policy context | `policy_rules[]`: the synthetic policy the agent must follow (required documents per customer type, risk factors, escalation thresholds) | Written generically; never an employer's real policy |
| Constraints | `human_gate`: which decisions the agent may only recommend (approval, rejection, high-risk classification) | From the template; the agent must escalate, not decide |

The fixed tool catalog is shared across KYC tasks so RL Gym can run any task in one environment. Adding a tool is an Admin template change.

## 2. Synthetic data rules

Every person, company, document and identifier in a task must be invented. Experts draw on their experience of what happens, never on real records.

- The workbench offers a synthetic generator for names, dates, addresses and identifiers in valid-looking but reserved or clearly fictitious formats; authors are encouraged to use it.
- Names of real public figures may appear only when the scenario is explicitly a PEP or sanctions near-match and the listing data itself is synthetic.
- On save and submit, an automated scan flags likely real data: identifier patterns that pass real checksums, real company registry numbers, email domains and phone numbers of real organizations, and text copied from known sources. Flags block submission until the author edits or explains.
- Authors confirm on submit that the case contains no real customer, employer or confidential information (SME tab, C07 terms).
- Anything flagged and confirmed as real is quarantined, removed from the task and never enters the Approved Task Dataset.

## 3. Expected solution and rubric

The author also supplies the correct answer and how to grade it. This is what makes the task usable for RL: RL Gym compares an agent's trajectory and outcome against it.

| Section | Fields | Notes |
| --- | --- | --- |
| Reference trajectory | `steps[]`: order, action (tool call or reasoning step), input, expected result, why it matters, `depends_on` | At least 6 steps for difficulty ≥ 3; alternative valid orderings allowed via `depends_on` |
| Gaps and discrepancies | `findings[]`: what is missing or inconsistent, evidence reference, severity | E.g. name on passport differs from utility bill |
| Required outcome | `disposition`: recommend approve, recommend reject, request more information, or escalate; `risk_rating` (low, medium, high) with factors; `requests_to_customer[]` | Agent recommends; human gate decisions are escalated |
| Rationale | Short explanation citing findings and policy rules | Grounded only in the task's evidence |
| Rubric | `criteria[]`: name, weight, pass condition, critical flag | Seeded from template verification: document/data checks, completeness, policy adherence, correct escalation |
| Failure modes | `common_errors[]`: plausible wrong paths (e.g. approving despite expired ID, missing UBO above threshold) and how the rubric catches them | Feeds FLOW 4 reason codes |
| Acceptable variations | Outcomes or steps that are also correct | Avoids penalizing valid alternatives |

Validation on submit: every finding cites evidence in the task; every rubric criterion is testable against the trajectory or outcome; the disposition respects the human gate; weights sum to 100; at least one critical criterion.

## 4. Author workbench

The workbench opens from an accepted assignment (SME tab, C08). It is a guided editor with sections in order, autosave, and a progress rail showing which sections pass validation. Desktop-first; read-only on mobile.

| Screen | Purpose | Key behaviour |
| --- | --- | --- |
| W01 Slot brief | Shows the assigned slot (e.g. corporate, high risk, unclear beneficial owner), template instructions, the tool catalog and a sample accepted task from a different cell | Open slots ask the author to choose tags and name the edge case first |
| W02 Scenario and customer file | Scenario brief, parties, ownership structure | Synthetic generator inline; ownership percentages validated to total 100 per layer |
| W03 Evidence and tool responses | Documents with fields and deliberate defects; response table per tool and input | Warns if a tool the reference trajectory uses has no defined response |
| W04 Reference trajectory | Step list with dependencies, findings, disposition, risk rating, rationale | Checks every step's tool exists and every finding cites evidence |
| W05 Rubric and failure modes | Criteria, weights, critical flags, common errors, acceptable variations | Weights must sum to 100 |
| W06 Check and submit | Runs automated checks, shows similarity to existing tasks, confirms synthetic-data declaration | Submit is blocked by any failing check; author can see closest existing tasks to differentiate |

After submit the task is read-only for the author until the Reviewer returns it for rework. Rework keeps version history; the Reviewer sees what changed.

## 5. Automated checks and review

A task reaches a Reviewer only after passing automated checks; the Reviewer then judges realism, correctness, difficulty and distinctness.

**Automated checks (on submit)**

1. Schema completeness against `task_definition_schema` and `collection_schema`.
2. Internal consistency: dates in order, ownership totals, every trajectory step's tool has a response, every finding cites evidence.
3. Human-gate compliance: the expected disposition never has the agent approve, reject or classify high risk on its own.
4. Synthetic-data scan (section 2).
5. Similarity check against all accepted and pending KYC tasks (main tab, Task diversity and coverage).
6. Coverage-tag match: the case actually contains the slot's edge case (e.g. an expired document is present for an "expired ID" slot).

**Reviewer screens**

| Screen | Purpose | Key behaviour |
| --- | --- | --- |
| R01 Review queue | Tasks awaiting review, filtered by workflow, flagged items first | Reviewer never sees their own tasks or tasks from an expert they share a conflict with |
| R02 Task review | Full task read-only, automated check results, similarity panel with closest matches side by side | Checklist below must be completed before a decision |
| R03 Decision | Accept, request rework (with comments pinned to sections), or reject (duplicate, not realistic, incorrect, real data) | Accept writes the `ApprovedTaskRecord` in the same transaction |

**Reviewer checklist**

- [ ] Realistic: a practitioner would recognize this case.
- [ ] Correct: the reference trajectory and disposition are right under the stated policy.
- [ ] Covers the slot's edge case, and coverage tags are accurate.
- [ ] Difficulty rating is fair.
- [ ] Distinct from the closest existing tasks.
- [ ] Rubric would catch the listed failure modes.

Optional per project: a blind solve, where a second qualified expert works the case without seeing the solution; large disagreement with the reference sends it back for rework.

## 6. Example, acceptance criteria and open questions

**Illustrative slot** (all data invented): corporate customer, high risk, edge case "circular ownership". The author creates a trading company owned 60% by a holding company, which is 50% owned by a trust whose settlor is also a director of the trading company. Registry lookup returns a stale filing for the holding company; the screening tool returns a near-match for one trustee. The reference trajectory resolves the ownership chain, identifies the settlor as a beneficial owner, clears the near-match on date of birth, requests an updated filing, rates risk high, and escalates for approval rather than approving. The rubric marks "escalates instead of approving" and "identifies settlor as beneficial owner" as critical.

**Acceptance criteria**

- [ ] An expert can author a KYC task through W01–W06 with autosave and resume.
- [ ] Submit is blocked when any automated check fails, with the failing section highlighted.
- [ ] A task whose disposition approves or rejects without escalation fails the human-gate check.
- [ ] Likely real identifiers are flagged before submit.
- [ ] The Reviewer sees check results and closest similar tasks before deciding.
- [ ] Accepting a task writes one `ApprovedTaskRecord` containing the full task, solution, rubric, coverage tags and lineage.
- [ ] Every accepted task can be replayed in RL Gym using only its own tool responses.

**Open questions**

- [ ] Is the fixed tool catalog above the right set, or does RL Gym already define its tool interface?
- [ ] Structured document fields only in v1, or should authors also produce rendered synthetic document images?
- [ ] Minimum trajectory length and difficulty mix per project (e.g. 30% difficulty 4–5)?
- [ ] Should blind solve be on by default for KYC?
- [ ] How is an authored task paid: flat per accepted task, or by difficulty?
