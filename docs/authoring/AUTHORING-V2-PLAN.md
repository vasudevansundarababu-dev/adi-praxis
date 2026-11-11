# Praxis authoring v2 — implementation plan and QA target

Source: `praxis-authoring-handover-v2.zip` (v2.0, 10 Nov 2026), chapters 00–16, verified against
`sha256-manifest.json` (53/53 files). Grounded in the current source: `main` at `e0bb46f` and the
authoring baseline `feat/conversational-case-authoring` at `3c191e9`.

Status: **plan confirmed by the owner 10 Nov 2026.** Phases 0–3 deliver the test build for tomorrow; Phases 4 and 5
start immediately once that build is deployed (**08:00 CST**) and run **in parallel**, template by template.

## 1. What the owner asked for

An **aggressive** path to a **test build by tomorrow (08:00 CST)**, covering:

1. the **task-authoring UI** (the Classic editor and the Chatbot editor, one shared task),
2. **SME review** (submit → review → rework, with the graph visible), and
3. **small changes to the existing project setup** (the authoring-experience choice and the review route).

And, per the standing decisions: authoring experiences are **CLASSIC / CHATBOT / BOTH**; all seeded
templates **publish by default**; the catalogue is **11 single-agent workflows** (Control testing,
Country-specific interpretation and AML were removed); the owner wants to **test chatbot effectiveness in
authoring** in QA. **Real Vertex Model Garden is enabled in QA** so the owner can author tasks, policies and rules
and export tasks to Anvil. Rollout is **template by template**.

## 2. What already exists (do not rebuild)

| Area | Where | State |
| --- | --- | --- |
| Project authoring experience (CLASSIC/CHATBOT/BOTH) | `packages/shared/src/projects.ts`, `apps/api/src/tasks/authoring-experience.ts` | **Local implemented** on `feat/conversational-case-authoring`; not on `main` |
| Server view enforcement (Classic-only rejects chat, Chatbot-only rejects Classic PUT) | `apps/api/src/tasks/authoring-experience.ts`, `routes/work.ts` | Local implemented |
| Conversation service, guards, authorship controls | `apps/api/src/tasks/conversation/{service,assistant,guards,authorship}.ts` | Local implemented |
| Shared consent/declarations, proposal confirmation | `packages/shared/src/authoring-conversation.ts` | Local implemented |
| Autosave / save-on-transition / failed-save retention | `apps/candidate/components/work/use-autosave.ts`, `task-page.tsx` | Local implemented |
| KYC typed workbench (W01–W06) | `apps/candidate/components/work/kyc-workbench.tsx`, `packages/shared/src/kyc.ts` | Existing |
| Generic Classic editor for other templates | `apps/candidate/components/work/task-page.tsx` | Existing (not full anatomy) |
| Project/template/JD/staffing/policy/review/payment/dataset | `apps/api/src/routes/*` | Existing; reuse |
| Template instructions (14 PDFs + registry) | `packages/shared/src/template-instructions.ts` | On baseline |
| Investigation map (earlier dependency view) | `apps/candidate/components/work/investigation-map.tsx` | Baseline; not the v2 horizontal graph |

**Decision to make:** the authoring work sits on `feat/conversational-case-authoring` (`3c191e9`), which is
**not** an ancestor of `main`. The new work should branch from that baseline so it builds on the local
implementation, not re-invent it. This plan assumes **base branch = `feat/conversational-case-authoring`**.

## 3. What to build (the handover's "DESIGN / TO BUILD")

From chapter 00 and the traceability CSV:

| ID | Deliverable | Chapter | Handover status |
| --- | --- | --- | --- |
| PR-03 | One template registry powering every Classic screen and the one chatbot | 05 | part local; **full registry/rendering to build** |
| PR-06 | Adaptive, template-aware question planner (beyond current deterministic prompts) | 06 | bounded context local; **planner to build** |
| PR-09 | Horizontal connected graph **below** both editors (nodes, diamonds, human step, bounded loops) | 05 | **mockup only** |
| PR-11 | SME policy submission → review → publication bridge | 07 | **to build** |
| PR-14 | Explicit **Expert → PM** two-stage review on an immutable revision | 08 | **to build** |
| PR-13 | Common **eight-section** renderer across templates | 04 | target renderer |
| PR-18 | Per-template executable Anvil contract qualification | 15 | partial adapters; gaps explicit |
| MODEL-01 | Vertex MaaS provider adapter | 11 | recommendation; **no paid call** |

## 4. Plan — Phases 0–3 for tomorrow, then Phases 4 and 5 start immediately and run **in parallel**

