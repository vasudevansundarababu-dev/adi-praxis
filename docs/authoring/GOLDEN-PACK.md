# Golden task packs: upload a new authoring form without a code change

Owner, 12 Nov 2026: Anvil benchmarks Praxis with golden tasks (KYC first, Marketing multi-agent next). A **golden task
pack** adds the authoring form for such a task, and its worked golden cases, through the console. No code change and
no deploy are needed. A pack is authoring and reference material only: execution, evaluation and reporting stay in
Anvil.

## What a pack contains (`praxis.golden_pack.v1`)

| Key | Required | What it is |
| --- | --- | --- |
| `schemaVersion` | yes | Always `"praxis.golden_pack.v1"`. |
| `source` | yes | Where the pack comes from, e.g. `"Golden marketing reference 1.0.0"`. |
| `profile` | yes | The authoring form: a `praxis.template_profile.v1` profile with `storage: "sections"` and `domainPlugin: null`. It has the eight sections S1–S8 built from the shared field types, and its contract mapping to the Anvil task. `agentMode` may be `"SINGLE"` or `"MULTI"`. |
| `template` | no | Only for a **new** workflow: domain name, primary work, verification criteria, human gate, skills, default TPT, task modes, and optional `coverageDimensions` and `edgeCaseCatalog`. Praxis creates the workflow's **draft** template already using the form. |
| `examples` | no | Up to 20 worked cases, `{ name, output }`, written in the form. Each must pass every form check. Rule citations may hold `{{RULE-KEY}}` placeholders, which are filled in with the project's published rule versions when the case is authored. |

Start from `docs/authoring/golden-packs/example-golden-pack.json`, the Golden KYC form and case relabelled as a new
workflow. A test (`packages/shared/test/golden-pack.test.ts`) keeps it valid.

## How to upload

1. Console → **Templates** → **Authoring forms and golden packs**.
2. Choose the pack file. Praxis checks it and **stores nothing yet**: it lists every problem, including each example's
   problems.
3. When the check passes, click **Upload pack**. The pack is stored append-only and audited.
4. **New workflow** (the pack has `template`): open the draft template it created, review it and publish.
   **Existing workflow:** open the workflow, create a new version, choose the form under **Authoring form** and publish.
5. PMs create projects from that version as usual (JD, rules, staffing). SMEs get the uploaded form; Expert and PM review
   are unchanged.

## Rules

- **Form IDs are never reused.** To change a form, upload it under a new ID (e.g. `golden-marketing-v2`) and choose it on
  a new template version. Projects keep the form of the version they were created from.
- Only Admins check and upload packs. PMs can list forms.
- Each API instance loads uploaded forms at start, after an upload and every minute.
- **Limits that still need code:** a field type outside the shared set (`text`, `long_text`, `number`, `date`,
  `pick_list`, `multi_select`, `evidence_record`, `repeated_array`, `policy_citation`, `tool_call`, `criterion`,
  `graph_binding`), or a specialised editor. The check names the field when this happens.
- **Anvil export:** a check graded by Anvil's own evaluators has no output binding, so the export is shown as blocked
  with that reason (owner decision, 11 Nov 2026). It is not converted into an agent-output field.
