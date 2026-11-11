# 05 One template-driven platform and graph contract

## Shared template architecture

Every published template has a versioned authoring profile: identifier/version, agentMode, enabled task modes, field schema, section layout, requiredness/conditional rules, pick lists, tools/input schemas, source permissions, examples/help, reference solution shape, rubric shape, deterministic check registry and export capabilities. This profile drives ONE Classic renderer and ONE chatbot context builder. A schema adapter maps the author's terminology to the existing canonical contract. Do not generate new field names from chat prose.

Use shared primitives for text, long answer, number, date, pick list, multi-select, evidence record, repeated array, policy citation, tool call, criterion and graph binding. A domain plug-in is permitted for a specialised control, but it uses the same save/consent/check/projection APIs. Template registration tests prove that both editors expose required fields and preserve unknown legacy metadata. A template with an unsupported field type is disabled with a diagnostic; it must not fall back to an apparently complete blank form.

Single-agent templates use steps and dependencies for one executor. Multi-agent templates additionally declare roles, handoff artifacts, tool permissions, joins and branch/loop contracts. One hundred independent cases are one hundred trials; record count does not itself make a task multi-agent. Authoring experience, agent mode and human review route remain independent.

## Horizontal graph layout

At desktop widths the graph runs left to right beneath the authoring area: case evidence -> parallel specialists -> evidence decision -> consolidation -> human-referral decision -> business review -> final outcome. Missing evidence branches downward to a request and returns to the case input. Corrections return above the main path to consolidation. Exhausted or unresolved cases exit to a case lead. Use decision diamonds, role rectangles, a distinguishable human node, labelled directional edges and terminal boundaries. The same selected role and confirmed wording are shared by Classic and Chatbot.

Keep the graph shorter than the previous tall vertical design; the current desktop reference is roughly 620 pixels tall. That is a design dimension, not a hard limit for all workflows. On smaller screens reflow connections into a readable compact layout or accessible graph list. Do not scale fixed text into illegibility, crop loops or force the whole page to scroll horizontally. Large enterprise graphs may need a separately designed pan/zoom workspace.

## Proposed WorkflowGraph v1 fields

This is a TARGET extension. Current KYC KycStep only supports TOOL/REASONING and dependsOn; it cannot encode the full graph below. Preserve current data until a versioned migration and export adapter exist.

| Field | Author/reviewer meaning | Validation |
|---|---|---|
| schemaVersion / templateVersion | Identify the graph and field contract. | Pin both; refuse unsupported versions. |
| nodes[].id/type/label | Stable node, kind and visible name. | Unique ID; allowed kinds: input, agent_step, decision, human_step, join, output, escalation. |
| nodes[].roleId | Executor responsible for an agent step. | Must resolve to declared role; no autonomous human impersonation. |
| instruction / inputRefs / outputArtifact | Specify work, available evidence and required handoff. | Inputs known and visible; output schema explicit. |
| policyRuleVersionIds / rubricCriterionIds | Bind authority and assessment. | Resolve to approved applicable rules and current rubric. |
| decision.conditions[] | Define branches and conditions. | Each edge has an observable condition, explicit else/unknown route and approved basis. |
| join.requiredInputs | Define which outputs are required before continuation. | No ambiguous “wait for all” when some branches are optional. |
| human.actorRole / responseSchema | Define business authority and human interaction. | Expected choices/timeouts/recorded response or supported human-in-loop runtime contract required. |
| edges[].from/to/port/label | Define a connected directed handoff. | Both endpoints exist; compatible artifact schemas; all decisions labelled. |
| loop.id/returnEdgeId/maxIterations | Identify a bounded correction route. | Positive configured limit; no unlimited cycle. Two is illustrative, not a universal rule. |
| loop.exitCondition/exhaustedTarget | Define success and unresolved behaviour. | Both routes terminate or escalate; no silent successful outcome. |
| visibility / revealCondition | Limit artifacts per role/stage. | Private rubric/solutions excluded; future evidence revealed only under the contract. |

Do not encode a loop as a cyclic dependsOn list in the existing DAG model. Store transitions and loops separately and validate bounded reachability. A graph node for “human reviewer” without an interaction contract is authoring design only, not an executable benchmark feature.

## Graph checks

Validate reachability from input, at least one valid terminal output, stable references, role permissions, required joins, branch coverage including unknown/error, bounded cycles and compatible handoff schemas. Flag a specialist whose result is ignored, a decision with no else/unknown path, a loop without an exhausted exit, and private-data leakage through a handoff. Review whether an authorised human step is actually required by the case; never insert platform review into the business graph.

## Anvil mapping

Evidence -> source artifacts and visibility. Constraints -> permitted actions and policy requirements. Tools/responses -> environment call contract and recorded fixtures. Agent steps -> actions/stages with input/output bindings. Reference solution -> private reference_output. Rubric -> criterion/evidence/rule bindings with defined scoring. Graph branches/loops/human interactions -> supported versioned execution contract. Unsupported elements must block executable export. Do not flatten decisions or human judgement into a single prose stage and claim equivalent benchmarking.
