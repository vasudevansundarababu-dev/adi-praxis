# M10 — SME supply, certification and payments

Status: **draft, awaiting sign-off** (28 Sep 2026). Development starts only after the product owner signs off
the UI mockups (section 12) and the payment integration (section 8). Design source: the Claude Doc
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
- Tiers: Annotator and Reviewer (see 3.1 on the name) certified by test; Experts added by an Admin.
- Certification: guidelines course (modules, quizzes, practice), randomized test, selfie re-check, integrity events.
- Payments: per-task and hourly rate cards, append-only earnings ledger, weekly pay run with approval, Trolley adapter.
- Partner billing: certified-candidate fee, monthly statement export; invoices paid outside Praxis.

**Later:** Expert retainers (December 2026), Expert authoring test with two assessors, RazorpayX for India through the
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
| Certified by | Admin (7-day cut); two-Expert rubric later | Test: gold tasks + planted-error trajectories | Test: gold tasks |
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

## 7. Training and certification

Course per guidelines package: modules → quiz per module (unlocks the next) → practice tasks with instant feedback →
certification test. Test forms are drawn at random from an item bank per guidelines version; item exposure tracked.
Default pass rules: Annotator 80% on 20 gold tasks, no critical error; Reviewer SME 85% on gold plus 80% of planted
errors found in 15 trajectories. Integrity: Stripe Identity selfie re-check at test start, time limit, paste and
focus-change events logged. Partners see pass or fail and a score band per section. Admin authoring: modules, quizzes,
item banks, pass rules, form preview.

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
| `CourseModule`, `QuizItem`, `TestItem` | package_version, content, answer key (encrypted), exposure_count | Item bank |
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

Mockups for sign-off cover: partner portal (requisitions, submit candidate, candidate tracker, statements, API keys),
candidate course and test, candidate payee set-up and earnings, admin partners and requisitions, certification review
queue, pay run approval, payout exceptions. Link and sign-off date are recorded in `docs/DECISIONS.md`.

## 13. Acceptance criteria (7-day cut)

- [ ] With the flag off, no M10 route, job or menu item is reachable; FLOW 2 behaves as today.
- [ ] A sandbox partner can list open requisitions, submit a candidate, and receive signed webhooks for every state change.
- [ ] A duplicate submission is rejected without revealing the owning partner.
- [ ] A submitted candidate is invited into FLOW 2 and cannot be rejected without a human decision.
- [ ] The course enforces module order; the test draws a random form; a failed test offers a retake after 48 h, and after two retakes goes to human review.
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
