# Change brief: Template Studio, ADI Forge (Praxis) and RL Gym (Anvil)

**Revision:** 3, 20 Nov 2026. **From:** Product Owner. **For:** the Praxis (ADI Forge) team and the Anvil (RL Gym) team.
**Status:** owner-approved direction. Each team reviews it, raises objections, and agrees the contract changes in section 5.
Nothing here changes running systems until the Studio exists (section 7).

This brief consolidates the owner decisions of 18–20 Nov 2026 and the gaps found in the KYC v7/v8 and Marketing
hand-offs. The detailed, numbered requirements (TS-01 to TS-46), each with its evidence, are in
`docs/design/TEMPLATE-STUDIO-REQUIREMENTS-LOG.md`. This brief says **what changes for whom**.

---

## 1. Decisions (owner, 18–20 Nov 2026)

| # | Decision | Rows |
|---|---|---|
| D1 | **The Template Studio is the only place templates are made or changed.** Every change is a new Studio release, from requirement, form, execution, skills, schema, seed and policy bindings to the image, and even a wording-only form fix. | TS-39 |
| D2 | **Neither Praxis nor Anvil changes a template.** Both only consume Studio releases. | TS-43 |
| D3 | **Releases are immutable and shared.** One registry, read by both. A release pins the template hash, the environment image digest, the policy content hashes and the domain-pack versions. Changes are successor releases; bad ones are revoked, never deleted. | TS-26, TS-31, TS-46 |
| D4 | **SMEs author only what a release supports.** If a scenario is not supported, only a PM or Admin may send the Studio an enhancement request. The Studio decides how to implement it: a new release, new data, or both. | TS-41, TS-42 |
| D5 | **SMEs never write seed data or SQL/API assertions.** | TS-34 (dropped) |
| D6 | **The Studio produces evaluation datasets** with each release (a synthetic generator per domain pack). RL Gym stores them, selects cases for runs and never edits them. Authors never see or choose evaluation data, and a template declares only the case selector. (Changed 20 Nov 2026 from "RL Gym owns datasets".) | TS-05, TS-47 |
| D7 | **The schema grows as layered domain packs:** domain core → region pack (US, India, …) → process pack (KYC, AML, …), each versioned and hashed, and grown only when a template needs it. | TS-45, TS-46 |
| D8 | **Two modes, one build: Open and Enterprise.** Open (our projects) uses de-identified enterprise data plus synthetic PII for public benchmarks. Enterprise runs inside a bank's own environment on its training dump, with real PII visible only to its people, for private benchmarks and telemetry. The same images in both, with separate deploy pipelines and the mode fixed per deployment. A data intake utility registers licences, de-identifies and purges. **Future build:** synthetic-only applies everywhere until the non-negotiables are rewritten per mode. See `OPEN-ENTERPRISE-MODES-SPEC.md`. | TS-44, TS-50 to TS-56 |

## 2. Target flow

```
              Template Studio  (the factory; a person approves every release)
   domain packs → template + schema + seed → hermetic image build
   → local contract gate (--network none, --read-only, uid 10001)
   → push image to Artifact Registry (@sha256)
   → publish immutable RELEASE MANIFEST
        (template_sha256, image_digest, policy hashes, pack versions, successor_of)
                         │  shared registry: GCS, retention lock, read-only for both
           ┌─────────────┴─────────────┐
           ▼                           ▼
     ADI Forge (Praxis)           RL Gym (Anvil)
   projects pin a release;      registers + qualifies the release,
   SMEs author; humans review;  posts a receipt; binds evaluators
   export blocked unless the    (pinned by digest) and model keys
   release is qualified         at run time; grades; run manifest
           │                           ▲
           └──── approved tasks ───────┘
   Enhancement requests (PM/Admin, or RL Gym) ──► Studio decides ──► new release or new data
```

## 3. What changes for ADI Forge (Praxis)

