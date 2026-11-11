# Praxis authoring v2.1: aggressive build plan, template by template

Status: **proposed, awaiting owner go-ahead.** Written 10 Nov 2026 (America/Chicago).
Source of truth: handover **v2.1** (`praxis-authoring-handover-v2.zip`, 55/55 files checksum-verified),
chapters 00–18, plus the Anvil contract `praxis.anvil.project_policy.v1`. This plan **replaces**
`docs/authoring/AUTHORING-V2-PLAN.md` (the OpenHands plan on `docs/authoring-v2-plan`), which is not used.

## 1. Shape

The platform is built **once**; templates go live in **waves**. Every wave ends with its templates working end to end:
**author in Praxis → review → approve → export → import into Anvil.** The owner tests a wave in Anvil while the next
wave is built. Calendar days, weekends included.

| Wave | Ready for owner testing | Templates | Platform work that lands with it |
|---|---|---|---|
| 0 | Tue 10 Nov (tonight) | none | Baseline green on a fresh branch |
| **1** | **Wed 11 Nov** | **5:** KYC onboarding and refresh, KYB and beneficial ownership, AML transaction-monitoring alerts, Omnichannel creative and locale compliance, Launch of noise cancelling phone | Template registry and Classic renderer; WorkflowGraph v1 contract and checker; horizontal graph below both editors; SME → PM review; export plus the Anvil project policy manifest |
| **2** | **Fri 13 Nov** | **3:** Adverse media review, Enhanced due diligence, Customer risk rating | Graph authoring in Chatbot; full joins, loops and human steps in both editors; Expert → PM review route; template-aware question planner |
| **3** | **Sun 15 Nov** | **3:** Q4 global paid search query clustering, Fraud-risk/compliance handoffs, Compliance monitoring | SME policy proposals; Vertex MaaS open-model adapter; full regression and accessibility pass |

**Every wave's QA build runs on live Vertex**, and the owner's live Vertex session is part of the wave's sign-off.
| 4 | to confirm | 3 remaining: Communications surveillance, Audit and evidence preparation, Issue and remediation tracking | Not scheduled. See §6. |

**Why this wave 1:** these five are the workflows already exported to Anvil
(`handoff/anvil-seed-export`, v1 READY, v2 proposed). Anvil already imports them, so end-to-end testing can start
immediately. Wave 2 adds the Banking templates closest to KYC's structure; wave 3 adds the rest.

## 2. Ground rules (every wave)

- One canonical task. Classic, Chatbot and the graph are views of it. No second task, rubric or payable unit.
- One template registry drives every screen; one chatbot engine. Adding a template is configuration plus tests, not a
  new screen or chatbot.
- The graph is declarative data. It is never code, a shell command or an import path.
- Reuse existing services (save, consent, checks, review, payment, dataset, policy). Rebuild nothing that works.
- Every acceptance criterion gets a test. Tests use the real PostgreSQL + Redis (docker compose). Vertex, email and
  Stripe are mocked. No test makes a live or paid call.
- Every state change is authorised, idempotent and audited. `ApprovedTaskRecord` stays append-only.
- Legacy data and contracts (`praxis.anvil.task.v1/v2/v3`, `praxis.anvil.export.v1`, KYC `dependsOn` steps) remain
  readable and unchanged. No silent migration.
- Commit locally in small steps. No push, deploy or live model call without the owner saying so.

## 3. Definition of done for a template (every wave)

A template counts as live only when all of these pass for it:

1. **Profile registered:** fields, sections, help, examples and checks; an unsupported field type blocks it.
2. **Both editors:** a project with experience Both authors the task in Classic and in Chatbot. Same task, last
   keystroke survives a switch, reload keeps everything.
3. **Graph:** the template's workflow shows as the horizontal graph below both editors and passes the checker.
4. **Agent view:** private reference and rubric are absent from the agent payload and downloads.
5. **Review:** submit → rework with a comment → resubmit → approve keeps the same task; one earning only.
6. **Export:** the approved record exports as `praxis.anvil.export.v1` with its project policy manifest, both valid
   against Anvil's schemas; an unsupported graph returns an explicit blocker, never a false success.
7. **Live Vertex QA session (mandatory):** in the QA environment the chatbot, question planner and policy extraction
   run on **real Vertex** (not the mock). The owner authors at least one task per template, plus a policy and a rule,
   against the live model, within the approved spend cap. A wave is not done until this session has passed.
8. **Anvil import:** the owner imports the export into Anvil. This step is the owner's (Anvil is a separate repo).

Each wave ships a per-template Playwright journey covering 1–6, and a short test note listing what to try in Anvil.

## 4. Wave details

### Wave 0: Baseline (tonight)
Branch `feat/authoring-v21` from `feat/authoring-v2-ui` (`a5c9a32`). Import v2.1 chapters 17, 18 and the updated 00,
14 and traceability into `docs/authoring/handover-v2/`. Run API typecheck, API tests, candidate and web typecheck,
candidate and web production builds. Fix anything red.
**Exit:** all green; receipt in `docs/authoring/VALIDATION-V21.md`.