Not sequential. Phase 3 is the deployable test build for tomorrow. The moment the test deployment is up
(**08:00 CST tomorrow**), Phases 4 and 5 begin **immediately**, alongside the ongoing per-template rollout —
not after it.

```
NOW ─────────────► 08:00 CST tomorrow ──────────────────────────────► finish
Phase 0  baseline green            ┐
Phase 1  two editors, one task     ├─ test build (deployable)
Phase 2  horizontal graph          │
Phase 3  SME review loop           ┘
                                   │
                                   └─► Phase 4 (policy bridge + Expert→PM)  ┐
                                       Phase 5 (Vertex MaaS + Anvil export) ├─ START IMMEDIATELY,
                                       per-template rollout (A → B → C …)   ┘ RUN IN PARALLEL
```

### Phase 0 — baseline first (now, the gate)

Goal: get the local implementation onto a branch that can build and be reviewed.

1. Branch `feat/authoring-v2-ui` from `feat/conversational-case-authoring` (`3c191e9`).
2. Run the real checks on that baseline and record them: API typecheck, API tests (real PostgreSQL + Redis via
   docker compose), candidate typecheck, candidate production build.
3. Fix anything that does not build on a clean checkout. **This is the gate** — no new UI until the baseline is green.

Exit: baseline typechecks, tests pass, candidate builds. Receipt recorded.

### Phase 1 — the two editors and the shared task (1–2 days)

Goal: the SME sees the right editor, and both editors read/write **one** task.

1. **Project setup (small change):** keep the `authoringExperience` choice (CLASSIC/CHATBOT/BOTH) and surface it
   on the project screen; keep the server-side enforcement. Add the **review-route** selector
   (SME→PM, SME→Expert→PM) as configuration only (engine is Phase 4).
2. **Shared renderer:** one schema-driven renderer for the eight sections (chapters 04, 05) used by the Classic
   editor; keep the KYC workbench as the specialised domain plug-in behind the same save/consent/check APIs.
3. **Chatbot editor:** the conversation view with the persistent typed-answer composer, driven by the same
   canonical task; no second task, reference or rubric.
4. **Both:** the Classic/Chatbot tabs appear only for a BOTH project; switching never duplicates the task.

Exit: for a BOTH project, editing in one view is visible in the other after save; a Chatbot-only project
refuses Classic writes and vice versa; last keystroke survives a tab switch; failed save retains the editor.

### Phase 2 — the horizontal graph (1–2 days)

Goal: the connected graph below the authoring area, same in both editors.

1. Define the **WorkflowGraph v1** types (chapter 05): nodes (input, agent_step, decision, human_step, join,
   output, escalation), edges with labels/ports, decisions with else/unknown, joins with required inputs,
   bounded loops with an exhausted exit, visibility/reveal.
2. Render it **horizontally below** the authoring area in both views, left to right, with a compact accessible
   reflow (or graph list) at 736/390/320 widths.
3. Validation: reachability, one terminal output, role resolution, branch coverage, bounded cycles, compatible
   handoff schemas. Flag: ignored specialist result, decision without else, loop without exit, private-data leak.
4. Keep the business **human step inside** the graph; keep Expert/PM review **outside** it.

Exit: the same saved task produces the same graph in Classic and Chatbot; a decision without an else route and a
loop without an exit are rejected with a precise reason.

### Phase 3 — SME review (submit → review → rework) (1–2 days)

Goal: the demo review loop, reusing the existing one-stage authorised review.

1. Submit an **immutable revision**; the review workspace shows task/template/revision/policy snapshot and the
   graph below the evidence/assessment area.
2. Expert can ACCEPT / REWORK / REJECT with pinned field/node comments (existing services), returning the
   **same task**; no second payable unit.
3. Keep payment/dataset invariants: one eligible earning per accepted unit; export stays separate.

Exit: a reviewer returns a task with an actionable comment; rework keeps the task and comments; the accepted
revision is frozen and appears (still) as **"Approved; export adapter missing"** where no executable contract exists.

### Phase 4 — policy bridge and two-stage route (starts 08:00 CST tomorrow, in parallel)

Explicit **SME→Expert→PM** stage engine with exact-revision authority and invalidation; SME policy proposal
queue with qualification and authorised publication. Runs alongside the per-template rollout, not after it.

### Phase 5 — provider adapter and Anvil export (starts 08:00 CST tomorrow, in parallel)

Real **Vertex Model Garden** authoring (live model, not mock) so the owner can author tasks, policies and rules
and **export tasks to Anvil**. Per-template Anvil executable mappings, template by template. Unsupported
graph/contract blocks export with a precise blocker. No paid calls in automated tests; live calls only in the
owner's QA authoring session, within the approved cap.

