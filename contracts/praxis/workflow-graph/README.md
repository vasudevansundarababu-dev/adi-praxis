# WorkflowGraph v1 (proposed)

Schema id: `praxis.workflow_graph.v1-proposed`. Provisional until Anvil allocates the final identifier; it must not
reuse `praxis.anvil.task.v1`, `v2` or `v3` (handover v2.1 chapter 17 §5).

The graph an SME authors for a task: roles, artifacts, nodes (`input`, `agent_step`, `decision`, `join`,
`human_step`, `external_system`, `output`, `escalation`), labelled edges, bounded loops and a global transition limit. It is declarative
data only: the strict schema rejects any extra field, so code, commands or import paths cannot be smuggled in.

- Source of truth: `packages/shared/src/workflow-graph/` (`schema.ts`, `validate.ts`, `projection.ts`, `layout.ts`).
- Fixtures for Anvil: `fixtures/valid/*.json` must produce no errors; each `fixtures/invalid/*.json` must produce at
  least the codes listed in `fixtures/expected.json`. Regenerate with
  `pnpm --filter @praxis/api exec tsx ../../packages/shared/scripts/write-workflow-graph-fixtures.ts`; the shared test
  suite fails on drift.

## Execution semantics the checks assume

- A non-choice node hands off to **every** successor (parallel). A `decision` takes exactly one branch: one per
  condition id, plus `else` and `unknown`. A `human_step` takes `responded` or `timeout`.
- Every cycle must close through a declared loop's return edge. Each loop has `maxIterations`, an exit, and an
  `exhaustedTarget` outside the loop that leads to an output or escalation.
- A `join` waits for its `requiredInputs`. A required input that some earlier choice can skip is an error
  (`JOIN_REQUIRED_MAY_NOT_ARRIVE`): mark it optional or restructure. No last-writer-wins merging; each artifact has one
  producer.
- Artifacts marked `private_reference` or `private_rubric` never reach an agent step, a role or a human step. An
  artifact with `revealAtNodeId` is withheld until the trial reaches that node.
- A `human_step` is a business person inside the case. It is never Praxis Expert review or PM approval. With
  `simulated: true` the environment plays that person (a scripted fixture), so its response is never a real human
  decision.
- An `external_system` (added 12 Nov 2026 for Marketing Task2) is a system outside the evaluated team, such as Task3
  media production: the team sends `sendsRefs` and receives `returnsArtifact`. It is neither an agent nor a person,
  never receives private material, and its behaviour is supplied by the environment. Proposed to Anvil; Anvil does not
  execute it yet.

## Content hash

`sha256(canonicalJson(graph without layout))`, where `canonicalJson` is RFC 8785 (JCS). Layout is presentation only.

## Agent projection

`agentGraphProjection` removes private and future artifacts, rubric bindings and decision predicates (outcome labels
remain). Praxis applies it server-side to every agent-facing payload.