### Wave 1: platform core + 5 templates (Wed 11 Nov)
- **WorkflowGraph v1** (`packages/shared/src/workflow-graph/`): types and Zod schema for `input | agent_step |
  decision | join | human_step | output | escalation` nodes, roles, labelled edges, bounded loops, visibility; checker
  for unique and resolvable IDs, reachability, a reachable terminal, else and unknown routes on every decision,
  branch-aware joins, bounded loops with a reachable exhausted exit (nested included), a global transition cap and no
  private data in actor handoffs. RFC 8785 + SHA-256 hash. Schema id `praxis.workflow_graph.v1-proposed` until Anvil
  allocates one. Shared pass/fail JSON fixtures in `contracts/praxis/workflow-graph/fixtures/` for Anvil's Python tests.
- **Template agent mode** `SINGLE | MULTI`: migration, default `SINGLE`, read-only to SMEs and reviewers.
- **Template registry** (`packages/shared/src/template-profile/`) and one schema-driven Classic renderer. KYC keeps
  its workbench as a domain plug-in behind the same save, consent and check APIs.
- **Horizontal graph** below Classic and Chatbot: SVG with role boxes, decision diamonds, a distinct human node,
  labelled edges and loops routed above or below; shared selection; accessible list at 736, 390 and 320 px.
  Classic edits steps and decisions; Chatbot shows the same graph read-only this wave.
- **Review:** the existing SME → PM route under the three top-level states (Authoring, Review/Approval Pending,
  Approved), and the project's review-route setting (only `SME_PM` enabled this wave).
- **Export:** graph-aware capability check and blockers; emitter for `praxis.anvil.project_policy.v1` (one manifest per
  project, default policies, explicit exclusions, rule severity and visibility, source files with sha256, task
  bindings to the exact export payload hash), validated against Anvil's `schema.json` plus its semantic checks.
- **Live Vertex in QA:** the authoring chatbot and planner use the existing Vertex wiring (`VERTEX_PROJECT_ID`,
  Claude/Gemini on Vertex) in the QA environment, with spend caps and per-call usage logging. Automated tests keep
  the mock. A QA smoke check confirms the live model answers before the owner's session.
- **The 5 templates** registered and passing §3, including the live Vertex QA session.

### Wave 2: review route and full graph authoring + 3 templates (Fri 13 Nov)
- **Expert → PM:** approval binds to an exact immutable revision; Expert edits with a recorded reason (new revision,
  checks re-run) or returns; PM approves the exact checked revision or returns; any change voids earlier approvals;
  same person may do both, with two audit events. Reviewer screen shows the graph, version diff, policy sources and
  node- or field-pinned comments.
- **Graph authoring complete in both editors:** joins, loops (configurable limit, exhausted exit), human steps
  (actor role, response schema, timeout route). Chatbot proposes graph changes from the SME's own words; the SME
  confirms each one.
- **Question planner:** template-aware, deterministic first, model behind the provider interface (mocked); handles
  corrections such as a missing SSN/TIN across affected fields; no answer generation; safe redirects.
- **The 3 templates** registered and passing §3.

### Wave 3: policy and model + 3 templates (Sun 15 Nov)
- **SME policy proposals:** upload as pending (original bytes and hash kept, unreadable or unrelated content flagged),
  Expert reviews, publication through the existing rule-set services. Retrieval returns only approved,
  permission-filtered, current policies.
- **Vertex MaaS open-model adapter** (chapter 11) added alongside the Claude/Gemini-on-Vertex path already live in QA
  since wave 1; contract tests against a mock, then a live comparison in the owner's QA session.
- **Full regression** (project, staffing, policy, review, payment, annotation, dataset) and accessibility checks.
- **The 3 templates** registered and passing §3.

## 5. Not in this plan

LangGraph runner, Harbor adapter, actual-human runtime execution and the Anvil task viewer (all in `adi-anvil`);
two-SME adjudication; SME-versus-LLM comparison; model training; new cloud provisioning; paid benchmark runs.

## 6. Defaults taken (owner can override)

| Open item | Default |
|---|---|
| Template agent modes | All `SINGLE` for now, so every wave exports end to end. `MULTI` is switched on per template once Anvil can run multi-agent graphs. |
| The 3 templates not in waves 1–3 | Communications surveillance, Audit and evidence preparation, Issue and remediation tracking: not scheduled until the owner says |
| Field contracts outside KYC | Built from `templates/*/task.md`, marked "requires confirmation" |
| Same-person Expert and PM | Allowed, two audit events |
| Expert edit authority | Edit with a reason; a material edit needs the author to reconfirm |
| Mobile | Read and navigate; full editing is desktop |
| QA deploys | One per wave, each only after the owner says go; always with live Vertex enabled |

## 7. Risks

- **Wave 1 carries most of the platform in one day.** If it slips, the cut order is: Chatbot graph view (Classic only
  for a day), then the review-route setting, then the 5th template. The graph contract, registry, export and policy
  manifest are not cut.
- **Template contracts outside KYC are unconfirmed.** They ship as visible "requires confirmation" gaps, not as
  complete forms.
- **Anvil must accept two new formats:** the graph (`v1-proposed`) and the project policy manifest. Praxis validates
  against Anvil's published schema; Anvil's own import is the real test.
- **This departs from the CLAUDE.md rule of one milestone at a time.** Platform work and template waves overlap, so
  it needs the owner's explicit OK.