### Per-template rollout (in parallel, A → B → C …)

The authoring UI, chatbot and graph are built **once** and driven by the template registry (PR-03). Rollout
proceeds **template by template**: register a template's versioned profile, confirm its field/outcome contract
and graph, then qualify its Anvil export. Start with KYC onboarding (existing typed fields), then the other
banking workflows, then the two Digital Marketing templates. A template with an unsupported field type is
disabled with a diagnostic — never shown as an apparently complete blank form.

## 5. QA target for tomorrow

Scope of the QA build: **Phases 0–3** on the **existing QA environment** (`adi-praxis-test-0928`; QA = test).
No new environment. **Real Vertex Model Garden is enabled in QA** so the owner can author tasks, policies and
rules with a live model and exercise Anvil export; live calls stay within the approved cap and no paid calls run
in automated tests.

| # | QA check | Pass criteria |
| --- | --- | --- |
| 1 | Baseline regression | API typecheck + tests green on the branch (real Postgres + Redis) |
| 2 | Project setup | New authoring project requires CLASSIC/CHATBOT/BOTH; survives reload; review route selectable |
| 3 | Both, one task | Edit in Classic, switch to Chatbot: same task, no duplicate; unsent answer retained |
| 4 | View enforcement | Chatbot-only rejects Classic PUT; Classic-only rejects chat writes |
| 5 | Save on transition | Final keystroke followed by tab switch is saved; reload shows it |
| 6 | Failed save | Stay in view with text; not claimed saved |
| 7 | Eight sections | Every applicable section editable; arrays via Add; submit section is validation/actions |
| 8 | Horizontal graph | Connected decisions/human step/loops below the editor, identical in both views; reflows at 736/390/320 |
| 9 | Graph validation | No-else decision and unbounded loop rejected with a precise reason |
| 10 | Agent projection | Private rubric/solution absent from the View-as-Agent payload |
| 11 | Review loop | Submit → rework with comment → resubmit keeps the same task; one eligible earning only |
| 12 | **Chatbot effectiveness (owner priority)** | On a banking template, the bot asks template-aware questions, extracts the SME's own words into sections, does **not** author substantive content, and safely redirects off-topic/"generate my answer" requests |
| 13 | Author → policy → rule (live) | Owner can author a task, propose a policy and a rule against the live QA model |
| 14 | Anvil export | A finished task exports toward Anvil; a missing executable contract returns an explicit blocker, not a false success |

**Out of scope for tomorrow's QA build (starts 08:00 CST, in parallel):** the two-stage Expert→PM engine and the
SME policy publication queue (Phase 4); the full Vertex MaaS adapter and per-template executable Anvil execution
(Phase 5). These are explicitly "not yet" in the QA notes for the 08:00 build and land next, in parallel.

## 6. Risks and honest limits

- **Base-branch risk:** the local implementation lives off `main`; if the baseline does not build cleanly on a
  fresh checkout, Phase 0 absorbs the time. Mitigation: Phase 0 is the gate and runs first.
- **Graph runtime:** the graph UI is deliverable tomorrow; the **executable** runtime/export is not. Say so.
- **Model calls:** real Vertex Model Garden is enabled in QA per the owner's decision; live calls stay within the
  approved cap and no automated test makes a paid call.
- **Not claimed:** a graph mockup, a dataset export or an SDK mock response is **not** production acceptance.

## 7. Owner decisions — answered 10 Nov 2026

1. **Tomorrow's slice = Phases 0–3** (task authoring UI, horizontal graph, SME review). ✅
2. **Phase 4 and Phase 5 start immediately** once the test deployment is up (target **08:00 CST tomorrow**), and
   run **in parallel** with the per-template rollout — **not** sequentially. ✅
3. **QA uses the existing test environment** and **real Vertex Model Garden** is enabled there, so the owner can
   author tasks, policies and rules and export tasks to Anvil. ✅
4. **Per-template rollout:** go **template by template**, starting with KYC onboarding, then the other banking
   workflows, then the two Digital Marketing templates. ✅
5. **Base branch = `feat/conversational-case-authoring` (`3c191e9`).** ✅ (assumed; correct if the baseline is the
   intended starting point)

## 8. Definition of done for tomorrow (08:00 CST)

- The test build is deployed to QA and reachable.
- Phases 0–3 pass their QA checks (table above, checks 1–12).
- Real Vertex Model Garden is live in QA; the owner can author a task, a policy and a rule, and start an Anvil
  export (checks 13–14).
- Phase 4 and Phase 5 work has **already started** on parallel branches, not queued behind the deployment.
