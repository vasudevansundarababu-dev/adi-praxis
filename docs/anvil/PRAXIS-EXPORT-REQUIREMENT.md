# Requirement for Anvil: export validation and resolution for every Praxis task

From: Praxis (owner Vasudevan, 12 Nov 2026). To: Anvil export API team (Golden KYC implementation and Anvil DevOps).
Re: `anvil.evaluator-task-export.v1` and `/dataset-exports/{contracts,validate,resolve}` (QA f50b9a8/schema077).

## 1. The requirement

The owner's requirement: **Praxis export to Anvil must be available for every approved Praxis task**, not only the
200 frozen Golden KYC tasks.

The current contract is Golden-specific. It accepts only the published `golden-kyc-run-evidence-v1` profile and the
exact frozen `anvil.golden-kyc.task.v1` sources. A task an SME authors in Praxis is therefore always rejected with
`PX_TASK_UNKNOWN` / `PX_TASK_PAYLOAD`, even when it is a KYC task in the Golden structure. That covers authoring the
investigation, binding rules by version and writing a 5/2/0 rubric.

Praxis needs one export contract that Anvil can validate and resolve for:

1. **Any template.** KYC v1 (workbench) and KYC v2 (account opening, Golden structure). The other Banking and
   Marketing templates. Forms Admins upload as golden task packs (`praxis.golden_pack.v1`). Single-agent and
   multi-agent tasks.
2. **Any approved task in a project:** one task (validate before export) up to the whole project.
3. **The frozen Golden tasks**, which stay supported exactly as today.

## 2. What Praxis can send for each task

Each approved Praxis task is an immutable, hash-chained record and carries the following.

**Header and inputs (agent-visible)**
- Header: task ID and revision, template and workflow, form (profile) ID and version, project, as-of date, language,
  jurisdiction or state, product.
- Agent-visible brief: objective, assignment and requested deliverable.
- Evidence: records with stable IDs, source and date, plus parties and their claimed roles.
- Environment: tool catalogue; recorded tool calls with arguments and responses, including error, 503/429 and pending
  observations; execution limits; and the assessment clock and calendar.

**Bound policy**
- Project rule versions: rule key, version ID, content hash, quotation, and where each rule applies.

**Private reference (never in the agent view)**
- Expected steps, findings, per-party assessment, follow-up rounds, reference outcome values, rationale and the
  business hand-off.

**Rubric**
- Criteria with weights totalling 100.
- Pass condition, partial-credit anchor (e.g. 5/2/0), critical flag and evidence links.
- Common errors and acceptable variations.

**Provenance and governance**
- Author attestations, Expert and PM review decisions, review history, and the synthetic-data declaration.

Praxis already computes the `praxis.anvil.task.v1` contract where a criterion binds to an output field.

## 3. Constraints Praxis keeps (owner decisions)

- **Evaluator-graded checks are not turned into agent-output fields.** That would change what is evaluated and let the
  agent claim its own compliance. Praxis needs a way to send criteria that Anvil grades over the observed trajectory.
- Private expectations stay out of the actor and public views. Praxis needs to know how Anvil wants to receive them:
  a separate private member, a separate grader-only upload, or a reference.
- `valid: true` is not approval, and Praxis review status is not transferred as Anvil approval.
- Paid model calls stay off for export, validation and resolution.

## 4. What Praxis asks Anvil to define (contract questions)

1. **Profile model.** How does a Praxis-authored task declare its evaluation profile? Either Anvil publishes a generic
   "Praxis authored task" profile, or Praxis publishes per-form profiles that Anvil qualifies. Praxis forms are
   versioned and immutable; a changed form gets a new ID.
2. **Criteria.** How an authored criterion (pass condition, anchors, critical flag, evidence links) maps to an Anvil
   evaluator: run evidence, business table, trace check, or a human/LLM judge (which stays off while paid calls are
   off).
3. **Environment.** How recorded tool calls become an executable environment, e.g. MCP replay of the recorded calls,
   instead of the Golden postgres runtime. Which logical environment hash Praxis computes.
4. **Private data channel.** Where reference outcomes, findings and rubrics travel, and how they stay grader-only.
5. **Package format.**
   - Is it the same ZIP envelope (manifest + profile + task files) with a new `schema_version`?
   - Do the limits change? Today the limits are 1 MiB compressed and 200 tasks; a project export may be larger, so
     should Praxis split it?
6. **Responses.** Keep `errors[]` (Praxis fixes, with file, pointer, message and fix), `anvil_requirements[]` and
   `review_gates[]` as they are. Praxis will display them separately. Please also list the new `PX_*` codes.
7. **Discovery.** `GET /contracts` should advertise every supported profile and version, so Praxis can tell the PM
   when a template is not yet supported by Anvil, instead of failing at validate.
8. **Resolution and receipts.** The same idempotency and immutable-receipt rules as the Golden contract, per package.
9. **Dates.** When can Anvil QA accept a generic Praxis task export, and in what order (KYC v2 first)?

## 5. What Praxis builds meanwhile

- A server-side Anvil export client: `GET /contracts`, `POST /validate` with a raw ZIP, `POST /resolve` with an
  Idempotency-Key.
  - Bearer token on the server only; never in the browser, the ZIP or logs.
  - Business errors are kept apart from auth, transport and internal errors.
  - 202 provisioning is shown as waiting; no success is invented.
- **Project page Export.**
  - The owning PM or an Admin can validate one approved task at any time, and export every approved task when the
    project is complete.
  - Results show the Praxis fixes, Anvil requirements and review gates separately.
  - Until Anvil advertises support for a task's form, the task is shown as "Anvil does not support this template yet",
    never as valid.
- Praxis QA paid-model controls are checked before any live test.
- **Live QA testing needs from the owner and Anvil:**
  - an Anvil export-client token, issued by the owner through Anvil's Admin flow;
  - installation of the token in the Praxis QA secret store;
  - a Praxis QA deploy approval.
