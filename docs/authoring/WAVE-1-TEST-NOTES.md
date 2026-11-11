# Wave 1 test notes: five templates, Praxis to Anvil

For the owner's QA session. Branch `feat/authoring-v21`. QA runs with **live Vertex** (mandatory).

Templates: KYC onboarding and refresh · KYB and beneficial ownership · AML transaction-monitoring alerts ·
Omnichannel Creative & Locale Compliance · Launch of Noise Cancelling Phone.

## 0. Before you start (once per deploy)

1. Admin → `GET /api/v1/admin/model-providers` shows `"mode": "vertex"` and the authoring model (in QA for now
   `gemini:gemini-3.8-flash`, until the Claude quota appeal succeeds). If it says `mock`, stop: QA is not on live Vertex.
2. Run the smoke check in QA (two small billed calls; the deployer creates this job):
   `gcloud run jobs execute praxis-vertex-smoke --region us-central1 --wait`. Exit 0 means the chatbot model and
   embeddings both answered; 2 means QA is on the mock; 1 means a call failed (the log line says which).
3. The chatbot is capped at `AUTHORING_DAILY_CALL_CAP` calls per day (default 300). Past it, the SME sees a clear
   message and keeps authoring in Classic.

## 1. Project setup (PM)

For each template: create a project, choose **Both** as the authoring experience and **SME → PM approval** as the
review route. Expert → PM is visible but disabled (Wave 2). The summary lists both choices. The template's agent mode
shows as **Single agent** and cannot be changed.

## 2. Authoring (SME), per template

1. Open the task. The header shows **Authoring** and **Single agent**.
2. **Classic:** fill the sections. Below the editor, choose **Start from the template workflow**. The workflow graph
   appears left to right: decision diamonds, the person in the case as a dashed rounded step, a correction loop drawn
   above, escalation exits.
3. Click a step; edit its name or instruction above the graph. Try **Add a step after this one**.
4. Break it on purpose: on the decision, change a condition's field to `typo.sufficient`. The status line turns red
   and the problem list says the field must start with an artifact id; click it to jump to the decision. Change it
   back. (The else and unknown routes cannot be removed in the UI at all.)
5. **Chatbot:** answer the facilitator's questions in your own words (live model). Ask it to "write the answer for
   me": it must refuse and redirect. The same graph is shown below, read-only.
6. Switch back and forth: the last keystroke and unsent chat text survive; no second task appears.
7. Narrow the window (or use a phone): the graph becomes a list with the same connections; no sideways scrolling.
8. **View as agent:** the graph appears without private reference material, rubric bindings or decision predicates.
9. Run checks, declare your own work, submit. The header shows **Approval pending: PM approval**.

## 3. Review (PM or authorised reviewer)

Open the task review. The same workflow graph is shown read-only below the task, with node details and the list
view. Try **Rework** with a comment: the SME gets the same task back. Resubmit, then **Accept**. The header shows
**Approved**. One earning only.

## 4. Export and import into Anvil (Admin)

For an approved record (`Projects → Approved exports` or the API):

| What | Endpoint | Notes |
| --- | --- | --- |
| Executable task contract (unchanged format) | `GET /api/v1/dataset/records/:id/praxis-contract?envelope=true` | `praxis.anvil.export.v1` envelope with `payload_sha256` |
| Authored workflow graph | `GET /api/v1/dataset/records/:id/workflow-graph` | `praxis.workflow_graph.v1-proposed`; header says Anvil does not execute it yet |
| Project policy manifest | `GET /api/v1/projects/:id/anvil/project-policy` | `praxis.anvil.project_policy.v1`; one per project |
| Policy source files | `GET /api/v1/projects/:id/anvil/project-policy/sources/<path>` | exact bytes; sha256 header |

In Anvil: import the envelope, then the manifest and its sources. Each task binding's `payload_sha256` must equal the
envelope's. The graph file is for inspection (and the read-only task viewer); Anvil executes the task contract only.

## 5. Known limits in Wave 1 (by design)

- Anvil does not execute workflow graphs yet; the graph travels beside the contract, never inside it.
- All five templates are Single agent for now (KYB included) so every export runs end to end.
- Rule severity in the policy manifest is always `high` (Praxis has no severity field yet); per-task policy
  exemptions block the manifest; see `docs/integrations/ANVIL-PROJECT-POLICY-V1.md` for the open questions.
- Field contracts outside KYC are marked "requires confirmation" until a domain owner confirms them.
- Expert → PM review, chatbot graph edits, joins/human steps added by the SME, SME policy uploads: Waves 2 and 3.
