# M10 — SME supply, certification and payments

Status: **signed off for build** (28 Sep 2026): UI approved on condition that every screen uses the existing Praxis
console and candidate-app design; payment integration approved as recommended (Trolley). Design source: the Claude Doc
"ADI Praxis — SME Supply, Certification & Payments Module Spec". This file wins over that doc for the build.

Built on `main` (branch `m10-sme-supply`), not on `release/1.0`. See `docs/RELEASES.md`.

## 1. Goal and 7-day scope

Let staffing partners supply candidates through a Praxis Partner API; train and certify every candidate inside Praxis
against versioned guidelines; grade SMEs into tiers; and pay them for approved work. Ships behind the feature flag
`SME_SUPPLY_ENABLED` (global) plus a per-project switch, so it can be deployed off and enabled later.

Launch domains: banking, healthcare, marketing.

**In the 7-day cut**

- Partners: onboarding by an Admin, OAuth client credentials, Partner API v1, signed webhooks, sandbox, portal pages.
- Channels: Partner API, partner portal upload, direct careers page per requisition.
- Tiers: Expert, Reviewer and Annotator, each with its own certification (see 3.1 on the name).
- Certification: LLM-generated course and certification per tier from the guidelines, human-approved, with dynamic
  per-candidate test forms (section 7); selfie re-check, integrity events.
- Payments: per-task and hourly rate cards, append-only earnings ledger, weekly pay run with approval, Trolley adapter.
- Partner billing: certified-candidate fee, monthly statement export; invoices paid outside Praxis.

**Later:** Expert retainers (December 2026), RazorpayX for India through the
Indian subsidiary (expected around 26 Oct 2026), Upwork and AI-interview channels, AP integration, bonuses,
answer-similarity detection, fraud checks beyond duplicate identity.

## 2. How it fits the existing platform

The module reuses FLOW 2 (`docs/FLOW2-SME.md`) instead of duplicating it. A partner submission becomes an invitation
into the existing candidate flow: Google sign-in, Stripe Identity, conversational profile, suitability recommendation
and **human** selection. M10 adds what happens around it.

| Step | Owner |
| --- | --- |
| Requisition created from a project | M10 (new) |
| Partner submits candidate, duplicate check, invite | M10 (new) |
| Sign-in, Stripe Identity, profile, suitability, human selection | FLOW 2 (unchanged) |
| Guidelines course and certification test | M10 (new), a required item on the FLOW 2 C07 onboarding checklist |
| Payee set-up (Trolley) | M10 (new), a required item on the C07 checklist when the pay route is direct |
| Probation, tiers, eligibility for assignment | M10 (new), checked by FLOW 2 assignment acceptance |
| Task work and review | FLOW 3 and FLOW 4 (unchanged) |
| Earnings, pay runs, payouts, partner statements | M10 (new) |

Non-negotiables that shape M10 (from `CLAUDE.md`):

- No automated final rejection. Requirement screening and test scoring produce a recommendation or a score; a
  human confirms any rejection or exclusion (bulk confirmation allowed). A failed test offers a retake, then human
  review, never automatic account exclusion (FLOW 2 C07).
- Identity images and ID numbers are never stored. The test-start selfie re-check uses Stripe Identity (a new
  VerificationSession with a selfie check), storing only the provider reference and result.
- Bank and tax details are never stored in Praxis; the payout provider holds them. Praxis stores status only.
- Every state change is authorised, idempotent and written to the audit log. The earnings ledger is append-only,
  enforced in the database like `ApprovedTaskRecord`.

## 3. Tiers

### 3.1 Naming (sign-off item D-M10-1)

SPEC.md already has an internal **Reviewer / Validator** role (internal ops). The SME tier called "Reviewer" is an
external contributor. Proposed: keep the internal role name, and call the tiers **Expert**, **Senior contributor
(reviews)** and **Contributor (annotates)** in the UI, with enum values `EXPERT`, `REVIEWER_SME`, `ANNOTATOR`.
Alternative: rename the internal role to "Ops reviewer" and keep "Reviewer" for the tier.