| Area | Today | Changes to | Rows |
|---|---|---|---|
| Template versions | Admin creates drafts and publishes in the console; proposals come from Anvil; SME/Admin can create a new version | **No template creation or editing.** Read-only views of releases, plus an **enhancement request** form for PM/Admin. In-tool versioning is retired when the Studio ships. | TS-39, TS-40, TS-42 |
| Project creation | Choose a template version | Choose a **published, qualified, non-revoked release** | TS-32, TS-15 |
| Policies | Upload rule books and law summaries per project | **Public law comes with the release** (captured and hashed by the Studio). Projects still upload **bank or client policy**, which becomes rules as today. | TS-07, TS-08, TS-10 |
| SME authoring | Form plus case selector plus rules | Unchanged, but limited to the case values and rules the release declares. No seeds or assertions. | TS-41, TS-34 |
| Review | Human reviewer accepts | Unchanged. The AI never decides. | TS-11 |
| Moving to a new release | Ad hoc (the KYC v8 job) | A standard **successor process**: originals unchanged, a change report, re-approval of changed parts | TS-21 |
| Export | Generic package | Adds: release pin per task; a block if the release is unqualified or revoked, or its image is missing; a secret and host-path scrub; the rule-set digest and policy manifest link per task; offline download | TS-14, TS-15, TS-17, TS-32, TS-33 |
| Already built | | Stored forms reach the workers (D30); AI calls outside transactions, with time budgets (D31); a version may keep an unchanged form (TS-24, PR #99) | TS-18, TS-19, TS-24 |

## 4. What changes for RL Gym (Anvil)

| Area | Today | Changes to | Rows |
|---|---|---|---|
| Template proposals | Anvil drafts proposals and calls `POST /templates/proposals` | **Anvil no longer proposes or edits templates.** Its needs go to the Studio as enhancement requests. | TS-43 |
| Execution part | Owned and edited by Anvil inside the template | Defined **in the Studio** together with Anvil. Anvil still owns runtime behaviour, scoring and evaluators, but changes ship as Studio releases. | TS-43, TS-01 |
| Qualification | Defined in the contract, never done | **Required:** register the release, qualify it, and post a receipt (hash, runner and evaluator versions, expiry) or a revocation. Re-qualify on any runner or evaluator change, and every 90 days. A canary must pass before each official run batch. | TS-12, TS-31, TS-48 |
| Evaluators | "Evaluator kind" only | Evaluators (Promptfoo, Gozen, OPA, …) are **images pinned by digest**, with hashed configs, run outside the task container, and recorded in a **run manifest** per grading run | TS-35, TS-36 |
| Data | Datasets and populations made by RL Gym | **Made by the Studio** with each release, versioned and hashed. RL Gym selects cases and never edits them. Authors never see them. | TS-05, TS-47 |
| Runtime hygiene | Findings from the owner's review | Single-claim runners that fail loudly; symmetric health gates; `mem_limit` on every service; Gym container with `--network none` and `--cap-drop ALL`, and no LLM keys | TS-36, TS-37, TS-38 |
| Policy artifacts | Bounded public-text projection | Gym builds a hash-preserving projection of captured XML, HTML and text within its bounds | (KYC v8 findings) |

## 5. Contract changes (`docs/anvil/PRAXIS-ANVIL-CONTRACT-FINAL.md`)

| Section | Today | Proposed |
|---|---|---|
| §1 Goal, step 1 | "A new or changed template is proposed by Anvil" | "…is built and released by the Template Studio" |
| §2 Who owns what | Anvil owns starting a template change and the execution part; Praxis owns the authoring part | **Studio** builds and releases every part. Anvil owns runtime, evaluators, scoring, datasets and qualification. Praxis owns projects, people, authoring, review and export. Template generation moves to the Studio. |
| §3 Lifecycle | Anvil proposal → Praxis validate and draft → Praxis Admin publishes → Anvil qualifies | Studio release (person approves) → Anvil qualifies and posts a receipt → Praxis projects pin the release → author, review, export → Anvil validates and runs |
| §5 Praxis template API | `validate`, `proposals` (Anvil calls), `qualifications` | `validate` moves to the Studio's own checks; `proposals` is retired; `qualifications` (receipts) stays. Praxis reads releases from the registry. |
| §6 Anvil export API | Package with template hash | Adds the release manifest hash and a per-task policy binding (TS-14, TS-32) |
| §8 Open questions | 1 (spec format), 2 (canonical JSON), 5 (revocation), 7 (credentials) | 1 → the release manifest schema; 2 → RFC 8785 everywhere, each hash states what it covers (TS-02); 5 → revocation record (TS-31); 7 → per-environment credentials (TS-16) |

A revised contract is drafted only after both teams accept this brief.

## 6. What the Studio must provide (summary)

- **Releases:** an immutable registry in GCS with retention lock; images by `@sha256`; hermetic builds; base images from the target project only; read-only, non-root layout; a local contract gate before push; a person's approval; revocation (TS-26 to TS-31).
- **Specs:** four parts with whole and per-part hashes; every hash defined; successor versions only; declared visibility of every form field; an input contract, never input data; worked examples kept apart from evaluation data (TS-01 to TS-06).
- **Policies:** content-hashed policy artifacts; capture of official text for every jurisdiction with a capture record; state and charter modules; synthetic never presented as public policy; a named policy owner with decision records; rule-to-clause mapping (TS-07 to TS-10, TS-22, TS-23, TS-25).
- **Approvals:** scoped approval records; a status view per release (TS-11, TS-13).
- **Domain packs:** domain core, region and process layers, versioned, listed in every manifest; start with US (from KYC), then India (TS-45, TS-46).
- **Paid generation:** only on published releases, with cost caps, and started by a person (TS-20).

## 7. Transition: what stays until the Studio ships

- Praxis keeps today's template versioning and publishing, so QA and RL Gym runs are not blocked (TS-40).
- Anvil keeps the current proposal API for templates already in flight. New template work waits for the Studio, or is done once more by hand with the owner's approval.
- Published versions so far (KYC v7 `c8c4eddf…`, KYC v8 `8449adb0…`, Marketing VEYRA v1/v2) stay valid. They are imported into the registry as the first releases.
- Everything stays synthetic (D8).

## 8. What each team is asked to do

**Both teams:** review sections 1 to 6, record objections against row IDs in the requirements log, and agree the contract changes in section 5.

**Praxis (ADI Forge):**
1. Plan TS-40 (retire versioning), TS-32 and TS-33 (export pins and scrub), TS-14 and TS-15 (policy binding and qualification block), and TS-21 (successor process as a product feature).
2. Specify the enhancement-request form and its statuses (TS-42).

**Anvil (RL Gym):**
1. Agree to stop proposing templates (TS-43), and send enhancement requests to the Studio instead.
2. Implement qualification receipts and revocations (TS-12).
3. Pin evaluators by digest and write run manifests (TS-35).
4. Fix the runtime findings (TS-36 to TS-38).
5. Answer contract §8 items 1, 2, 5 and 7 against the new model.

**Owner:**
1. Approve the revised contract.
2. Name the Studio's release approver role.
3. Decide when the Open and Enterprise modes (TS-50 to TS-56) are built, and approve the per-mode non-negotiables (TS-54).

## 9. Open items

| Row | Item | Owner |
|---|---|---|
| TS-43 | Contract change: Anvil stops proposing templates | Anvil + owner |
| TS-12 | First qualification receipt (none exists yet for KYC v7 or v8) | Anvil |
| TS-54 | Approve the rewritten non-negotiables per mode (Open and Enterprise), then change CLAUDE.md and SPEC.md, with a privacy or legal review | Owner (future) |
| TS-16 | Per-environment export credentials | Both (the owner enters secrets) |
