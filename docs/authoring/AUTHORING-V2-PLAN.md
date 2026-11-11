# Praxis authoring v2 — implementation plan and QA target

Source: `praxis-authoring-handover-v2.zip` (v2.0, 10 Nov 2026), chapters 00–16, verified against
`sha256-manifest.json` (53/53 files). Grounded in the current source: `main` at `e0bb46f` and the
authoring baseline `feat/conversational-case-authoring` at `3c191e9`.

Status: **plan for owner confirmation**. Nothing here is implemented or deployed by this document.

## 1. What the owner asked for

An **aggressive** path to a **test build by tomorrow**, covering:

1. the **task-authoring UI** (the Classic editor and the Chatbot editor, one shared task),
2. **SME review** (submit → review → rework, with the graph visible), and
3. **small changes to the existing project setup** (the authoring-experience choice and the review route).

And, per the standing decisions: authoring experiences are **CLASSIC / CHATBOT / BOTH**; all seeded
templates **publish by default**; the catalogue is **11 single-agent workflows** (Control testing,
Country-specific interpretation and AML were removed); the owner wants to **test chatbot effectiveness in
authoring** in QA.

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

## 4. Aggressive plan — phased, with a defensible "tomorrow" slice

The full v2 is multi-week. The aggressive plan front-loads a **thin vertical slice** that is genuinely
demoable tomorrow, then widens. Each phase ends in a working build; nothing is claimed done from a mockup.

### Phase 0 — baseline first (½ day)

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

### Phase 4 — policy bridge and two-stage route (later, not tomorrow)

Explicit **SME→Expert→PM** stage engine with exact-revision authority and invalidation; SME policy proposal
queue with qualification and authorised publication. Demo continues on the existing authorised final-review
path until this passes.

### Phase 5 — provider adapter and Anvil qualification (later, no paid calls)

Vertex MaaS adapter with **contract tests only** (no paid calls); per-template Anvil executable mappings;
unsupported graph/contract blocks export with a precise blocker.

## 5. QA target for tomorrow

Scope of the QA build: **Phases 0–3** on the **existing QA environment** (`adi-praxis-test-0928`; QA = test).
No new environment. No paid provider calls.

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

**Out of scope for tomorrow's QA:** two-stage Expert→PM engine, SME policy publication queue, live MaaS calls,
per-template executable Anvil execution. These stay explicitly "not yet" in the QA notes.

## 6. Risks and honest limits

- **Base-branch risk:** the local implementation lives off `main`; if the baseline does not build cleanly on a
  fresh checkout, Phase 0 absorbs the time. Mitigation: Phase 0 is the gate and runs first.
- **Graph runtime:** the graph UI is deliverable tomorrow; the **executable** runtime/export is not. Say so.
- **Model calls:** the chatbot works on the existing Vertex path with the owner's staging approval; QA enablement
  of live Vertex is a separate switch. No paid calls in this plan's tests.
- **Not claimed:** a graph mockup, a dataset export or an SDK mock response is **not** production acceptance.

## 7. What I need from the owner

1. Confirm **base branch = `feat/conversational-case-authoring`** (`3c191e9`) for the new work.
2. Confirm the **tomorrow slice = Phases 0–3** and the 12 QA checks above.
3. Confirm QA uses the **existing** `adi-praxis-test-0928` and that enabling live Vertex in QA is in scope for the
   effectiveness test (or say "mock only" for tomorrow).
4. Name the **one or two templates** to focus tomorrow's authoring/chatbot QA on (e.g. KYC onboarding + one other).