### 3.2 Rules

One tier per SME per domain. Defaults below are set per requisition and guidelines package.

| | Expert | Reviewer SME | Annotator |
| --- | --- | --- | --- |
| Does | Authors workflows, seeds, edge cases, failure modes, benchmarks, guidelines; settles disagreements | Reviews tasks and RL trajectories; labels failures | Annotation and structured tasks |
| Default minimum | 8+ years in domain, senior role | 3+ years | 1+ year or relevant qualification |
| Certified by | Expert certification (section 7.2), authoring task confirmed by two Experts | Reviewer certification (7.2) | Annotator certification (7.2) |
| Pay | Premium per task; retainer from Dec 2026 | Per task or hourly | Per task |

- Promotion: volume in current tier (default 200 approved tasks), gold accuracy and reviewer agreement above the domain
  threshold over a rolling 30 days, **and** the next tier's certification. Approved by a human (the product owner until
  the operations lead joins).
- Probation: first 50 approved tasks, with a higher review sampling rate.
- Demotion or retraining: sustained quality below the floor; human-approved.
- Suspension: confidentiality breach, data-handling violation or fraud flag; immediate hold on tasks and payouts,
  then human investigation.
- Healthcare: Experts may need professional licence verification (open question Q2).

## 4. Requisitions and guidelines

`Requisition` fields: project, domain, tier, headcount, start date, duration, expected hours per week, location and
jurisdiction, languages, minimum requirements (structured), guidelines package + version, rate card, allowed channels
(partner IDs, direct), submission deadline, max candidates per partner. States: `DRAFT → OPEN → PAUSED → FILLED →
CLOSED`. A PM creates it from a project when the flag is on (replaces JD matching for that project).

`GuidelinesPackage` (versioned per task family and tier): guidelines with good and bad examples, domain rules,
confidentiality and conduct rules, course modules, certification test reference. Partners see requirements, a
partner-facing summary and the course outline; never items, gold answers or scoring rules. A major version requires
an update module and quiz before an SME's next task; a minor version is notify-only.

## 5. Partner API v1

