# Template Studio (ADI Forge console): design for approval

**Status:** draft for the owner's approval, 15 Nov 2026. No feature code yet.
**Mockup:** `docs/design/mockups/template-studio.html` (open it in a browser; everything is clickable, nothing is saved).
It rebuilds **KYC v7** and **Marketing VEYRA Hush One** from their real data (fields, 21 KYC tools, the 20 KYC
criteria at 5/2/0, the 23 VEYRA criteria in groups A–G at 0–4, case-selector values, CR-01 to CR-06). The lint
findings, step-to-criterion links, AI draft and VEYRA level texts are illustrative. The tour bar at the bottom walks
through: live preview, aspects and gaps, picking from the domain pack, drafting a blueprint, lint, preview as agent,
and Publish disabled until approval.

What the mockup's lint finds on the real templates (worth knowing even without the Studio):
- KYC v7's `caseSelector` carries no `labels`; labels fall back to the S1 pick list.
- GB-01 to GB-07 have IDs, versions and SHA-256 but no titles anywhere in the repo.
- KYC v7 has no coverage dimensions or edge cases (correct for a selector template), and VEYRA declares none.
**Decisions taken by Claude:** `docs/DECISIONS.md`, "Template Studio: design defaults (15 Nov 2026)".

This is an internal design doc, so it uses internal names (Praxis, Anvil) where it talks about code and contracts.
Everything users see says **ADI Forge** and **RL Gym**.

---

## 1. Why

Each template today is one large hand-written form (a `praxis.template_profile.v1` profile plus an execution part).
KYC v7 arrived as one large RL Gym proposal (`apps/api/test/fixtures/kyc-v7/proposal.json`); VEYRA Hush One is a
hand-written profile (`profiles/marketing-campaign-task2.ts`). Adding a template means writing all of that by hand and
finding the gaps later, in QA or in a reviewer's rejection. That doesn't scale to the dozens of templates that
benchmarking needs.

The owner's requirement, in their words: *"I want this as utility. We should see SME form while we author template so
that it becomes easier. Only when we see all aspects then only we will author."*

So the Studio is built around three ideas:

1. **See the SME form while you build the template.** The right half of the screen is a live preview of the exact
   task form the template will produce.
2. **Don't hand-write what is shared.** Policies, tools, data schemas, safety rules and rubric families come from a
   reusable **domain pack**. Only the workflow itself (the **blueprint**) and the **coverage plan** are unique to a
   template.
3. **Don't publish with gaps.** A **compiler** turns pack + blueprint + coverage into the profile, and a **lint**
   finds the gaps. Seven **aspects** must all be complete, and a person must approve, before Publish opens. AI only
   suggests.

## 2. Goals and measures