Base path `/partner/v1`. OAuth2 client credentials, one client per partner, scopes `requisitions:read`,
`candidates:write`, `candidates:read`, `statements:read`. Idempotency key on every write; per-partner rate limits;
sandbox environment with simulated candidate progress. OpenAPI published with the rest of the API.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/requisitions?status=open` | Requisitions open to this partner |
| GET | `/requisitions/{id}` | Requirements, guidelines summary, course outline |
| POST | `/requisitions/{id}/candidates` | Submit a candidate (name, email, phone, country, experience summary, employment history, qualifications, CV, partner training attestation, candidate consent) |
| GET | `/candidates/{id}` | Current state per dimension, with history |
| POST | `/candidates/{id}/withdraw` | Withdraw |
| GET | `/placements` | This partner's certified SMEs, tiers, quality band |
| GET | `/statements`, `/statements/{id}` | Monthly statements (certified-candidate fees) |

Webhooks (HMAC-SHA256 signature over the raw body, timestamp, retries with backoff, replay from the portal):
`requisition.opened|updated|closed`, `candidate.received|duplicate|invited|identity_verified|selected|not_selected|
training_completed|test_passed|test_failed|certified|activated`, `sme.tier_changed|suspended|offboarded`,
`statement.issued`.

Duplicates: match on normalised email and phone, then on verified identity. First valid submission owns the candidate
for 12 months (open question Q1). Duplicates are rejected with a reason that does not reveal the owning partner.
Partners track progress but never act for the candidate.

## 6. State dimensions (added to FLOW 2 section 10)

| Dimension | States | Authority |
| --- | --- | --- |
| Partner submission | RECEIVED, DUPLICATE, INVITED, EXPIRED, WITHDRAWN | Partner API, invite service |
| Requirement screen | NOT_RUN, MEETS, DOES_NOT_MEET_RECOMMENDED, UNCLEAR, CONFIRMED_NOT_MET | Rules engine recommends; human confirms `CONFIRMED_NOT_MET` |
| Certification (per tier, domain, guidelines version) | NOT_STARTED, IN_TRAINING, TEST_READY, IN_TEST, PASSED, RETAKE_AVAILABLE, REVIEW_REQUIRED, NOT_CERTIFIED, EXPIRED | Course and test services; human decides `NOT_CERTIFIED` |
| Payee | NOT_REQUIRED (pay via partner), NOT_STARTED, PENDING, READY, BLOCKED | Payout provider webhooks |
| SME standing (per domain) | PROBATION, ACTIVE, RETRAINING, SUSPENDED, OFFBOARDED | Quality service recommends; human approves changes |

Invite not accepted within 7 days → EXPIRED (reminder at day 3). Test retakes: 48 h cooldown, max 2; after that →
REVIEW_REQUIRED for a human. Certificates expire after 12 months.

## 7. Training and certification, generated from guidelines by an LLM

Owner requirement (28 Sep 2026): the only input is the guidelines. Praxis uses an LLM to generate the training course
and the certification for each tier from them. Expert, Reviewer and Annotator each get their own course and their own
certification; difficulty and pass marks rise with the tier. Tests are dynamic: no two candidates get the same
questions, but every candidate gets equivalent questions (same competencies, same difficulty band, same weight).

### 7.1 Generation pipeline (worker jobs, one per guidelines version)

1. **Ingest.** An Admin uploads the guidelines (PDF, DOCX, Markdown) as a `GuidelinesPackage` version for a domain and
   task family. Text is extracted with the existing document-text helpers and split into cited sections.
2. **Knowledge map.** The LLM extracts rules, definitions, workflow steps, decision points, thresholds, edge cases and
   failure modes. Every item cites the guideline section it came from. Items with no citation are dropped.
3. **Courses, one per tier.** Modules are generated from the knowledge map at the tier's depth: explanation, worked
   good and bad examples, a quiz, and practice items with feedback. Every module cites its sources.
4. **Certification blueprint, one per tier.** Competencies with weights, the item families that test each one, item
   counts, time limit and pass rules (7.2).
5. **Item families.** A family is a reusable question template: competency, difficulty band, cognitive level, stem
   pattern, variable slots (case facts, document ages, amounts, jurisdictions, ownership structures, planted errors),
   the rule that derives the correct answer from the variables, distractor rationale, and the guideline citation.
   Each family ships with 3 sample instances for review.
6. **Human approval before publish.** An Admin (with an Expert for the Expert tier) reviews the knowledge map, each
   course, each blueprint and every item family, and can edit, regenerate or reject any of them. Nothing is served to
   candidates until the tier's course and certification are approved and published. Every generated artifact stores
   the model, prompt version, guidelines version and citations, and every approval is audited.

### 7.2 Tier certifications (defaults; editable per blueprint before approval)

| | Annotator | Reviewer | Expert |
| --- | --- | --- | --- |
| Tests | Applying rules correctly | Finding violations, judging severity, justifying | Authoring tasks, critiquing flawed tasks, designing rubrics |
| Cognitive level | Remember, apply | Analyse, evaluate | Evaluate, create |
| Item types | Single and multiple choice, labelling, step ordering | Trajectory review with planted errors, severity rating, short justification | Critique a flawed task, write a workflow with edge cases and failure modes, write a rubric |
| Length | 25 items, 40 min | 35 items, 60 min | 20 items + 1 authoring task, 120 min |
| Pass rule | 80% overall; no critical-rule miss | 85% overall; at least 80% of planted errors found; no critical-rule miss | 85% on objective items; authoring task passes the rubric, confirmed by two Experts |
| Prerequisite | None | None (Annotator certificate not required) | Reviewer certificate in the same domain |

### 7.3 Dynamic, equivalent test forms

- **Assembly.** Each form samples families per the blueprint, stratified by competency and difficulty band, then
  instantiates every family with fresh variables. The LLM writes the scenario and wording for each instance.
- **No repeats.** Each instance is served to one candidate only. Before serving, an instance is compared with every
  instance already served from that family (embedding similarity and variable fingerprint); near-copies are discarded.
  Retakes never repeat a family instance the candidate has seen.
- **Validation of every generated item before it is served:**
    1. the correct answer is derived by the family's rule, not by the generating model;
    2. an independent solver call (separate prompt, no key) must reach the same answer;
    3. the answer must be supported by the cited guideline section;
    4. the item's estimated difficulty must fall in the family's band.
  An item that fails any check is discarded and regenerated. Items that keep failing flag the family for review.
- **Latency.** The worker keeps a small buffer of pre-validated forms per blueprint, so starting a test never waits on
  the model. Each buffered form is used once.
- **Fairness.** Forms are equivalent by construction (same blueprint, same bands and weights). Item statistics
  (per-family pass rate and discrimination) are recorded; a family that behaves harder or easier than its band is
  flagged for recalibration, and affected candidates can be re-scored or offered a retake.

### 7.4 Scoring and decisions

- Objective items are scored deterministically against the derived key.
- Written answers (Reviewer justifications, Expert critiques and authoring task) are scored by an LLM grader against
  the rubric. That score is a recommendation: a person (two Experts for the Expert authoring task) confirms it. No
  certification is refused, and no one is excluded, on a model's judgement alone (CLAUDE.md).
- Pass on objective-only tests (Annotator, and Reviewer when every written answer is confirmed) certifies
  automatically; a fail offers a retake after 48 h (maximum 2), then goes to human review (section 6).
- Integrity: Stripe Identity selfie re-check at test start, time limit, paste and focus-change events logged.
  Partners see pass or fail and a score band per section, never items or answers.

### 7.5 Model use

Claude via Vertex AI, following the existing adapter pattern (`ClaudeVertex*` class plus a deterministic mock for local
dev and tests; production refuses the mock). Separate prompts and `PROMPT_VERSION`s for extraction, course writing,
blueprint, family writing, instance writing, solving and grading. Structured JSON output validated with zod.
Guideline text is treated as untrusted data inside the prompts. Generation cost is logged per guidelines version.

### 7.6 Admin screens

Guidelines (upload, versions) → Generation run status → Knowledge map review → Course review per tier →
Blueprint and item-family review per tier (with sample instances and "generate another sample") → Publish.
Candidate side: course player, test player, result. Certification review queue for written answers and failures.

## 8. Payments (sign-off item)

### 8.1 Decisions already taken

- Payer at launch: ADI Labs, US entity, for all SMEs including India (INR payouts).
- India: RazorpayX through the Indian subsidiary once it is operational (expected ~26 Oct 2026). Trolley stays as
  fallback.
- Partners: certified-candidate fee. Retainers: Experts only, December 2026.
- Approver: product owner alone until the operations lead joins; single-approver actions flagged in the audit log.

### 8.2 Provider for launch (sign-off item D-M10-2)

| Option | For | Against |
| --- | --- | --- |
| **Trolley (recommended)** | Built for contractor payouts: W-9/W-8BEN collection, 1099 and 1042-S, 210+ countries incl. INR, white-label onboarding, REST API and webhooks | Monthly module fees (Pay, Trust, Tax); FX margin on INR payouts |
| Stripe Connect Express | Praxis already uses Stripe (Identity); US platforms can pay India-based connected accounts | Cross-border payouts to India are restricted and need extra review; per-account monthly fee |

### 8.3 Integration design

- `PayoutProvider` interface: `createPayee`, `getPayeeStatus`, `onboardingLink`, `submitBatch`, `getPayoutStatus`,
  `verifyWebhook`, `getSettlementReport`. Adapters: `TrolleyAdapter`, `MockPayoutAdapter` (local and tests, per
  CLAUDE.md rule 5); `RazorpayXAdapter` later. Production refuses the mock.
- Payee onboarding: from the C07 checklist the SME opens the provider's hosted onboarding (tax form, payout method,
  identity as the provider requires). Praxis stores `provider`, `payee_ref`, `status` only.
- Earnings: `EarningEntry` rows are created by events: `task.approved` (FLOW 3 review), `rl_review.accepted` (FLOW 4),
  `hours.approved`. Rate comes from the requisition's `RateCard` version. Reversals are new entries.
- Pay run: weekly (per task, hourly), monthly (retainers, later). Build → PM confirm → Finance approve (second approver
  above a set amount once one exists) → submit → provider webhooks → reconcile. Holds for disputes, fraud flags,
  payee not READY, SME suspended. Minimum payout threshold carries forward.
- Webhook endpoint `POST /integrations/trolley/webhook`: signature verified on the raw body, deduplicated receipts,
  test vs live mode distinguished (as for Stripe Identity).
- Reconciliation: daily job matches provider settlement report to `PayoutItem`s; mismatches to an exceptions queue.
- Partner fees: `PartnerFeeEntry` on `candidate.certified`; monthly `PartnerStatement`; payment outside Praxis.

## 9. Data model (new tables)

| Entity | Key fields | Notes |
| --- | --- | --- |
| `Partner` | name, status, business_verification, contacts, allowed_domains, allowed_tiers, fee_terms_version | |
| `PartnerClient` | partner_id, client_id, secret_hash, scopes, environment, rotated_at | OAuth clients |
| `PartnerWebhook` | partner_id, url, secret_hash, events[], status | Deliveries in `PartnerWebhookDelivery` |
| `Requisition` | fields in section 4, state | Belongs to Project |
| `PartnerSubmission` | partner_id, requisition_id, partner_ref, candidate_id, state, owner_until | Unique active owner per candidate |
| `GuidelinesPackage` | family, tier, domain, version, status, content refs | Versioned |
| `GuidelinesPackage` sources | files, extracted sections with anchors | Upload |
| `GenerationRun` | package_version, stage, status, model, prompt_versions, cost | One per guidelines version |
| `KnowledgeItem` | kind (rule, step, threshold, edge case, failure mode), text, citation, approved | |
| `Course`, `CourseModule` | tier, package_version, status, content, citations, approved_by | One course per tier |
| `CertificationBlueprint` | tier, package_version, competencies and weights, item counts, time limit, pass rules, status | One per tier |
| `ItemFamily` | blueprint_id, competency, difficulty_band, cognitive_level, stem_pattern, variable_schema, answer_rule, citation, status, stats | |
| `ItemInstance` | family_id, variables, stem, options, key (encrypted), validation results, embedding, served_to, served_at | Served once |
| `TestForm` | blueprint_id, items[], assembled_at, used_by | Buffered, single use |
| `TestAttempt` | candidate_id, package_version, form_items[], score, section_scores, integrity_events[], result | |
| `Certification` | sme_id, domain, tier, package_version, state, issued_at, expires_at, decided_by | |
| `SmeStanding` | sme_id, domain, tier, standing, metrics_snapshot, approved_by | History kept |
| `RateCard` | version, currency, per_task rates by task_type/difficulty, hourly rate, weekly cap | |
| `EarningEntry` | sme_id, amount, currency, kind, source_type, source_id, rate_card_version, reverses_id | Append-only (DB-enforced) |
| `Payee` | sme_id, provider, payee_ref, status | No bank or tax data |
| `PayRun`, `PayoutItem` | period, status, approvals[], provider_batch_ref / sme_id, amount, idempotency_key, status | |
| `PartnerFeeEntry`, `PartnerStatement` | partner_id, amount, source / period, status | Append-only entries |

## 10. API surface (internal)

Admin/PM: `/partners`, `/requisitions`, `/guidelines`, `/certifications/{id}/decision`, `/sme/{id}/standing`,
`/rate-cards`, `/pay-runs`, `/pay-runs/{id}/approve`, `/payout-exceptions`, `/partner-statements`.
Candidate: `/me/course`, `/me/test`, `/me/payee/onboarding-link`, `/me/earnings`.
Integrations: `POST /integrations/trolley/webhook`.

## 11. Audit and roles

Every transition in section 6, every ledger entry, every pay-run action and every partner credential change writes an
`AuditEvent`. New roles: `FINANCE` (approve pay runs), `ASSESSOR` (grade Expert submissions, later), partner users
(scoped to one partner, separate user type). Separation of duties: a pay-run approver cannot approve a batch paying
themselves; an assessor cannot grade a candidate from a partner they are linked to.

## 12. UI screens (sign-off item)

**Design:** every M10 screen uses the existing Praxis design: console layout (navy header, top nav from `lib/nav.ts`,
gradient strip), theme tokens and component classes (`.card`, `.pill-*`, `.btn-primary`, `.btn-secondary`, `.hero`), and
the candidate app's own layout and dark default. The partner portal reuses the console look with partner-only nav.
No new visual language.

**Web application first; the mobile app is a later add-on** (owner, 28 Sep 2026). Candidate screens are designed for desktop web and must stay usable on a phone browser; no native app work in M10.

Mockups (Design canvas "ADI Praxis M10 — UI mockups for sign-off", https://claude.ai/artifact/CKynR8o85ng93ZQgJuEKvk) cover: partner portal (requisitions, submit candidate, candidate tracker, statements, API keys),
candidate course and test, candidate payee set-up and earnings, admin partners and requisitions, certification review
queue, pay run approval, payout exceptions. Link and sign-off date are recorded in `docs/DECISIONS.md`.

## 13. Acceptance criteria (7-day cut)

- [ ] With the flag off, no M10 route, job or menu item is reachable; FLOW 2 behaves as today.
- [ ] A sandbox partner can list open requisitions, submit a candidate, and receive signed webhooks for every state change.
- [ ] A duplicate submission is rejected without revealing the owning partner.
- [ ] A submitted candidate is invited into FLOW 2 and cannot be rejected without a human decision.
- [ ] Uploading guidelines produces, per tier, a knowledge map, course, blueprint and item families with citations; nothing is served until an Admin approves and publishes.
- [ ] Two candidates on the same blueprint never receive the same item instance; a retake never repeats an instance the candidate saw.
- [ ] Every served item passed all four validation checks; failed items are regenerated and the family is flagged after repeated failures.
- [ ] Expert, Reviewer and Annotator certifications apply their own lengths and pass rules; the Expert certification requires a Reviewer certificate in the domain.
- [ ] Written answers are scored by the LLM grader as recommendations and need human confirmation; a model score alone never refuses a certification.
- [ ] The course enforces module order; a failed test offers a retake after 48 h, and after two retakes goes to human review.
- [ ] The C07 checklist cannot complete until certification is PASSED and, for direct pay, the payee is READY.
- [ ] Approving a task creates exactly one earning entry at the rate-card price; replaying the event creates none.
- [ ] Earning entries cannot be updated or deleted (database-enforced); a correction is a reversing entry.
- [ ] A pay run cannot be submitted without the required approvals; held items are excluded and reported.
- [ ] Provider webhooks with a bad signature are rejected; duplicates are ignored; statuses reach PAID, FAILED or RETURNED.
- [ ] The daily reconciliation report lists every mismatch.
- [ ] Each certified candidate creates one partner fee entry and appears on that month's statement.
- [ ] All of the above are in the audit log.

## 14. Open questions

- Q1 Candidate ownership window (default 12 months) and resubmission cool-off (default 90 days).
- Q2 Tier requirements and pass thresholds per launch domain; licence verification for healthcare Experts.
- Q3 RazorpayX onboarding start date for the Indian subsidiary.
- Q4 Expert retainer terms for December: committed hours, minimum deliverables, notice period.