| Measure | How it is measured | Today (baseline to record in phase 1) | Target |
| --- | --- | --- | --- |
| **Time to add a template** | From "New template" in the Studio to the version reaching PUBLISHED (audit timestamps), for a template in an existing domain pack | Days to weeks (hand-written profile, fixes after QA) | **Under 1 working day** in an existing pack; under 3 days with a new pack |
| **SME minutes per task** | Active editing time per accepted task (autosave intervals, idle gaps over 5 min dropped), median per template | Record for KYC v7 and VEYRA in phase 1 | **30% lower** than baseline, because fixed parts are pre-filled and locked |
| **Reviewer rejection rate** | Rework + Reject decisions ÷ all first-review decisions, per template version | Record in phase 1 | **Under 15%** on the first review |
| **Reviewer agreement** | On a 10% double-reviewed sample: share of criteria where two reviewers give the same score (and Cohen's kappa) | Not measured | **80% or more** agreement, kappa 0.6 or more. Phase 5 (needs a second reviewer and RL Gym results) |
| **Lint escapes** (supporting) | Defects found in QA or review that the lint could have caught | n/a | Zero repeats: every escape becomes a new lint rule |

The first three come from data Praxis already records (audit log, autosave, review decisions). Phase 1 adds a small
read-only "Template measures" panel in the Studio so the baseline exists before anything changes.

## 3. Who uses it

- **Admin (template author):** builds and edits templates in the Studio, requests approval.
- **Admin (approver):** reviews the aspects, lint and preview, and approves. Approval is a person's decision.
- **PM:** can open the Studio read-only (preview and aspects), to see what an SME will get before creating a project.
- **RL Gym:** still proposes templates through the existing proposal API. The Studio opens those proposals the same
  way (section 7).

SMEs and Reviewers never see the Studio. They see the result: the task form.

## 4. The screen

```
┌ ADI Forge · Templates › Template Studio ─────────────── [KYC v7 ▾]  Preview as [SME|Agent]  [Request approval] [Publish] ┐
│ Aspects:  ● What to capture  ● Policies and rules  ◐ Rubric and scoring  ● Environment and tools                         │
│           ◐ Coverage and edge cases  ● Outputs  ○ Safety                        5 of 7 complete · 3 lint findings         │
├──────────────────────── Template (left) ─────────────────┬──────────── Live SME preview (right) ──────────────────────────┤
│ Parts: Pack · Blueprint · Form · Rubric · Coverage · Lint │  Exactly the SME task form, in the candidate app's look        │
│                                                          │  S1 … S8 tabs, locked fields 🔒, S4 picker, S7 rubric          │
│  (the part being edited)                                 │  editor with defaults, Sources checkboxes, case selector,      │
│                                                          │  coverage slot brief, Save bar, Ember help                     │
│                                                          │  Highlights what the last edit changed                         │
└──────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘
```

- **Left: the template, in parts.** Each part is one tab: **Pack** (choose from the domain pack), **Blueprint** (the
  workflow), **Form** (what the SME types, what is pre-filled and locked), **Rubric**, **Coverage**, **Lint**.
- **Right: the live preview.** It is the real SME form component fed with the compiled draft profile (no copy of the
  form). It updates on every change (debounced, about 300 ms). The field or section the last change touched is
  highlighted. A **slot** chooser shows the form for each case-selector value (KYC v7: Single, Joint, Minor (joint with
  adult), Custodian).
- **Preview as Agent.** Shows only what the agent will receive: `author_and_agent` fields, the tool catalogue, the
  policies by reference and the output schema. `private_reference` and `private_rubric` fields (rubric, expected
  answers) are shown as "hidden from the agent", so the author can check nothing leaks.
- **Aspects bar.** Seven aspects, each Complete, Has gaps or Not started. Clicking an aspect lists its gaps; each gap
  links to the part and the item where it is fixed. Section 6 defines each aspect.
- **Publish.** Disabled until every aspect is complete **and** a person has approved this exact draft. The button's
  hint says which of the two is missing.

## 5. The template model

A template version is **compiled** from four things. Only the last two are unique to the template.

### 5.1 Domain pack (reused across templates)

A versioned bundle per domain (Banking / KYC, Marketing). Each item has a stable ID and a version.

| Pack part | What it holds | Where it comes from today |
| --- | --- | --- |
| **Policy library and rule sets** | Published policy documents, rules with annotations (mandatory marking, applies-when, responsible actor), federal policy references | Policies page, extraction, PR #83 annotations, `execution.federalPolicies` |
| **Tool catalogue / environment** | Tool IDs with input and output schemas, environment name, capability catalogue version | `execution.tools`, `capabilityCatalogVersion`; KYC: 21 tools in "Golden KYC OpenEnv" |
| **Fixture and data schemas** | The shapes of the shared runtime inputs (application snapshot, campaign brief), never data | S2 input contracts in the current profiles |
| **Safety rules** | Synthetic data only, human gates (decisions the agent must never make), no real customer or employer data, paid calls off | Template `human_gate`, the D3 declaration, `paid_calls: false` |
| **Criterion library** | Rubric families with their scoring scale: evidence grounding, policy application, tool use, hand-offs, output completeness, safety | KYC: `golden-kyc-rubric-v1` defaults (20 criteria, 5/2/0). Marketing: 0–4, groups A–G |

**Scales are part of the pack and never mix.** A pack declares its scale (KYC: `five_two_zero`, Pass 5 · Partial 2 ·
Fail 0, 20 criteria × 5 = 100. Marketing: `zero_to_four`, criterion weight × level / 4, groups A10 B20 C15 D10 E15
F15 G15 = 100, minimum total 80 and adaptation 12, critical rules CR-01 to CR-06). The Studio has no control to change
a template's scale, and the lint refuses a criterion from a family with another scale.

### 5.2 Workflow blueprint (unique per template)

Steps, roles, decisions, branches, loops and required outputs, stored as the existing `praxis.workflow_graph.v1-proposed`
graph. Two ways in:

- **Draft from a description.** The author pastes a one-page description or SOP (synthetic only). AI proposes roles,
  steps, decisions, branches and outputs, each labelled **AI suggestion** with Accept and Reject. Nothing is added
  until the author accepts it. The model is the existing authoring route (`AUTHORING_MODEL`, Gemini on Vertex in QA),
  behind `STUDIO_AI_ENABLED` (off by default). Tests use the mock.
- **Edit the graph.** The existing workflow graph editor, unchanged, inside the Blueprint part.

Each step names its role, its tools (from the pack's catalogue), the rules it applies (from the pack's rule sets) and
its outputs. These links are what the compiler and the lint use.

### 5.3 Coverage plan (unique per template)

- **Case selector:** the generic `caseSelector {field, source, values, labels}` built for KYC v7. One task per value.
- **Edge-case quotas** and coverage dimensions, as in SPEC "Task diversity and coverage". For a case-selector
  template, the arrival check refuses quotas that would add tasks (`TP_CASE_SELECTOR_UNSUPPORTED`), and the Studio
  applies the same rule while editing, so the author can't build something the arrival check will refuse.
- **Slot brief preview:** the brief an SME will read for each slot.

### 5.4 Form choices (per template)

For each field the compiler would put in S1–S8, the author chooses one of three:

- **SME types it** (per-task field).
- **Pre-filled and locked** (🔒 in the form: the value comes from the pack or blueprint, e.g. tool list, output
  schema, the case-selector value, federal policy references).
- **Not shown** (the agent and the SME never see it; kept for reviewers or RL Gym only).

The goal is that the SME types only what genuinely changes per task.

## 6. The seven aspects

Each aspect is computed from the compiled draft and the lint. It is never set by hand.

| Aspect | Complete when | Typical gap and where it links |
| --- | --- | --- |
| **What to capture** | Every S1–S8 field has a mode; each SME-typed field has a label, help text and an example; no field asks for case facts | "S2 Application input contract has no example" → Form › S2 |
| **Policies and rules** | A published rule set is pinned; every blueprint step that needs a rule has one; every applied rule is used by a step | "Rule GB-05 is not used by any step" → Blueprint › step |
| **Rubric and scoring** | One scale from the pack; weights total 100 with no duplicate weighting; every step has a criterion; every criterion has "how it will be checked" (an evaluator, or marked internal) | "Step 'Verify custodian's authority' has no criterion" → Rubric |
| **Environment and tools** | Environment chosen; every tool a step uses is in the catalogue; no selected tool is unused | "Tool `search.read` is selected but no step uses it" → Pack › Tools |
| **Coverage and edge cases** | Case selector (or coverage dimensions) valid; each required edge case has a quota (or "none" is confirmed); the arrival check would pass | KYC v7: "The case selector has no labels" → Coverage. VEYRA: "No edge cases declared" → Coverage |
| **Outputs** | Output schema present; every required output is produced by a step and checked by a criterion | "Output `handoff` is not produced by any step" → Blueprint |
| **Safety** | The pack's safety rules are applied: synthetic only, human gates on the right steps, paid calls off, no internal names in user-facing text | "Human gate not set on 'Approve exception'" → Blueprint › step |

## 7. Compiler and lint

### 7.1 Compiler

Pure functions in `packages/shared` (no I/O, so the preview, the API and tests use the same code):

```
compile(pack@version, blueprint, coverage, formChoices) →
  { profile: praxis.template_profile.v1,          // the SME form: per-task fields only, the rest pre-filled and locked
    rubric: criterionDefaults + derivation chain,  // from the rubric recommendations work (derive.ts)
    caseSelector / coverage slots,
    evaluatorMapping (proposed),                   // criterion ID → evaluator, for RL Gym to confirm (section 8)
    manifest: { packVersion, ruleSetVersion, catalogVersion, rubricHash, blueprintHash, compilerVersion } }
```

**Round-trip acceptance test (the robustness guarantee):** rebuilding KYC v7 and VEYRA in the Studio must compile to
profiles that are equal to the stored ones (canonical JSON), or the difference is listed and accepted by the owner.
That proves the Studio can express what exists before it is used for anything new.

### 7.2 Lint

Each finding has a code, a severity, the aspect it belongs to, a message and a link to the fix.

| Code | Severity | Finding |
| --- | --- | --- |
| `TS_STEP_NO_CRITERION` | Blocker | A blueprint step no criterion checks |
| `TS_RULE_NO_STEP` | Warning | An applied policy rule no step uses |
| `TS_TOOL_UNUSED` | Warning | A selected tool no step uses |
| `TS_TOOL_UNKNOWN` | Blocker | A step uses a tool that isn't in the catalogue |
| `TS_WEIGHT_DUPLICATE` | Blocker | Two criteria score the same behaviour, or group weights don't total 100 |
| `TS_SCALE_MIXED` | Blocker | A criterion's family has another scale than the template |
| `TS_NO_HOW_CHECKED` | Blocker | A criterion without an evaluator and not marked internal-only |
| `TS_OUTPUT_UNPRODUCED` | Blocker | A required output no step produces |
| `TS_HUMAN_GATE_MISSING` | Blocker | A decision the safety rules reserve for a person, with no human step |
| `TS_CASE_FACT_FIELD` | Blocker | An SME-typed field that asks for case facts (selector value, party data, expected decision) |
| `TS_PUBLIC_NAME` | Blocker | An internal name in any user-facing text (reuses the public-names guard) |
| `TS_ARRIVAL_CHECK` | Blocker | What the arrival check (`joint-template.ts`, profile registry) would refuse, with its own code |
| `TS_HELP_MISSING` | Info | An SME-typed field without help or example |

Blockers keep their aspect incomplete. Warnings can be accepted with a reason, which is recorded on the version.

## 8. How it fits RL Gym's contract

Nothing in the export or the joint template contract changes without an agreed contract change.

- **RL Gym still proposes templates and owns execution and evaluators.** A proposal (`POST
  /integrations/anvil/templates/proposals`) still arrives as a DRAFT. The Studio opens it: the execution and skills
  parts are shown read-only with a "From RL Gym" label, and the authoring part is editable.
- **Authoring owns the SME form, the policies and the rubric text.** These are what the Studio edits.
- **The joint hashes stay honest.** If the Studio changes the authoring part of an RL Gym proposal, that is a new
  version with a new `part_hashes.authoring`, which RL Gym sees on the template API as today. The execution part is
  stored byte for byte as received.
- **A criterion or tool RL Gym hasn't defined stays internal.** As with the rubric editor today, it is labelled
  "Internal only · not sent to RL Gym" and "Evaluation setup needed". The Studio's proposed evaluator mapping is a
  **note for RL Gym**, never written into the execution part.
- **Studio-only templates** (built in the Studio, not proposed by RL Gym) are authoring templates: they can run
  projects and build the approved dataset, but their export stays blocked (`exportCapabilities.executable: false`)
  until RL Gym adopts them through a proposal. Phases 1–3 need nothing from RL Gym because of this.
- **Later, by agreement only:** a "send to RL Gym as a proposal request" action that hands RL Gym the compiled
  authoring part and the proposed evaluator mapping. This is phase 4 and needs a contract change.

## 9. Data model and versioning

New tables (Prisma), all audited; published rows are immutable.

| Model | Key fields | Notes |
| --- | --- | --- |
| `DomainPack` | `id`, `domainId`, `key` (e.g. `banking-kyc`), `version` (semver), `status` DRAFT/PUBLISHED/RETIRED, `content` (JSON), `contentSha256` | A published version never changes; a change is a new version |
| `TemplateSource` | `templateId` (the DRAFT template version), `packId@version`, `blueprint` (workflow graph), `coverage`, `formChoices`, `lintAcceptances[]`, `compiledSha256`, `compilerVersion` | One per template version; the Studio's working copy |
| `TemplateApproval` | `templateId`, `compiledSha256`, `approvedBy`, `approvedAt`, `checklist`, `comment` | Valid only while the draft's `compiledSha256` is unchanged; any edit voids it |

Existing tables:

- `Template` keeps its profile, execution and skills as today; the Studio writes the compiled profile into the DRAFT
  version. Publishing is the existing publish, plus the gate.
- **On each approved task** the platform records the versions it was authored against: template version, domain pack
  version, rule set version (already recorded), rubric hash, environment (capability catalogue) version and compiler
  version. These go on the Authoring side (`ApprovedTaskRecord` gains nullable columns; it stays append-only and
  enforced in the database). **They are not added to the RL Gym export** unless a contract change is agreed.

Version rules:

- A template version pins one pack version. A new pack version never changes a published template; the Studio offers
  "Update to pack v1.3" on a new draft and shows what changes in the preview.
- Editing a published template creates a new DRAFT version (as today). Running projects keep their version.

## 10. Reuse of existing code

| Existing | Reused for |
| --- | --- |
| `apps/web/components/templates/compiler/*` (meta-compiler, stage editors, inspector, assistant, custom-field dialog) | The Studio shell: stage nav becomes the parts tabs; the inspector becomes the aspects panel; the assistant becomes "Draft blueprint with AI"; the custom-field dialog stays for extra fields |
| The meta-compiler e2e journey and `apps/api/test/meta-compiler-*.test.ts` | Extended into a Studio journey: open v7 → fix gaps → approve → publish |
| `packages/shared/src/template-profile/*` (schema, registry `checkProfile`, golden KYC and Marketing examples, profiles) | The compiler's output type, its validation, and the round-trip fixtures |
| `apps/api/src/anvil/joint-template.ts` (`checkJointProposal`, `rubricDescriptorProblems`, `evaluatorMap`) | Lint rule `TS_ARRIVAL_CHECK` calls these directly, so the Studio and the arrival check can never disagree |
| `packages/shared/src/rubric/*` (`templateRubric`, `derive.ts`, `howChecked`, technical settings) from PR #83 | The rubric part, the "Derived from" chain and "How it will be checked" |
| Policy annotations and the S4 picker from PR #83 | The pack's rule sets; the preview's S4 is the real picker |
| `packages/shared/src/workflow-graph/*` | The blueprint, its validation and layout |
| SME task form, Save bar, Ember (PR #83) | The live preview renders the real components |

## 11. Phased build plan

Phases 1–3 need nothing from RL Gym. Each phase ends with tests for its acceptance criteria and a QA check by the owner.

| Phase | Builds | Done when |
| --- | --- | --- |
| **1. Studio shell and live preview (read-only)** | Studio route for Admins (PM read-only); opens any template version; live SME preview (all slots) and Preview as Agent; aspects panel and lint run on the existing profile; measures baseline panel | KYC v7 and VEYRA open with a correct preview; lint findings listed; no write path |
| **2. Domain packs, compiler and Publish gate** | `DomainPack`, `TemplateSource`, `TemplateApproval`; KYC and Marketing packs extracted from the existing profiles; compiler; Pack, Form, Rubric and Coverage parts editable; approval and the gated Publish; versions on approved tasks | Round-trip test passes for v7 and VEYRA; Publish is refused with any blocker or without a valid approval |
| **3. Blueprint drafting and new templates** | "Draft blueprint with AI" (flagged off by default, mocked in tests); new-template flow inside an existing pack; Studio-only templates with export blocked | A new synthetic template in the KYC pack is built, approved and published, and a QA smoke project runs on it |
| **4. RL Gym hand-off** *(needs RL Gym)* | "Send to RL Gym as a proposal request" with the proposed evaluator mapping | Contract change agreed and tested against RL Gym's mock |
| **5. Calibration gate** *(later, needs RL Gym)* | A golden task per template, an RL Gym dry run of it, and reviewer agreement on a double-reviewed sample, shown as an eighth aspect "Calibrated" | The owner decides whether calibration blocks Publish or only labels the version |

## 12. Out of scope

- Any change to the export, the joint template contract or RL Gym's evaluators.
- Editing the execution or skills parts of an RL Gym proposal.
- Real customer or employer data in any description, fixture or example. The Studio's AI is told to write synthetic
  content only, and the lint does not try to detect real data; the author's declaration covers it.
- Deploys, paid calls and live services in tests.

## 13. Questions for the owner (defaults already chosen)

Each has a default in DECISIONS.md. Change any of them when approving.

1. **Who approves.** Default: any Admin, including the author; approval is tied to the exact compiled draft.
2. **Warnings.** Default: warnings can be accepted with a reason; only blockers stop Publish.
3. **Calibration.** Default: shown as "later" and never blocks Publish until phase 5 is agreed.
