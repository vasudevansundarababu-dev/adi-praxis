# ADI Praxis — decision log

Decisions taken while building, where the specs were silent, ambiguous or in conflict. Entries marked
**(chosen by Claude)** were made without a question to the product owner, at their request to finish the remaining
milestones without interruption (26 Sep 2026); each was the option Claude would have recommended. Please review them.

## M0 Foundation (all confirmed by the owner)
- Internal sign-in: email + password (argon2id), server-side sessions.
- Logo: ADI Praxis mark + wordmark with the tagline set as text; mark cropped for icons.
- Append-only enforcement and the UI smoke test deferred to M6; staging pipeline deferred to M8.
- Stripe Identity webhook path: `/integrations/stripe/identity-webhook` (FLOW2 wins).

## M1 Templates (confirmed)
- FLOW 1 offers only the newest published version of each workflow.
- Publishing needs the core fields (name, primary work, verification, human gate, TPT, skills, task mode).
- KYC template seeded with SPEC's example coverage dimensions and edge cases, as a draft.
- Added `PATCH /templates/{id}` (drafts) and `POST /templates/{id}/versions`.

## M2 FLOW 1 (confirmed)
- Demographic taxonomy seeded with standard lists (ISO 3166, ISO 639-1 + CEFR, ISCED, IANA).
- Start and end dates required to submit; working days are Monday to Friday.
- Cancelling is allowed from READY_FOR_STAFFING.

## M3 FLOW 2 core (confirmed)
- Synthetic candidates for local dev; SelectionGate stub until M4.
- No age-band filter (FLOW2 §9 forbids matching on age).
- City radius matched through a Geocoder interface (offline table in v1).
- Scoring definitions (skills 50, experience 20, language 15, availability 15, preferred bonus 10) as documented.
- Missing JD: keep, reuse an identical JD, or rebuild from the frozen snapshot.

## M4a sourcing and candidate access (confirmed)
- M4 split into three slices.
- Google sign-in and Stripe Identity: real adapters ready, mocks locally; production refuses mocks.
- Opportunity: text + PDF/DOCX import with human-confirmed text.
- 18+: attestation at first sign-in + over-18 derived from Stripe's result (date of birth never stored).

## M4b SME profile (confirmed)
- Claude via Vertex AI (`claude-opus-5`, one retry on `claude-opus-4-8` after a refusal).
- Default question policy, editable by the owner.
- Evidence: PDF/DOCX/PNG/JPG up to 10 MB, private storage, malware-scanner stub.
- Sensitive chat content: only a redacted copy is kept.

## M4c selection, onboarding and assignment (confirmed)
- Country of work, languages, time zone and hours are collected in onboarding and feed the matching record.
- A project is STAFFED when enough candidates have **accepted**; declined or expired (7-day) proposals free the slot.
- Contributor terms are Admin-managed and versioned; placeholders are seeded for local dev and block onboarding in production.
- Reviewers are assigned per project.
- **(chosen by Claude)** The suitability assessment runs in the worker on `enrollment.submitted` (Claude on Vertex, or local rules). If the model is unavailable or its output fails validation, the reviewer can retry or review without a recommendation; nothing is decided automatically.
- **(chosen by Claude)** Reviewer endpoints are `/review/enrollments/...` rather than SPEC's placeholder `/applications?status=IN_VALIDATION`, because FLOW2 calls the application an enrollment. SPEC's API table is updated.
- **(chosen by Claude)** A PM "Assign" now sends a proposal (FLOW2 C08). Only acceptance counts towards STAFFED and emits `candidate.assigned`. The stub gate that assigns directly is kept only as a named test double.
- **(chosen by Claude)** At acceptance the server rechecks: account, identity, selection, scope expiry, contribution role, onboarding and current terms, unresolved conflicts, the pinned requirements version, and the concurrent-project limit (accepted work on other projects), under a row lock on the candidate.
- **(chosen by Claude)** Being selected for a pool counts as covering that pool's template skills in the matching record, so the expert can match the project that selected them. Lists from earlier pools are merged, not replaced.
- **(chosen by Claude)** Candidate-declared conflicts block proposals until a Reviewer assigned to that project (or an Admin) resolves them. A reviewer who declares a conflict can no longer see or decide that application.
- **(chosen by Claude)** "Open workbench" issues a single-use handoff token that is valid for 10 minutes and stored only as a hash. Until FLOW 3 (M5), the workbench page confirms the handoff and says tasks will appear when the project starts.
- **(chosen by Claude)** Declining a proposal records an optional reason and has no effect on pool status or matching.

## M5 FLOW 3 tasks, KYC workbench and review (chosen by Claude)
- **(chosen by Claude)** Built in three slices (M5a tasks and invites, M5b KYC definition, M5c review and dataset).
- **(chosen by Claude)** Tasks are issued when an expert accepts (C08): up to the open-task cap (3), then pulled one at a time up to the per-expert cap. Tasks may start while the project is still STAFFING; the project moves to IN_PROGRESS once STAFFED with work issued.
- **(chosen by Claude)** Coverage slots: required cells and edge cases first, then the open-slot share, then optional cells and edge cases, then combinations of dimension values. Edge-case slots let the author choose the other tags. A slot whose jurisdiction is outside the expert's approved scope is not offered.
- **(chosen by Claude)** The per-expert cap counts held and accepted tasks; rejected and reclaimed tasks free a place. Reclaiming clears the draft and releases the slot.
- **(chosen by Claude)** Invites go by email (SMTP; Mailpit locally). SMS has an interface but no sender, because FLOW 2 collects no phone numbers and no provider is chosen. Resending revokes the old link, since only token hashes are stored. Production requires SMTP_HOST.
- **(chosen by Claude)** Near-duplicates use Vertex AI `text-embedding-005` (768 dimensions; a hashing mock locally) with pgvector cosine search across the workflow's template lineage, plus a structured comparison of coverage tags and key inputs. Flags never block submission. If the embedding service is down, submission waits (503) so no task skips the check. There is no ANN index in v1; exact search is fine at this scale.
- **(chosen by Claude)** KYC task structure and checks follow TASK-KYC. Human-gate compliance means approve/reject recommendations and high-risk ratings must escalate or describe a hand-off to a person. Tool steps must reference a defined response (replayable). The edge-case match is a keyword heuristic, and the Reviewer confirms coverage.
- **(chosen by Claude)** The synthetic-data scan flags checksum-valid IBANs and cards, national ID formats, labelled passport and company numbers containing digits, and emails and phones outside reserved or fictitious ranges. Flags block submission until explained. Detecting text copied from known sources needs an external corpus and is not done in v1.
- **(chosen by Claude)** Added task status REJECTED (TASK-KYC R03). Confirmed real data is quarantined: the output, submission copies and embedding are removed.
- **(chosen by Claude)** Task review uses the same per-project Reviewer assignment as selection. Self-review is detected by matching the reviewer's email to the author's contact email; declared conflicts also block.
- **(chosen by Claude)** ApprovedTaskRecord is written in the accept transaction with a SHA-256 content hash chained to the previous record, in `seq` order under an advisory lock. The database-level append-only rules and the nightly verification come in M6.
- **(chosen by Claude)** Machine clients (client API, RL Gym) use Admin-issued Bearer keys, stored as hashes, shown once and never kept in idempotency replays; they audit as SERVICE.
- **(chosen by Claude)** Blind solve (TASK-KYC optional) is not built in v1; it stays an open question.

## M6 Approved Task Dataset (chosen by Claude)
- **(chosen by Claude)** Append-only is enforced by triggers (reject UPDATE and DELETE; TRUNCATE only with the session setting `praxis.allow_truncate`, used by test resets) and by revoking UPDATE/DELETE. It covers ApprovedTaskRecord, RLReviewRecord, AuditEvent, SelectionDecision and TaskReview. The app must run as a non-superuser in staging and production (M8), because superusers bypass grants.
- **(chosen by Claude)** RLReviewRecord's `delivered_at` moved out: delivery to RL Gym is tracked in a separate table (M7) so the record itself never changes.
- **(chosen by Claude)** One hash chain per table across clients, ordered by `seq` (assigned under a transaction-scoped advisory lock). The content hash covers the record's input, output and lineage fields plus prev_hash, using stable JSON.
- **(chosen by Claude)** The nightly verification is a BullMQ job scheduler in the worker (03:00 UTC). Each run writes an audit event per client; a break also logs an ERROR with `alert: true`, which M8's log-based alert pages on.
- **(chosen by Claude)** The dataset API is read-only for Admins and RL Gym (API key); PMs use the dashboard instead. Corrections are Admin-only and append a superseding record with the same lineage.
- **(chosen by Claude)** The UI smoke test uses Playwright with system Chrome locally, on isolated ports and a `praxis_e2e` database.

## M7 FLOW 4 RL Gym result review (chosen by Claude)
- **(chosen by Claude)** RL Gym authenticates with an Admin-issued RL_GYM API key. A duplicate `(rl_run_id, rl_task_id)` returns the existing request (200) and creates nothing. Source records must exist in the dataset.
- **(chosen by Claude)** An RL_REVIEW task belongs to the project of its first source record, so "qualified reviewers" are those assigned to that project (or Admins). RL tasks are excluded from expert queues, PM task lists, dashboards and completion. A reviewer claims a review before judging it; a finished review ends in SUBMITTED.
- **(chosen by Claude)** Every eval metric gets exactly one agree/disagree; a comment is required on every FAIL and every disagreement. Comments may be pinned to a trajectory step and tagged with an active failure reason code. Large trajectories arrive as a signed URL that the reviewer opens; the server never fetches it.
- **(chosen by Claude)** RLReviewRecord uses the same hash chain and append-only rules as the dataset, and the nightly job verifies both chains. Delivery state lives in RLResultDelivery.
- **(chosen by Claude)** Results go by a Stripe-style HMAC-signed webhook (`RL_GYM_WEBHOOK_URL`, secret of 32+ characters) with 8 exponential retries. Without a URL, results stay `PULL_ONLY` for `GET /integrations/rl-gym/results`. RL Gym's receiving side is outside this spec; tests use a mock that verifies signatures.

## M8 GCP deployment (chosen by Claude)
- **(chosen by Claude)** Code only: Terraform and GitHub Actions were written and checked (`terraform validate`, actionlint, local image builds), but nothing was applied, pushed or deployed.
- **(chosen by Claude)** Region `us-central1` (SPEC default). The domain, the email/SMS providers and the monthly budgets are still open, so they are variables.
- **(chosen by Claude)** Added `APP_ENV` (staging|production). Staging runs production builds (no mocks) but accepts Stripe test-mode identity; only production requires live identity.
- **(chosen by Claude)** One API image serves the API, worker and Cloud Run jobs (`migrate`, `verify-chains`, `seed`). The Next apps build as standalone images with no environment-specific values baked in: settings formerly read from `NEXT_PUBLIC_*` are now read at runtime.
- **(chosen by Claude)** The nightly chain verification runs as a Cloud Run job from Cloud Scheduler, as SPEC says; the worker's own schedule is switched off in GCP (`DATASET_VERIFY_CRON=off`). The worker exposes a health endpoint because Cloud Run services must listen on a port.
- **(chosen by Claude)** Two database users: `praxis_migrator` owns the schema and runs migrations; `praxis_app` gets only runtime grants, with no UPDATE/DELETE/TRUNCATE on append-only tables. Both use password auth from Secret Manager (IAM database auth can come later).
- **(chosen by Claude)** Memorystore uses AUTH on private service access, without in-transit TLS, to avoid shipping a custom CA to BullMQ. It has no public address.
- **(chosen by Claude)** The load balancer routes `/api/*` on the console and candidate hosts to the API, so session cookies stay first-party; `api.<domain>` serves webhooks and RL Gym. Cloud Armor applies OWASP rules, a per-IP rate limit and adaptive DDoS protection. reCAPTCHA bot management needs a site key and is left for later.
- **(chosen by Claude)** Production images are built from the release tag (the same commit that passed staging) into the production registry; images are not copied between projects.
- **(chosen by Claude)** CI runs the same docker compose stack as local development. `terraform plan` runs with a separate read-only planner identity; applies are done by an operator.


## Demo deployment (owner request, 27 Sep 2026)
- The owner chose a demo environment with mocks to click through the whole flow on GCP. `APP_ENV=demo` lets production builds use the local mocks (simulated Google sign-in and identity check, rule-based AI, in-memory email) only with their own `MOCK_SECRET`; `PRAXIS_DEMO=1` shows the mock sign-in and a demo banner on every page. Real staging and production still refuse mocks.
- **(chosen by Claude)** The demo is deployed by `infra/demo/deploy-demo.sh` (gcloud + Cloud Build) on default `run.app` URLs, because there is no domain yet. It is not the staging/production path, which stays Terraform plus GitHub Actions.

## Demo feedback (owner, 27 Sep 2026)
- **Shorter profile chat (owner choice):** the default policy asks six questions: focus (tap), roles with dates, level of responsibility (tap), jurisdictions (tap), one combined question on the pool's published requirements, and one generic example case. At most one follow-up. A plain answer fills that question's own fields as proposals the SME confirms; tap-to-choose questions only take the listed options this way. Availability and conflicts are asked once, in onboarding. Each published opportunity keeps its own question set, so the PM republishes to use the new default.
- **Bold brand look (owner choice):** Plus Jakarta Sans; gradient hero bands; cards with depth; coloured status pills; tap chips; a journey stepper on candidate home and status; a navy console header; the console home shows what is waiting per role.
- **(chosen by Claude)** Pages a role can't use now say so ("This page is for Reviewers and Admins; you're signed in as …") instead of a bare 404, and explain that one browser holds one sign-in.

- Demo project has no country filter (chosen by Claude, owner approved 27 Sep 2026). The demo setup used to create
  "KYC authoring demo" with a required UK-only filter, which silently excluded a selected expert in India from
  matching. The live demo's filter was removed once, with an audit event `project.filters.demo_override`; the setup
  script no longer adds it.

## M9 Task drafting and MCP tool recording (owner-approved spec, 27 Sep 2026)
Owner choices: tools recorded as MCP; both an in-app AI interview and transcript upload; uploaded files kept
privately with the task (never in the dataset); build M9 before the tester package.
- **(chosen by Claude)** Author routes live under `/me/tasks/:id/...` like the rest of the workbench (the spec's
  `/workbench/...` placeholder paths were aligned in `docs/TASK-DRAFTING.md`).
- **(chosen by Claude)** The interview is eight fixed, tap-first questions built from the slot; the model's job is the
  draft. Fixed questions make every author's experience the same and cost nothing per question.
- **(chosen by Claude)** Drafting needs at least one file or three interview answers. One draft runs at a time per
  task; the editor pauses while it runs and reloads when it lands, so nothing typed is lost.
- **(chosen by Claude)** "Draft all" never replaces confirmed sections; redrafting one section clears its confirmation.
  Editing a confirmed section keeps it confirmed; the Reviewer sees "edited by the author" or "unchanged from the draft".
- **(chosen by Claude)** Up to 5 files per task; PDF, DOCX, TXT, VTT, SRT; 10 MB each; type from the bytes. Image-only
  PDFs are refused (no OCR in v1).
- **(chosen by Claude)** Likely real identifiers in a file are shown to the author with the values masked; the raw values
  are passed to the drafter as forbidden and scrubbed from its output. The file itself is not blocked, because a
  public document can contain example numbers; the Reviewer sees the count.
- **(chosen by Claude)** Drafter: Claude on Vertex (`claude-opus-5`, one retry on `claude-opus-4-8` after a refusal),
  structured JSON output, adaptive thinking, streamed. Its output is sanitised to the KYC schema, the MCP catalog and
  allowed values; unknown tools are dropped and tool steps without a recorded call become reasoning steps.
- **(chosen by Claude)** Tool arguments are text values checked against each tool's `inputSchema`. Old tasks' free-text
  input becomes the tool's main argument. Two recorded calls with the same tool and arguments are an error (replay
  could not tell them apart). A tool step uses its recorded call's arguments.
- **(chosen by Claude)** The MCP catalog (`GET /mcp/kyc/tools`) is for Admin, PM, Reviewer and the RL Gym key;
  authors see the same catalog inside the workbench. The replay bundle is for Admin and RL Gym.
- **(chosen by Claude)** Dataset records carry `provenance` (source kinds and SHA-256, interview count, draft runs,
  section confirmations, MCP catalog version). It is included in the content hash only when present, so records
  written before M9 verify unchanged.
- **(chosen by Claude)** A reference replay server (`packages/mcp-replay`) is provided for testing; it does not define
  how RL Gym runs tasks.
- **(chosen by Claude)** A project still needs at least one demographic filter to be submitted (M2 rule). The demo
  project uses a *preferred* country filter (GB or IN) so it excludes nobody.
- **(chosen by Claude)** Found while testing for India: the time-zone list used older IANA names (Asia/Calcutta).
  It now lists current names (Asia/Kolkata, Asia/Kathmandu, Asia/Yangon, Asia/Ho_Chi_Minh, Europe/Kyiv, America/Nuuk)
  and maps the older names browsers may report.
- **(chosen by Claude)** Hardening before external testing: the apps send a Content-Security-Policy (self, plus Google
  sign-in in the candidate app; inline scripts allowed because Next.js inlines its bootstrap), HSTS outside local dev,
  X-Frame-Options DENY, nosniff, a referrer policy and a permissions policy, and no longer send X-Powered-By. API
  responses add nosniff, DENY, no-referrer, `default-src 'none'` and `Cache-Control: no-store` (Swagger UI at /docs
  keeps its scripts). A nonce-based CSP without 'unsafe-inline' is left for later.

## Tester package, defect process and test environment (owner request, 27 Sep 2026)
Owner choices: agent pull requests need a human merge; a separate test environment with real Claude on Vertex.
- **(chosen by Claude)** Test environment `adi-praxis-test-0928` ("ADI Praxis Test") is the demo deployment with
  `PRAXIS_VERTEX=1`: real Claude and embeddings; simulated Google sign-in, identity check and email (testers cannot use
  real identity checks). The banner says "Test environment" and shows the build.
- **(chosen by Claude)** Test cases live as data (`docs/testing/data/*.mjs`); `node docs/testing/build.mjs` generates
  the Markdown, the CSV (UTF-8 with BOM for Excel), the decision register and the API reference, and fails on unknown
  decision ids.
- **(chosen by Claude)** Proposed performance targets for testing (the SPEC only fixes the 2 s match): LCP ≤ 2.5 s on
  broadband and ≤ 4 s on Fast 4G; saves and decisions ≤ 2 s; W06 checks ≤ 5 s; chat reply ≤ 15 s; full draft ≤ 90 s;
  one section ≤ 45 s; pages ≤ 1.5 MB.
- **(chosen by Claude)** Nightly schedule in IST: agent 01:00, build and deploy 02:00, only if `main` changed; testers
  avoid 01:45–02:30. At most 5 issues per night, two at a time.
- **(chosen by Claude)** Agent pull requests say `Issue: #N` (not "Fixes") so issues stay open until a tester comments
  `/verified`; `/failed` reopens. The agent authenticates to Vertex with its own service account that can only call
  Vertex AI; the deployer account can build and deploy but not read data.
- **(chosen by Claude)** Security findings go to private GitHub advisories and are never given to the agent.
- **(chosen by Claude)** Found while writing the tests and fixed: an Admin could remove their own Admin role (now
  refused, like disabling yourself); Indian mobile numbers (+91 98765 43210) were not detected by the sensitive-data
  and synthetic-data scans (now detected).

## Release 1.0 and M10 SME supply (owner, 28 Sep 2026)
- `release/1.0` cut from `main` at `9ef51ef`; testers test 1.0; new work continues on `main`. Tester defects are fixed on
  `release/1.0` and forward-merged into `main` (`docs/RELEASES.md`).
- M10 (`docs/SME-SUPPLY.md`): partners supply candidates through a Praxis Partner API; training and certification stay in
  Praxis; tiers Expert, Reviewer, Annotator; launch domains banking, healthcare, marketing.
- Payer at launch: US entity for all SMEs including India; RazorpayX through the Indian subsidiary once operational
  (~26 Oct 2026). Partner model: certified-candidate fee. Retainers: Experts only, December 2026.
- Pay runs and tier promotions approved by the owner until the operations lead joins.
- Web application first; mobile app later as an add-on. M10 candidate screens are desktop web, usable in a phone browser.
- Signed off 28 Sep 2026: UI (using the existing Praxis design throughout) and payment integration (Trolley at launch).
- Course and certification are generated by an LLM from the guidelines only, one per tier (Expert, Reviewer, Annotator),
  harder by tier, with dynamic per-candidate test forms (equivalent, never identical); human approval before publish
  and human confirmation of any model-graded written answer (`docs/SME-SUPPLY.md` section 7).
- Owner answers for the overnight build (28 Sep 2026) are in `docs/SME-SUPPLY.md` section 0; the runbook is `docs/M10-BUILD.md`.

## M10 SME supply, certification and payments (build pre-approved by the owner, 28 Sep 2026)
Spec: `docs/SME-SUPPLY.md` (section 0 owner decisions). Runbook: `docs/M10-BUILD.md`. Status: `docs/M10-STATUS.md`.

### M10a Foundations, partners and requisitions
- **(chosen by Claude)** Each slice has its own migrations (`…_m10a_…`, `…_m10b_…`, `…_m10c_…`) rather than one migration
  for all of section 9, so each slice commits green on its own.
- **(chosen by Claude)** `SME_SUPPLY_ENABLED` (default false) gates registration: with it off, no M10 route is
  registered (404), no M10 event handler or job is scheduled, and no menu item is shown. A requisition also needs the
  project's own switch (`POST /projects/:id/sme-supply`). JD matching keeps working on switched-on projects in v1.
- **(chosen by Claude)** Partner portal users are a third session audience (`PARTNER`, cookie `praxis_partner`) on the
  existing Session table; partner API clients get short-lived opaque bearer tokens (1 hour, stored as SHA-256) from
  `POST /partner/v1/oauth/token` (form, JSON or HTTP Basic). Audit actor type `PARTNER` was added.
- **(chosen by Claude)** Partner webhook signing secrets are stored encrypted (AES-256-GCM with `M10_ENCRYPTION_KEY`),
  not hashed as section 9 says, because the platform must read them to sign each delivery. Signatures follow the RL Gym
  format: header `Praxis-Signature: t=<unix>,v1=<HMAC-SHA256("<t>.<raw body>")>`. Deliveries retry 8 times (30 s × 4ⁿ)
  from a worker job every 30 s; replays reuse the event id so partners can deduplicate.
- **(chosen by Claude)** The partner-facing candidate id is the submission id; internal candidate ids never leave the
  platform, so one partner can never correlate another partner's submissions.
- **(chosen by Claude)** Ownership: the first valid submission owns the person for 12 months while it is active. When it
  ends (withdrawn, expired, or "not met" confirmed by a Validator) a 90-day cool-off applies to every channel. The
  owner may put the same person forward for other requisitions. Duplicate reasons never name the owner.
- **(chosen by Claude)** Duplicate matching: normalised email (lower case; Gmail dots and "+tags" ignored), then
  normalised phone (Indian numbers without a country code get +91), then — when the invite is accepted — the signed-in
  account (verified identity). An account already owned through another partner turns the new submission into a
  duplicate.
- **(chosen by Claude)** A direct application (careers page) from someone a partner already owns stays credited to
  that partner (their ownership and fee terms apply).
- **(chosen by Claude)** Every submission is invited at once, whatever the requirement screen recommends; the screen is
  advice for a Validator, who alone can confirm "not met" (bulk confirmation supported). Sandbox submissions are never
  emailed; their progress is simulated with `POST /partner/v1/sandbox/candidates/:id/simulate`.
- **(chosen by Claude)** Invites last 7 days with a reminder on day 3 (hourly worker job). The invite link opens the
  candidate app at `/partner-invite/<token>`; after Google sign-in it starts (or resumes) the FLOW 2 application for the
  requisition's opportunity, which must be published.
- **(chosen by Claude)** The partner-visible history (`CandidateStateEvent`) is append-only in the database (trigger
  and revoked UPDATE/DELETE), like the M6 tables.
- **(chosen by Claude)** "Validator" replaces "Reviewer" for the internal role in every console and candidate-app text
  and API message; the enum, routes and code names keep REVIEWER/review. Shared `roleLabel()` and `ROLE_LABELS`.

### M10b Guidelines to courses and certifications
- **(chosen by Claude)** Guidelines are uploaded per package (domain + task family) as a new version (PDF, DOCX,
  Markdown or text, up to 10 MB), stored privately, and split into cited sections `S1…Sn` (headings, else paragraph
  groups). One package serves all three tiers; each tier gets its own course, blueprint and families from the same
  version. Generation runs as a worker job (`guidelines.generate`), never in a request.
- **(chosen by Claude)** Anything generated without a valid section citation is dropped. Every generation run records
  its model, prompt versions and token usage. `CERT_MODEL` (default `claude-opus-5`) writes knowledge, courses,
  blueprints and families; `CERT_BULK_MODEL` (blank = `CERT_MODEL`) words instances and solves them independently.
- **(chosen by Claude)** Correct answers are never written by a model. Each item family declares a variable schema and
  an answer rule in a small rule language (threshold, all-of, lookup, select, order, planted errors, written); the
  platform samples variables and derives the key. Keys are stored encrypted and never reach the candidate app.
- **(chosen by Claude)** The four checks per instance are: (1) the rule produces a valid key; (2) an independent solve
  without the key matches it; (3) the cited section supports the answer; (4) the estimated difficulty is inside the
  family's band. An instance whose stem is a near-copy (cosine ≥ 0.97) of an earlier one of the same family is also
  refused. A failed instance is kept as DISCARDED (with its check results) and regenerated, up to 3 tries per request;
  after 5 consecutive failures the family is FLAGGED and cannot be approved until an Admin edits it.
- **(chosen by Claude)** Nothing is served until an Admin approves the tier's course, blueprint and every family (with
  at least one valid sample) and publishes the tier. Expert-tier families also need a Validator's approval until the
  domain has two certified Experts, then an Expert's. A published tier cannot be edited or regenerated; that needs a new
  version.
- **(chosen by Claude)** Test forms are assembled ahead of time (a buffer of 2 per published blueprint, worker job
  every 5 minutes, or on demand if the buffer is empty) and used once. Each instance is served to exactly one person
  (`servedTo`), so two candidates never share an instance and a retake never repeats one.
- **(chosen by Claude)** The course unlocks module by module; a module completes when its quiz scores at least 80%.
  The test opens after the last module. Each attempt needs a new selfie check (a Stripe Identity session with a
  matching selfie; the mock locally and in tests). Only the provider reference and the result are stored.
- **(chosen by Claude)** Objective items are scored against the derived keys; trajectory reviews count planted errors
  found. Written answers get a model grade as a recommendation only; every written grade needs people to confirm it
  (1 confirmation; the Expert authoring task needs 2: an Admin and a Validator until the domain has two certified
  Experts, then two Experts not linked to the candidate's partner). The result is decided only when every confirmation
  is in, so a model score alone never passes or refuses anyone. The confirmation that completes the review decides the
  result in the same transaction.
- **(chosen by Claude)** A failed attempt offers a retake after 48 hours; the third failed attempt goes to a person
  (Validator or Admin), who can certify, decline, or allow another retake. Candidates see pass or fail and a band per
  section (Strong, Meets, Developing, Below), never items, answers or keys. Integrity signals (paste, focus changes)
  are logged for reviewers and never fail anyone by themselves. Tests past their deadline (plus 1 minute) are submitted
  with the saved answers by a sweep every 10 minutes, which also expires certificates after 12 months.
- **(chosen by Claude)** Passing certifies for 12 months, starts standing on PROBATION (append-only `SmeStanding`),
  tells the supplying partner (`candidate.test_passed`, `candidate.certified`) and completes the C07 checklist when
  the new "Guidelines course and certification" item was the last one open. The candidate cannot tick that item.
- **(chosen by Claude)** Healthcare Experts upload a licence (number, issuing body, certificate file); a Validator
  confirms it. A passed test waits in review until the licence is confirmed.
- **(chosen by Claude)** Candidate test endpoints are rate-limited per candidate session, not per IP, because
  candidates in one office share an address.
- **(chosen by Claude)** Partners see a requisition's guidelines summary (package name, version, section headings) and
  course outline (module titles, number of questions, time limit) once the tier is published; never items, answers or
  pass rules.

### M10c Payments
- **(chosen by Claude)** The pay route is set per requisition: `DIRECT` (default; Praxis pays the SME, payee set-up
  is a C07 checklist item) or `VIA_PARTNER` (the partner pays its people; no payee, no earnings in Praxis).
- **(chosen by Claude)** Rate cards are versioned and never edited: a change is a new version of the same name, and a
  requisition is linked to one version. Per-task rates by task type (Authoring, Annotation, RL review), in USD or INR.
  An entry records the rate-card version it was priced at.
- **(chosen by Claude)** Earnings are written when a person accepts a task (the existing `task.accepted` event, which
  is the spec's `task.approved`), dated at the acceptance, exactly once per task (unique source), for SMEs who came
  through a DIRECT requisition on that project. `rl_review.accepted` and `hours.approved` are not built: in this
  platform FLOW 4 reviews are done by internal Validators (not SMEs), and there is no hours tracking yet. The ledger
  kinds `RL_REVIEW` and `HOURS` exist for when they are.
- **(chosen by Claude)** `EarningEntry` and `PartnerFeeEntry` are append-only in the database (trigger plus revoked
  UPDATE/DELETE, as for the M6 tables). A correction is a `REVERSAL` entry pointing at the original; an entry is
  reversed at most once and a reversal is never reversed. Only Finance or an Admin reverses. No foreign key points at
  these tables (Postgres foreign-key checks need UPDATE on the referenced table).
- **(chosen by Claude)** Pay runs: one per client per week (Monday 00:00 UTC to the next Monday), drafted by a worker
  job on Mondays or by Finance/PM. One payout item per SME and currency. Held (reported, not submitted): SME account
  not active, an open hold (dispute or fraud flag, placed by Finance, Admin or a Validator), standing SUSPENDED, payee
  not READY. Balances under USD 10 / INR 500, and held, failed or returned amounts, carry into the next run.
- **(chosen by Claude)** Approvals: a PM (or Admin) confirms, then a FINANCE user approves. Above
  `PAYRUN_SECOND_APPROVAL_ABOVE` two different Finance approvers are needed; until that is set, every approval is
  flagged `singleApprover: true` in the audit log (and `sameAsConfirmer` when the same person confirmed). A Finance user
  who is paid in the run (matched by email) cannot approve it. Only Finance submits; submission re-checks payees and
  sends each payment with a stable idempotency key, so a retried submit pays nobody twice. Approved runs can be
  cancelled and rebuilt; submitted runs cannot.
- **(chosen by Claude)** Provider webhook `POST /api/v1/integrations/trolley/webhook`: signature on the raw body with a
  5-minute tolerance, one receipt per provider event id (duplicates return `duplicate: true`), events from the other
  mode (test vs live) are recorded and ignored. Payment statuses only move forward (SUBMITTED → PAID/FAILED/RETURNED,
  PAID → RETURNED); FX (payout currency, rate, amount) is stored from the provider. A run completes when every item is
  final.
- **(chosen by Claude)** Reconciliation runs daily for the previous UTC day (and on demand): every mismatch between the
  provider's settlement report and our items becomes an open exception — unknown payment, amount/currency mismatch,
  status mismatch, or a payment we marked PAID that is missing from the report. Finance resolves each with a note.
- **(chosen by Claude)** Partner fees: one entry per certified candidate (event `cert.certified`) for the partner that
  supplied them, at the partner's fee terms (`PUT /partners/:id/fee-terms`, Admin). Without agreed terms the entry is
  written at zero with the note `NO_FEE_TERMS` so Finance sees it. Statements are built monthly (worker job, and on
  demand) per partner and shown in the partner portal with the partner's own candidate ids.
- **(chosen by Claude)** New internal role `FINANCE` (label Finance). Payee data in Praxis is provider, reference,
  status and payout currency only.

### UI usability: required markers, grouped menu, Support Bot (owner, 28 Sep 2026)
Spec: `docs/SUPPORT-BOT.md`. Owner chose: bot in the console and partner portal only; it answers from the screen, the
help pack and the user's own data; required markers on every screen of all three apps; built on `m10-sme-supply`.
- **(chosen by Claude)** Marker: a red asterisk after the label plus one "Fields marked * are required." line per form;
  the control carries `required` or `aria-required`. The API schema decides what is required.
- **(chosen by Claude)** Menu groups: Home; Projects (Projects, Templates, Requisitions); Reviews (Applications, Task
  reviews, RL reviews, Identity reviews, Conflicts); Certification (Guidelines, Certification reviews); Partners;
  Payments; Admin (Users, Taxonomy, Terms, Failure codes, API clients). A group link opens its first page.
- **(chosen by Claude)** The bot's record lookup replays the read-only API call for the page with the user's own
  session, so permissions are exactly the user's; refused calls attach nothing; secret-looking keys are removed.
- **(chosen by Claude)** Model `claude-sonnet-5` (`SUPPORT_MODEL`) for fast, low-cost answers; mock locally. Questions
  are not stored; 20 per minute per session; last 10 turns sent back each time.

### Release 1.1 test build preparation (28 Sep 2026)
- **(owner)** After the 1 PM CDT merge, `main` replaces release 1.0 in the tester environment (`docs/RELEASES.md`,
  `docs/releases/RELEASE-1.1-TEST-BUILD.md`).
- **(chosen by Claude)** In the test/demo environment (`APP_ENV=demo`, email simulated) a partner who submits a live
  candidate sees the invite link on screen ("Test environment: invite link"; `inviteLinkForTesting` in the Partner API
  response). Production never returns it; the link is only emailed.
- **(chosen by Claude, defect fix)** An invite belongs to one person: once an account is linked to it, any other account
  that opens the link gets 409 `INVITE_TAKEN` and the candidate record is not reassigned. The original person can open
  it again. (Found while writing TC-PTR-015; the M10a test had asserted the wrong outcome.)
- **(chosen by Claude)** `infra/demo/deploy-demo.sh` gains `PRAXIS_SME_SUPPLY=1` (flag on for all services, M10 test
  data: `finance@praxis.demo`, partner portal login `partner@praxis.demo`, a rate card and an open requisition); the
  nightly build sets it. Issue forms gain the Partner and Finance personas and labels for the new areas.

### M10d Screens
- **(chosen by Claude)** Every M10 screen reuses the existing console and candidate-app layouts, tokens and component
  classes (`card`, `hero`, `pill-*`, `btn-*`, `chip`); no new visual style and no new dependencies. The sign-off
  prototype was used for flow only.
- **(chosen by Claude)** The partner portal is a separate route tree in `apps/web` (`/partner/login` and a
  `/partner/(portal)` group with its own layout, header and nav), so the console layout never handles partner
  sessions. Partner API v1 stays on the API host (`/partner/v1`); the web host's `/partner/*` is the portal.
- **(chosen by Claude)** Console menu items for M10 (Requisitions, Certifications, Guidelines, Partners, Payments) and
  the candidate app's Certifications and Payments links appear only when `SME_SUPPLY_ENABLED` is set in that app's own
  environment. Reached directly with the flag off, the pages say SME supply is not switched on (the API returns 404).
- **(chosen by Claude)** Candidate test player: one question at a time with a question map and countdown; answers
  autosave (1.5 s after a change, retried while offline); integrity events are batched every 5 s and the candidate is
  told they are logged and never fail anyone on their own; the test submits itself at the deadline. Ordering items use
  keyboard-accessible Up/Down buttons (no drag and drop).
- **(chosen by Claude)** The C07 checklist's certification and payment items show their status and link to the course,
  test or payment page; they have no acknowledge button ("Completes automatically").
- **(chosen by Claude)** Starting a test after a real Stripe selfie check does not need the session reference in the
  return URL: the API uses the latest selfie check the candidate started for that certification.
- **(chosen by Claude)** Local development and the demo: the simulated payout page completes payment set-up through
  `POST /me/payee/mock-complete`, which exists only when the payout mock is in use.
- **(chosen by Claude)** Written grades in the console show the model score as "Recommendation — you decide"; the
  Expert queue in the candidate app asks the Expert to type their own score.
- **(chosen by Claude)** Playwright smoke tests (`e2e/m10.spec.ts`) cover the partner submit flow, a candidate's
  course → test → result, and a pay run from build to submission. Steps that are a person's FLOW 2 decision or a
  fixture (selection, a payable SME) are set by `apps/api/scripts/e2e-m10.ts` against the e2e database only. The e2e
  set-up now also runs the worker and points storage at the local GCS emulator.

### Release 1.1 test build deployment (30 Sep 2026)

- **(owner)** Testers report in a separate private repository, `vasudevansundarababu-dev/adi-praxis-testing` (no
  application code; tester guide, test cases, decision register, issue forms, labels, `/verified` and `/failed`).
  Created by `infra/test/create-tester-repo.sh`; testers get the Triage role. Tester decision D-PR-04.
- **(owner)** `m10-sme-supply` is fast-forwarded into `main` (no pull request) on 30 Sep and deployed to
  `adi-praxis-test-0928` as `test-1.1-20260930`; testing starts Thursday 1 Oct, 09:30 IST.
- Open: the nightly defect agent still reads issues in the code repository only. Until it is pointed at
  `adi-praxis-testing`, tester defects are fixed by developers.

### User guide, test-case audit and demo videos (1 Oct 2026)

- **(owner)** The user guide lives in `docs/user-guide/` (one chapter per role, plus roles, user IDs and admin
  functions) and is also built as a PDF (`node docs/user-guide/build-pdf.mjs` → `out/user-guide/`). The existing test
  cases are audited and extended rather than replaced. The demo videos are recorded on the testers' environment.
- **(chosen by Claude)** The guide documents release 1.1 as built. Where the build has no screen (user management,
  audit log, dataset, SME standing) the guide says so and gives the API, instead of describing screens that do not
  exist. Passwords are never written in the guide; it points to Secret Manager.
- **(chosen by Claude)** Demo videos are scripted Playwright recordings (`e2e/demo-videos/`) with on-screen captions,
  a visible cursor and title cards, and no voiceover. They are re-runnable for each release. The MP4s are written to
  `out/demo-videos/` and are not committed, because they are large. Data the videos create is named `[Demo video] …`.
- **(chosen by Claude)** The video story uses two experts. Asha applies directly and writes a task. Ravi comes through
  a partner and takes the certification. Answer keys stay on the server, so a scripted candidate cannot be sure to
  pass, and a non-certified requisition applicant cannot be assigned work. The certification result shown is whatever
  the script's answers earn. Steps that are not the point of a clip are done off camera through the same UI or API: the
  second expert's profile and onboarding, approving the remaining knowledge items and item families, and learning
  module-quiz answers.
- **(chosen by Claude)** The videos are rehearsed on a local copy of the demo environment
  (`e2e/demo-videos/local-stack.sh`: its own database `praxis_video` and ports 3500/3501/4500), so a running
  `pnpm dev` is not disturbed.

### Console user management and temporary passwords (2 Oct 2026)

- **(owner)** Admins create console users, and partner portal users, from the console and give them a password. Each
  person changes it at their first sign-in. 1Password is integrated later.
- **(chosen by Claude)** Praxis generates the temporary password (16 characters from an unambiguous alphabet, about 80
  bits, shown as four groups). It is shown to the Admin once, like API keys. It is stored only as an argon2 hash and is
  never returned on an idempotent replay, written to the audit log or emitted in an event. It is **not emailed**: the
  tester rules forbid passwords in email, and the Admin passes it on through a password manager. The 1Password
  integration slots in at that "copy" step.
- **(chosen by Claude)** While a user has a temporary password, the API refuses everything except "who am I",
  sign-out and change-password (403 `PASSWORD_CHANGE_REQUIRED`). This is enforced in the RBAC hook, not only by
  redirecting in the UI.
- **(chosen by Claude)** A password reset issues a new temporary password and signs the person out everywhere. Admins
  cannot reset their own password; they use Change password. Changing your password signs out your other sessions.
  New passwords need at least 12 characters, must differ from the current one, and must not contain the email name.
  NIST SP 800-63B favours length over composition rules, so there are no composition rules.
- **(chosen by Claude)** Admin → Users also gets Edit roles and Disable / Enable, so user management no longer needs
  the API. Partner portal users get Reset password and Disable / Enable, closing the "cannot disable a portal user"
  gap.
- **(chosen by Claude)** An Admin may still set a known password through the API, with `requirePasswordChange` on by
  default. Test fixtures and the shared demo account `partner@praxis.demo` turn it off. The shared demo console
  accounts are created by the seed and demo job, not the API, so they are unaffected.

## QA environment for authoring v2.1 waves (10 Nov 2026)

- **(owner)** Wave builds reach QA through `main` (option A). Development builds and tests each wave on
  `feat/authoring-v21`, then merges it to `main` through a pull request with CI green and owner approval. The QA
  build and deploy (Nightly build, scheduled or on demand) then takes current `main`. The pipeline is unchanged, and
  no branch builds go to QA. Consequence: the Saturday staging build also takes whatever waves are on `main`.

## Authoring v2.1 (owner-approved build, 10 Nov 2026)

Plan: `docs/authoring/AUTHORING-V2.1-PLAN.md`. Source: handover v2.1, chapters 00-18.

- **(owner)** Build in template waves: Wave 1 (5 templates) Wed 11 Nov, Wave 2 (3) Fri 13 Nov, Wave 3 (3) Sun 15 Nov,
  weekends included. Each wave ends end to end: author, review, export, Anvil import. The OpenHands
  `AUTHORING-V2-PLAN.md` is not used.
- **(owner)** A live Vertex session in QA is mandatory for every wave. Automated tests keep the mocks (CLAUDE.md rule 5).
- **(chosen by Claude)** Graph wire id `praxis.workflow_graph.v1-proposed` until Anvil allocates one; it never reuses
  `praxis.anvil.task.v1/v2/v3`.
- **(chosen by Claude)** Execution semantics for checks: non-choice nodes fan out to every successor; decisions take one
  branch (each condition, plus mandatory `else` and `unknown`); human steps take `responded` or `timeout`. Every cycle
  closes through a declared loop with a limit (1-50) and an exhausted exit outside the loop. Each artifact has one
  producer (no last-writer-wins). These are recorded in `contracts/praxis/workflow-graph/README.md` for Anvil.
- **(chosen by Claude)** Agent projection keeps decision outcome labels but removes their predicates, rubric bindings,
  private artifacts and future evidence.
- **(chosen by Claude)** All templates are `SINGLE` agent mode for now, KYB included, so every wave exports end to end;
  `MULTI` is switched on per template once Anvil can run multi-agent graphs. Overrides the earlier "KYB = MULTI" idea.
- **(owner, 10 Nov)** The QA chatbot runs on Claude Sonnet 5.5 (`claude-sonnet-5-5`) for cost, Haiku 5.5 as the cheap
  backup. Google denied the Claude quota on Vertex, so until the appeal succeeds QA uses Gemini through the same
  setting: `AUTHORING_MODEL=gemini:gemini-3.8-flash` (gemini-2.5-flash returns 404 in the QA project). Same prompt, proposal schema, guards, daily cap and logging.
- **(chosen by Claude)** The provider is a prefix on `AUTHORING_MODEL` (`gemini:` or `claude:`, bare = Claude) rather than
  a second setting, so one value fully describes the chatbot model. The Gemini path reuses the meta-compiler's
  `generateContent` caller (no new dependency). The chatbot request sends no thinking, tool_choice or sampling
  parameters, which Sonnet 5.5 rejects.
- **(chosen by Claude)** Existing KYC `dependsOn` steps are not migrated into graphs. A graph is a new optional part of
  the task output; legacy outputs stay readable and unchanged.

## Anvil project policy manifest v1 emitter (authoring v2.1 wave 1, 10 Nov 2026)

Anvil's contract `praxis.anvil.project_policy.v1` (`contracts/anvil/project-policy-v1/`) is used unchanged. Praxis has
no field for several Anvil concepts, so the emitter maps conservatively. Details and endpoints:
`docs/integrations/ANVIL-PROJECT-POLICY-V1.md`.

- **(chosen by Claude)** **Source project.** `source_project.id` is the Praxis project UUID (the same value as
  `source.project_id` in every `praxis.anvil.export.v1` envelope, so the two can be cross-checked). `name` is the
  project name. `version` is content-addressed: the sha256 of the manifest without that field. The same id and version
  therefore always mean the same content, and any change (new rule set, new approved record, correction) gives a new
  version. Praxis has no project version of its own that changes with all of these. *Owner/Anvil to confirm.*
- **(chosen by Claude)** **Policy granularity.** One Anvil policy per (published rule set version, cited policy document
  version). `policy_id` is the Praxis `PolicyDocument` id (stable across document and rule-set versions); `version` is
  `rs<rule set version>.d<document version>`. Both parts are immutable in Praxis, so a policy id+version can never
  change content. `title` is the document title; `source_id` is the document version id.
- **(chosen by Claude)** **Which rules.** Only rules in published `ProjectRuleSet`s (Reviewed rule versions). Draft,
  Needs definition and Excluded rules, unpublished documents and SME task-source uploads are never exported. A rule sits
  under the document version of its requirement citation (the `supports` one first); review guarantees one exists. A
  rule citing several documents is exported once, under that citation, not duplicated.
- **(chosen by Claude)** **Rule fields.** `rule_id` is the Praxis rule key when it matches Anvil's id pattern, else
  `rule-<rule uuid>`. `requirement` is the reviewed requirement text only: title, applicability, exceptions, evidence
  needs, verification hints and task changes are not exported. `source_location` is a locator only ("document version
  1: page 3; lines 4-6; section 2"), never quoted source text.
- **(chosen by Claude)** **Severity.** Praxis rules have no severity (`required` is a publication gate and is mutable on
  the rule, not part of the frozen rule set). Every rule is exported as `high`: not `critical` (no evidence that a
  breach is a hard failure) and not lower (that could hide a real breach). *Owner to decide whether Praxis should
  capture severity per rule.*
- **(chosen by Claude)** **Visibility.** `agent_visible` → `agent_instruction`; `evaluator_only` → `evaluator_only`.
  Nothing else is ever placed in an `agent_instruction` rule: no reference answers, rubric criteria or answer keys,
  private evidence, evaluator-only text or task-change text.
- **(chosen by Claude)** **Rubric and failure-mode links.** Omitted: Praxis does not link policy rules to rubric
  criteria or failure modes, and inventing links is not allowed.
- **(chosen by Claude)** **Project defaults.** The policies of the latest published rule set. Praxis rule sets use
  inheritance mode `ALL_TASKS`, which is exactly "applies to every task by default"; any other mode blocks the export
  (`UNSUPPORTED_INHERITANCE_MODE`).
- **(chosen by Claude)** **Task bindings.** One per current approved record of the project that carries an executable
  contract (`output.praxisContract`); superseded records are left out, so a corrected task is bound once, at its latest
  version. `task_id`/`task_version` come from the contract; `payload_sha256` is computed by the same code as the
  praxis-contract export (`apps/api/src/dataset/praxis-export.ts`). `policy_refs` are the policies of the rule set the
  task's own frozen policy snapshot used (the submission the review approved). `excluded_project_policy_refs` lists
  every current default not in `policy_refs`: a task frozen under an older rule set excludes the newer defaults, and a
  task approved with no snapshot (the project had no rule set then) excludes all of them. Nothing is applied to a task
  that its author and reviewer did not see.
- **(chosen by Claude)** **Task changes.** Clarifications and stricter constraints cannot be expressed in the v1
  manifest; the task is still bound to its base policies (they stay in the existing per-task sidecar). An exemption
  would make Anvil penalise allowed behaviour, so any bound task whose snapshot has an exemption blocks the export
  (409 `TASK_EXEMPTION_NOT_REPRESENTABLE`). *Owner/Anvil to decide how per-task changes should travel.*
- **(chosen by Claude)** **Sources.** Each cited document version is one source at
  `policies/<document id>/v<version>.<pdf|docx|txt|md>` with its stored size and sha256 and its exact original bytes.
  `media_type` comes from the detected format (Praxis stores `text/markdown; charset=utf-8`; Anvil's enum has no
  parameters).
- **(chosen by Claude)** **Invalid state is never served.** The emitter runs the shared validator (schema, semantic
  checks, source bytes, and binding against the real export envelopes) and answers 409 `PROJECT_POLICY_INVALID` with
  every problem. A record whose own export is blocked (invalid contract, record hash) blocks the manifest too
  (`TASK_EXPORT_BLOCKED`).
- **(chosen by Claude)** **Access and audit.** Admin (any project of the tenant), the project's owning PM, and the
  tenant's `RL_GYM` API client; anyone else gets 403 (wrong role or client kind) or 404 (other project or tenant).
  Every export, source download and blocked attempt writes an audit event (`anvil.project_policy_exported`,
  `anvil.project_policy_source_downloaded`, `anvil.project_policy_blocked`). Nothing else is written.

## Authoring v2.1 Wave 1: template profiles (10 Nov 2026)

- **(chosen by Claude)** All five Wave 1 profiles are agent mode `SINGLE` (owner default, plan §6). Non-KYC field
  contracts are built from `templates/*/task.md` and marked `requires_confirmation`.
- **(chosen by Claude)** Profiles match the catalogue workflow name; the handover's "Noise Cancelling Headphones Launch"
  and "Omnichannel Creative and Locale Compliance" are recorded as `handoverName` only.
- **(chosen by Claude)** A task that already holds legacy generic content keeps the generic editor; only blank or
  profile outputs open the profile editor. No silent migration.
- **(chosen by Claude)** The KYC agent preview keeps its existing view; the KYC profile drives progress, checks and
  projection in shared code, and `kycChecks` stays authoritative at submission.
- **(chosen by Claude)** Anvil contract mapping and blockers: see `docs/authoring/TEMPLATE-PROFILES.md`. Export
  blockers never block submission. KYC criteria gain three optional binding keys (`outputField`, `comparison`,
  `expectedValue`); until the workbench edits them, KYC exports are reported as blocked.

## Authoring v2.1 Wave 2: Expert → PM review route (12 Nov 2026)

Route and rules: `docs/authoring/REVIEW-ROUTES.md`. Owner decisions already taken (plan §6): the same person may be
Expert and PM with two audit events; Expert edits need a reason, and a material edit needs the author to reconfirm.

- **(chosen by Claude)** **Data.** The pending stage lives on the task (`TaskInstance.reviewStage`); stage decisions
  are `TaskReview` rows (already append-only) with `stage`, `contentHash`, `editReason`, `material` and two new
  decisions `PASS` and `EDIT`. PM approval is stored as `ACCEPT` with `stage = PM_APPROVAL`. Chosen over a new table so
  existing readers (author feedback, chatbot feedback) need only a filter; SME → PM rows are untouched (`stage` null).
- **(chosen by Claude)** **Binding.** A decision binds to the submission version and the sha256 of its output (stable
  JSON). It is in force only while that version is the latest with the same hash; any content change is a new
  version, so voiding needs no update to an append-only row. Stale requests get 409 `STALE_STAGE_DECISION`.
- **(chosen by Claude)** **Expert.** A Validator assigned to the project. Admins act as Expert only when assigned (the
  Expert stage is a domain responsibility, not an admin power). On this route the author check applies to Admins too.
- **(chosen by Claude)** **PM approval.** The project's owning PM or an Admin. The PM approves or returns; only the
  Expert rejects (spec: "PM may approve the exact eligible revision or return it").
- **(chosen by Claude)** **Expert edits** are allowed at Expert review and at PM approval (before the PM acts). An edit
  at PM approval voids the pass and goes back to Expert review. The Expert declares materiality explicitly (required
  boolean); the server does not guess it. Material: the task returns to the author (`REWORK`) to reconfirm by
  resubmitting; it does not increment `reworkCount`. Minor: stays submitted at Expert review.
- **(chosen by Claude)** **Checks on an edit.** All task checks re-run on the edited output except the author's own
  attestations (`authoring.*`, `conversation.*` consent and declarations); new possible-real-data flags need an
  explanation (earlier explanations carry over). The duplicate search re-runs; the export contract is recompiled. The
  new version keeps the policy snapshot of the version it replaced.
- **(chosen by Claude)** The one-step decision endpoint refuses two-stage tasks (409 `STAGE_DECISION_REQUIRED`), so a
  Validator cannot accept without PM approval.
- **(chosen by Claude)** Open-slot coverage tags are confirmed by the Expert at pass (the console confirms the author's
  tags; correcting them in the stage panel is left for later). Duplicate decisions are taken by the Expert.
- **(chosen by Claude)** Rework comments on this route can be pinned to a section (any section id, e.g. `S1`, `W04`), a
  graph node or a field path. The one-step route keeps its W01–W06 rule.
- **(chosen by Claude)** PMs see the review queue and task page only for their own two-stage projects; a PM without the
  Validator role still gets 403 on SME → PM tasks, as before. Source-file downloads and the LLM judge panel keep their
  existing access (Validators and Admins).
- **Open (owner):** a field-level Expert editor (the console uses a JSON editor today); whether a PM may also reject;
  whether material edits should be detected automatically (e.g. any rubric or reference change).

### Authoring v2.1 Wave 2: owner answers (11 Nov 2026)

- **(owner)** The PM may reject a task at PM approval, as the Expert may at Expert review (same reasons, audited with
  responsibility PM). The same person may act as Expert and PM; both decisions stay separate.
- **(owner)** Any change to the rubric or the reference answer is a material edit, whatever the Expert declares: KYC
  `rubric` and `solution`; profiled templates S5 (expected work), S6 (outcomes and reference values) and S7 (rubric).
  The task returns to the author to reconfirm; the audit records the declared and the effective materiality and the
  paths that forced it.
- **(owner)** No field-level edit form for Experts: the JSON editor stays.
- **(owner)** Policy sources on the review page move to Wave 3, with SME policy proposals.
- **Open for the owner (12 Nov):** domain confirmation of the three Wave 2 field contracts (Adverse media review,
  Enhanced due diligence, Customer risk rating; gaps listed in `docs/authoring/TEMPLATE-PROFILES.md`), and the owner's
  live Wave 2 session in QA (`docs/authoring/WAVE-2-TEST-NOTES.md`).

## Authoring v2.1 Wave 3: policy proposals, policy sources, open model, 3 templates (12 Nov 2026)

- **(owner)** Wave 3 is built on its own branch `feat/authoring-wave3`, cut from the tip of `feat/authoring-wave2`, while
  Wave 2 waits for its QA deploy; the two are tested together in QA. Nothing pushed; main untouched.
- **SME policy proposals** (handover chapter 07) are a separate bridge, not task-source upload and not the PM/Admin
  policy routes. An SME proposes from their own task; the proposal is `PENDING` until a decision.
  - **Who decides:** a Validator assigned to the project (Expert), the owning PM or an Admin. The plan says "Expert
    reviews"; the PM and Admins may also decide because they can already upload policy directly. The decision records
    the role. An internal user whose email matches the proposing SME cannot decide.
  - **Outcomes:** Accept / Return / Reject, each with a qualification (policy candidate, supporting reference, unrelated,
    unreadable, sensitive) and a reason the SME sees. Only a policy candidate or supporting reference can be accepted.
  - **Accept** copies the original bytes into a new project document version (origin `SME_PROPOSAL`) through the
    existing document service. Nothing becomes a rule until the PM extracts, reviews and publishes it: no new
    publication path.
  - **Intake flags are advice only** (deterministic: unreadable, few requirement words, invoice/statement/marketing
    wording, suspected real data, text addressed to an AI). No automatic rejection; the reviewer decides.
  - **Unreadable files** (scans with no text) and files with suspected real data are kept as pending so the reviewer can
    see them, but cannot be accepted: they are returned for a readable or synthetic copy. Suspected real data is stored
    in Praxis's text reading only redacted; the original file is downloadable by reviewers only.
  - Refused outright as for PM uploads: malware, unsupported format, encrypted, over 10 MB, too many pages, empty.
  - Limits: 10 pending proposals per SME per project; 10 uploads a minute per SME. Re-proposing the same file while it is
    pending returns the existing proposal.
  - The database refuses deleting a proposal, changing its file or owner columns, or changing it after a decision.
- **Retrieval for authoring** returns only rules of the latest published rule set that are agent-visible and in force
  today (effective from/to). This applies to the SME's rules panel, the chatbot view, the model's context and the agent
  preview. It fixed a leak: the chatbot view and the model received evaluator-only rules. PM views, snapshots and
  exports are unchanged. No vector index added: the published rule set is small (chapter 07 "start with the existing
  published project rule set").
- **Policy sources on the review page** show the frozen snapshot when there is one, else the current published set,
  with every rule (evaluator-only labelled), its quoted source, document, version, page/line and hash, the task's rule
  changes and the steps the SME linked; a warning when newer rules were published after the snapshot. Same access as
  the review page.
- **Open model:** `AUTHORING_MODEL=maas:<publisher>/<model>` with `AUTHORING_MAAS_LOCATION`; pilot `gpt-oss-120b`,
  compared with Gemma 4 26B A4B IT in the owner's QA session. Must be enabled in Model Garden in `adi-praxis-test-0928`
  first (`docs/authoring/WAVE-3-TEST-NOTES.md` §4).
- **Templates:** Q4 global paid search query clustering, Fraud-risk/compliance handoffs, Compliance monitoring; agent
  mode Single; field contracts "requires confirmation" (gaps in `docs/authoring/TEMPLATE-PROFILES.md`).
- **Open for the owner:** domain confirmation of the Wave 2 and Wave 3 field contracts; the live QA session for Waves 2
  and 3 together (`WAVE-2-TEST-NOTES.md`, `WAVE-3-TEST-NOTES.md`), including the open-model comparison.
- **(owner, 12 Nov)** QA stays on Gemini through Vertex for the Wave 1–3 sessions. The open-model (Vertex MaaS)
  comparison is deferred until Google approves the Model Garden quota for `adi-praxis-test-0928` (request pending with
  Google Cloud support). Wave 3 sign-off does not wait on it; switching later is a configuration change
  (`AUTHORING_MODEL=maas:<publisher>/<model>`, `AUTHORING_MAAS_LOCATION`) plus the smoke check, no new build.
### Authoring v2.1 Wave 2: owner field-contract answers (12 Nov 2026)

- **(owner)** The drafts' pick lists for Adverse media review, Enhanced due diligence and Customer risk rating are final.
- **(owner)** Adverse media: per-source reliability from a fixed list (high / medium / low / unknown) with a reason; an
  `escalate` recommendation goes to a "Compliance reviewer decides" person step.
- **(owner)** EDD: a graded overall risk rating (low / medium / high / very_high) beside the recommendation.
- **(owner)** CRR: a rating per risk factor (low / medium / high), no weights or formula; a proposed override goes to a
  "Senior compliance approver decides" person step.
- **(owner)** Failing a critical rubric criterion fails the whole task. Exported to Anvil as a hard-failure constraint
  with the criterion's binding (Anvil's `praxis.anvil.task.v1` already has `constraints[].hard_failure`), so no new
  Anvil field is invented.

### Authoring v2.1 Wave 3: owner field-contract answers (12 Nov 2026)

- **(owner)** The drafts' pick lists for Q4 paid search, Fraud-risk/compliance handoffs and Compliance monitoring are final.
- **(owner)** Q4: every query is graded. Built as per-query output.json fields (`q01_intent`, `q01_assignment`,
  `q01_cluster`), at most 20 queries per task (Anvil task v1: no list type, 50 criteria). Generated per-query criteria
  carry 50% of the score (default taken; the owner can change the share).
- **(owner)** Q4: the catalogue's F1 ≥ 0.99 is checked automatically in Praxis on Anvil's results: pairwise clustering
  F1 against the reference, shown to the RL Reviewer as advice. **Needs Anvil:** RL Gym / Anvil must send the run's
  output.json as the new optional `final_output` field on `POST /integrations/rl-gym/review-requests`; without it the
  screen says the score is not available.
- **(owner)** Fraud handoffs: a "Receiving team accepts handoff" person step; fixed lists for fraud indicators and
  compliance concerns (as approved); the common business hand-off is hidden.
- **(owner)** Compliance monitoring: a severity per exception as well as the overall graded severity.

### Help chatbot for authoring v2.1 (owner, 12 Nov 2026)

- **(owner)** The help chatbot must explain these decisions to Authors, Reviewers and Approvers, and be stronger than
  before. Built: an SME Help button and `POST /me/support/ask`; an authoring guide covering every authoring v2.1
  decision; per-template guides generated from the template profiles and workflows; more staff screens recognised;
  Gemini support in QA (`SUPPORT_MODEL`, defaulting to a Gemini `AUTHORING_MODEL`). See `docs/SUPPORT-BOT.md` §4.
- The SME bot never writes task content: it explains fields and decisions only (authoring integrity, as for the
  authoring chatbot).

### Generated job descriptions (owner bug report, 12 Nov 2026)

- **(owner)** Each template has skills. When a PM creates a project, the JD is generated with the template's skills as
  **mandatory** skills, plus the demographic and education profile, so the JD is complete. If the project needs a
  reviewer (route SME → Expert → PM), a **reviewer JD** is generated with the same skills and more years of
  experience. Both go to recruitment.
- **Built (Wave 2 branch, merged into Wave 3):** shared `packages/shared/src/jd-generator.ts` (deterministic, no
  model); API `apps/api/src/projects/generated-jd.ts` runs on project create and every draft edit; new
  `GET /projects/:id/job-descriptions`; wizard step 5 defaults to "Generate from the template".
- **Default (decided, change on request):** experience = the project's Domain experience filter minimum, else
  **5 years**; education = the lowest level the project's Education filter accepts, else **Bachelor's or equivalent
  (ISCED 6)**; reviewer = author + **5 years**. The demographic profile lists every other filter in plain words with
  required / preferred.
- **Default:** the PM may edit the title, responsibilities, pay and location and add skills; the template's skills
  cannot be removed (API 400 `MANDATORY_SKILLS_REQUIRED` and a database CHECK). Requirements re-follow the template and
  the filters on every draft save; title and responsibilities are rewritten only if the template changes.
- **Default:** a generated JD starts with no pay (pay comes from the template's default JD when it has one); submit is
  blocked until each JD has a wage per task. A hand-picked JD is still allowed but must include the template's skills.
- **Default:** generated JDs belong to their project and are hidden from the reusable JD list.
- **Recruitment:** the job post's criteria are generated from the JD (mandatory skills, experience, education and
  required demographics → REQUIRED; added skills and preferred demographics → PREFERRED). For the reviewer JD,
  requisitions (M10) get a "Fill from project JD" button that uses the reviewer JD for Expert and Reviewer-SME tiers.
- **(owner, 12 Nov 2026) Reviewers get their own public job post.** Built: one opportunity per project and role
  (`Opportunity.role`, unique per project and role). SME → Expert → PM projects have a second post, built from the
  reviewer JD (contribution role Reviewer; its criteria include the higher experience). The console's opportunity page
  has "Task authors" and "Expert reviewers" tabs (`?role=REVIEWER` on every owner route); the candidate app shows the
  post with a note that it is an Expert reviewer role.
- **Default:** reviewer applicants go through the same candidate flow (profile, identity, human selection decision).
  A SELECTED applicant with a verified identity becomes the project's Expert with "Make Expert"
  (`POST /projects/:id/reviewer-applicants/:enrollmentId/make-expert`): a Validator (REVIEWER) staff account assigned
  to the project. Creating that account, or adding the role to an existing account, stays an **Admin** action (as for
  `/users`; the temporary password is shown once and must be changed). A PM can assign an applicant who already has an
  active Validator account.
- **Default:** author flows (staffing, matching, campaigns, assignment journeys) use the author post only. Requisitions
  for the Expert and Reviewer-SME tiers send candidates to the reviewer post when the project has one.

### Console search bar (owner, 12 Nov 2026)

- **(owner)** Projects, Templates, Candidates and the other lists get a search bar on top of the table; a few letters
  must find a project or candidate, and search should be semantic. For Wave 3.
- **Built:** `GET /search/:type?q=` for projects, templates, candidates (the Applications list; the console has no
  separate candidate directory), requisitions, users and partners; `TableSearch` above each table. Typing filters the
  table to the matches and lists the best matches as links (keyboard: arrows, Enter, Escape).
- **Default: hybrid search.** By letters: title prefix, prefix of every query word, substring, then trigram similarity
  (pg_trgm), so 2–3 letters and typos work. By meaning: from **4 characters**, the query and each record's
  professional text are embedded with the same provider as near-duplicate detection (Vertex `text-embedding-005` in
  QA and production, the hashing stand-in locally and in tests) and ranked by cosine similarity (match ≥ 0.6). If the
  model fails, letters still work and the bar says so.
- **Default: access.** Each list's own rule applies (PMs: their projects; Validators: applicants in their assigned
  projects, never a declared conflict; Users: Admin only), so search never shows a record the list would not.
- **Default: privacy.** Names, emails and other personal details are matched by letters in the database only; only
  professional text (workflow, skills, specialties, jurisdictions, post titles, descriptions) goes to the embedding
  model. Search queries of 4+ characters are embedded too.
- **Default:** the index (`SearchDocument`) is derived data, refreshed from the source rows on each search (changed
  text is re-indexed; changed meaning is re-embedded, at most 20 records per search). It holds no business state, so
  index writes are not audited. Search ranks only; it never makes a decision.

## QA seed users: `qa-users` job (11 Nov 2026)

- **(chosen by Claude)** **Real journey, not database inserts.** Every write goes through the public API at `API_URL`
  (as `demo-setup` does): mock Google sign-in (subject `mock-<lowercased email>`, the same one the candidate app's
  mock screen produces), the mock identity simulation, enrollment, the accessible profile form (CF-30), explicit
  submit, the worker's suitability assessment, the Reviewer's decision and the C07 checklist. States, idempotency and
  audit events are therefore the real ones. The database is only read, to plan and to resume.
- **(chosen by Claude)** **Human decisions.** Each SELECTED decision is made by one of the seeded Reviewers, signed in
  with their own account, rotating across the ten; it is recorded as theirs (`enrollment.decided`, actor USER). The AI
  only recommends. If an assessment has not finished, the job stops short for that SME (no decision is synthesised)
  and a re-run continues.
- **(chosen by Claude)** **"Published template"** means what a PM can use: the newest PUBLISHED version of a workflow
  in an active domain. Drafts and retired templates are not covered.
- **(chosen by Claude)** **Pool per template.** Readiness is per project (FLOW2 section 9), so each template needs one
  pool: the oldest live project with a published opportunity (e.g. *KYC authoring demo*), else a new project
  `SYNTHETIC QA pool — <workflow>` created by `pm@praxis.demo` with template defaults, a USD 1 synthetic JD and a
  non-required country filter (GB, IN, US), then submitted and its opportunity published. A project the owner creates
  later needs its own applications (an SME can apply from the candidate app).
- **(chosen by Claude)** **Spread.** max(30, 3 × templates) slots, shared evenly over templates and filled with SMEs in
  turn, so each template has at least 3 different SMEs and each of the 30 SMEs at least one pool.
- **(chosen by Claude)** **Reviewers** are created by the demo Admin with `POST /users` (audited, no forced password
  change), and attached as Validators to every live project of the covered templates, so candidate and task review
  queues are staffed. An existing account with that email keeps its password; the REVIEWER role is added if missing.
- **(chosen by Claude)** **Synthetic data.** Names start `SYNTHETIC QA`; profile answers say they are synthetic; no
  evidence files; identity is the mock provider's test-mode session reference and status only. Onboarding
  preferences alternate GB (Europe/London) and IN (Asia/Kolkata), English C2, 20 h/week, email notifications off.
- **(chosen by Claude)** **Selection scope** comes from the published brief (domain, specialty, jurisdictions,
  contribution roles); blanks default to the template's domain, GB and IN, and Task author; language English; no expiry.
- **(chosen by Claude)** **Login rate limit.** QA allows 10 sign-ins a minute per route; the job waits out a 429 rather
  than failing, so a first run takes a few minutes.
- **(owner, 11 Nov 2026)** **Gemini option for the suitability assessment.** In QA every assessment failed: the
  evaluator was Claude Opus only and QA's Claude quota is 0. New setting `SUITABILITY_MODEL` (default `claude-opus-5`,
  unchanged); `gemini:<model>` uses Gemini on Vertex with the same prompt, the schema in the prompt (JSON mode) and the
  same validation. Still advisory: a Reviewer decides. *(chosen by Claude)* The `qa-users` job also runs pending or
  failed assessments itself with its environment's model (the worker's own `runAssessment`, so the same claim and
  SYSTEM audit), five at a time, at most 3 tries each; an assessment that still fails leaves the SME undecided.

## KYC template version 2: Golden Bank account opening (11 Nov 2026)

Owner: Anvil benchmarks Praxis with a golden KYC task (Golden Bank KYC authoring reference, golden-kyc-1.0.0); SMEs and
Reviewers must be able to author and accept tasks of that kind on the KYC template, so the whole cycle can be validated.
Owner chose a **new KYC template version** (not a separate template, not a change to the v1 form).

- **(owner)** KYC v1 keeps the KYC workbench; Wave 1 tasks are untouched. KYC v2 uses a new form,
  `kyc-account-opening`, built on the eight-section profile engine.
- **(chosen by Claude)** A template version chooses its form with `Template.profileId` (null = the workflow's default).
  The Admin picks it on a draft version ("Authoring form") and it is checked on save and publish (400 `UNKNOWN_PROFILE`).
  Projects keep the version they were created from, so a project's form never changes under it. The form is an
  *alternate* profile registered by ID only; the workflow's default lookup is unchanged.
- **(chosen by Claude)** What the form holds, from the reference:
  - S1: product (4 golden products), state (CA/NY/TX/FL/IL), application revision, assessment clock and calendar,
    execution limits, and the private scenario slot (1–10).
  - S2: evidence, parties with claimed roles (owner, teen/adult owner, parent, guardian, custodian, beneficiary,
    transferor, signer, attorney-in-fact) and the requested account terms.
  - S3: the fixed golden tool catalogue (21 tools, no free entries) with recorded responses, including 503/429 and
    pending observations.
  - S4: rules cited by key and exact published version.
  - S5: per-party assessment (CIP customer, identity status, open conditions), follow-up rounds (at most 3) and the
    specialist referral.
  - S6: the four-way recommendation.
  - S7: 5-point checks with the 2-point partial-credit anchor, critical failures and the scoring rule.
  - Private answers stay out of the agent view.
- **(chosen by Claude)** **Policy binding.** For a template version with a chosen form, every rule cited in S4 must be a
  rule version published for the project (key and exact version ID). Otherwise submission is blocked by
  `policy.bound-versions`. A project with no published rules is reported as a configuration gap, not a case fact.
- **(chosen by Claude)** One worked golden case ships as reference data (`GOLDEN_KYC_EXAMPLE`: teen joint checking, NY,
  slot 5, resolvable identity gap → `ready_for_approval`). `test/golden-kyc.test.ts` runs the whole cycle with it:
  template v2, project, published GB-01…GB-07, staffing, authoring, checks, Expert pass, PM approval, Approved Task
  Dataset.
- **(owner, 11 Nov 2026)** **Anvil export stays blocked** for golden-style tasks (`MISSING_BINDING` on the
  evaluator-graded checks). Authoring, review and the Approved Task Dataset continue. The golden checks need Anvil's
  task, environment and evaluator bindings and recorded run evidence. Praxis must **not** turn them into extra
  agent-output fields: that would change what is evaluated and could let the agent claim its own compliance. The Anvil
  team defines and documents how these bindings travel, including evaluator versions, evidence references and the
  handling of missing checks, and Praxis implements against that agreed contract. The Golden pack is an authoring
  reference, not an agreed Praxis-to-Anvil export format. Execution, evaluation and reporting stay in Anvil.
- **Open (owner):** the four other cell slots for the products (adult joint, individual, custodial) are authored by SMEs;
  only one worked case ships. The marketing multi-agent golden task will follow the same route when it arrives.

## Project export with Anvil validation (12 Nov 2026)

The owner asked for an Export button on the project page. PMs and Admins who may export validate one task at any time
and export once the project is complete. On export, Praxis calls Anvil's validate API, which says which tasks need to be
fixed. The owner has asked the Anvil team for that API.

- **(chosen by Claude)** **Who.** The project's owning PM or an Admin; anyone else gets 404, as for the project page.
- **(chosen by Claude)** **When.**
  - Validate needs at least one approved task (current records; a correction replaces the record it corrects).
  - Export needs that, plus one of: the distinct-task target is reached, the project is COMPLETED, or the end date has
    come.
  - Drafts and cancelled projects cannot export.
- **(chosen by Claude)** **Validate** takes exactly one task. **Export** validates every approved task and writes one
  file with one JSON line per task: the dataset record, its `praxis.anvil.export.v1` envelope (null when the task has
  no executable contract), and the verdict. The file is stored with its sha256 and can be downloaded again.
- **(chosen by Claude)** **Anvil's API is not published**, so its wire format is not invented. Praxis calls it through
  `AnvilTaskValidator`. Until the Anvil adapter is written against Anvil's documented contract, Praxis runs
  `PraxisPrecheckValidator`: the same checks as the per-record Anvil export. It is labelled "Anvil validation is not
  connected yet" in the console and recorded as `praxis-precheck` on every run.
- **(chosen by Claude)** **The verdict is advice only.**
  - It changes no task, review decision or dataset record. The PM decides what to do; the console links each flagged
    task.
  - If the validator does not answer, tasks are "not validated", never assumed valid.
  - Runs (`ProjectValidationRun`) are append-only and audited (`project.validated`, `project.exported`).
- **Open (Anvil):** the validate API contract: request (envelopes or records), response per task, evaluator versions,
  and error and timeout behaviour. Then the `anvil` adapter replaces the pre-check.

## Golden task packs: upload a form without a code change (12 Nov 2026)

Owner: "Marketing is taking time … I need an utility to upload it later, hopefully without any code changes." Guide:
`docs/authoring/GOLDEN-PACK.md`.

- **(chosen by Claude)** **Format.** A pack (`praxis.golden_pack.v1`) is the authoring form, which is already declarative
  data (`praxis.template_profile.v1`), plus up to 20 worked cases. It may also carry the template for a new workflow,
  because the console has no "new workflow" control.
- **(chosen by Claude)** **Checking.** A pack is checked before anything is stored (`POST /template-profiles/check`):
  - the form must register;
  - it uses sections storage and no specialised editor;
  - its ID must be unused;
  - every example must pass the form's checks.
- **(chosen by Claude)** **Storage.** `UploadedProfile` is append-only (database triggers); a form ID is never reused.
  Upload, and any template it creates, are audited. Admin only; PMs can list forms.
- **(chosen by Claude)** **New workflow.** A pack with `template` creates the workflow's template as a **draft** that
  already uses the form. The Admin reviews and publishes it: nothing goes live from an upload alone.
- **(chosen by Claude)** **Runtime.** Each API instance registers uploaded forms at start, after an upload and every
  minute. The server sends the chosen form with each task, so the SME app and the console need no rebuild.

## Praxis-Anvil contract: Praxis side built (12 Nov 2026)

The owner approved the final contract (`docs/anvil/PRAXIS-ANVIL-CONTRACT-FINAL.md`) and said to build. Praxis builds
what does not depend on Anvil's open questions.

- **(chosen by Claude)** **Anvil keys.** Anvil calls Praxis with an Admin-issued `ANVIL` API key (existing API-client
  mechanism: shown once, stored hashed, revocable).
  - New: keys can expire; `ANVIL` keys must (default 30 days, at most 90).
  - Expired or revoked keys get 401; other key kinds and staff sessions get 403.
- **(chosen by Claude)** **Template API** at `/api/v1/integrations/anvil/templates`: `contracts`, `validate`,
  `proposals`, `proposals/{id}`, `qualifications`.
  - Anvil's `{data, meta.request_id}` envelope.
  - `errors[]` holds what Anvil must fix; `praxis_requirements[]` holds staffing advice as counts only;
    `review_gates[]` is separate.
  - A reused Idempotency-Key with a different body gets **409**, as the contract says (Praxis's other routes keep 422).
- **(chosen by Claude)** **Proposal format.** The spec is `praxis.template_spec.v1-proposed`: a golden pack (authoring
  part) plus Anvil's requirement reference, execution part (environment, tool schemas, allowed evaluator kinds,
  output schema) and authoring/reviewing skills. The joint format is open question 1, so only this wrapper may
  change.
- **(chosen by Claude)** **Drafts from proposals.** A proposal creates a DRAFT template version:
  - version 1 for a new workflow (the pack must carry its template);
  - the next version of an existing workflow (409 when a draft is already open).

  The draft stores Anvil's part unchanged (`Template.anvilSpec`) and takes the authoring skills as the template skills
  (which drive the generated JDs). A Praxis Admin publishes; nothing goes live from the API.
- **(chosen by Claude)** **Qualification.** Anvil qualifies the exact template version hash: sha256 over RFC 8785
  JSON of workflow, version, form, execution part and skills (open question 2).
  - Receipts and revocations are append-only rows (`TemplateQualification`).
  - The console shows "Anvil-ready for benchmarks" only when the version is published and its latest receipt is
    QUALIFIED.
  - Variants copied from a template do not inherit its form or Anvil spec.
- **(chosen by Claude)** **Template gaps closed for Anvil-proposed templates.** Rubric criteria have an evaluator kind.
  On a template version with Anvil's spec, submission requires each criterion to use an allowed kind and each recorded
  tool call to use a tool Anvil described. Graph node types wait for Anvil's catalogue (question 3).
- **(chosen by Claude)** **Anvil export client.** Server-side only (`ANVIL_EXPORT_BASE_URL`, `ANVIL_EXPORT_TOKEN`;
  https only).
  - Raw ZIP, bearer token, no cookies or CSRF.
  - Business results are kept apart from auth, availability, transport, conflict and internal errors.
  - 1 MiB upload bound; a timeout.
  - The token is never logged or echoed.
- **(chosen by Claude)** **Gated validator.** When connected, project export checks `/contracts` first. Until Anvil
  advertises the generic Praxis export contract, no package is sent: tasks show Praxis's own issues plus "not
  validated by Anvil" with the exact reason. A task is never reported valid unless Anvil returned that.
- **Waiting on Anvil:**
  - the package format (Q1), canonical JSON (Q2), catalogue (Q3) and new codes (Q6);
  - then the package builder and the validate/resolve wiring.
- **Waiting on the owner:**
  - an Anvil export token and a Praxis `ANVIL` key, each in its secret store;
  - QA deploy approval.

## Anvil's eight answers: owner decisions (11 Nov 2026)

Anvil answered the eight contract questions (`Anvil-Praxis-eight-answers-v1.md`). Praxis feedback:
`docs/anvil/ANVIL-EIGHT-ANSWERS-PRAXIS-FEEDBACK.md`. The owner accepted these four recommendations:

- **(owner)** **Anvil key lifetime.** A Praxis `ANVIL` key never outlives the pilot bound
  (`ANVIL_CREDENTIAL_NOT_AFTER`, today 2026-12-11T05:48:04Z, the same bound as Anvil's testing window). It also stops
  working on every call once the Admin who issued it is no longer an active Admin. Within the bound the default stays
  30 days. No bound configured means no Anvil key can be issued.
- **(owner)** **Weights on Anvil-proposed templates.** Every criterion weight is above 0, has at most two decimals, and
  the weights total exactly 100 (checked in basis points). Other templates keep their rules.
- **(owner)** **5/2/0 descriptions on Anvil-proposed templates.** Every criterion states full credit (pass condition),
  partial credit and fail. The new optional `failCondition` field is required only there; current KYC forms are
  unchanged.
- **(owner)** **One Anvil project per environment** receives all Praxis exports. `ANVIL_EXPORT_BASE_URL` points at
  that project's generic path, `…/api/v1/projects/{project}/dataset-exports/generic`.
- **(chosen by Claude)** Revocation keeps authoring and flags affected projects, as Anvil answered (Q5) and the owner
  proposed. Anvil generic support is detected by the exact contract ID, never a similar name.

## Anvil's four confirmations: Praxis defaults (12 Nov 2026)

Owner: "Finish the remaining tasks. Will make one final build." Defaults taken, details in
`docs/anvil/ANVIL-FOUR-CONFIRMATIONS-PRAXIS.md`:

- `template_id` in the joint object is the template **lineage** UUID (stable across versions); the version row ID is
  returned as `template_version_id`. Both proposal formats stay accepted so earlier proposals keep working.
- A joint template's qualification hash is `template_sha256`; a qualification may name `(template_id, version)`.
- Readiness: a revocation event revokes only its receipt; an earlier-format REVOKED row still revokes all receipts.
- The export sends only the agent view of a workflow graph, and refuses any task whose Anvil public view would differ
  from Praxis's agent view (`GENERIC_PRIVATE_EXPOSURE`), rather than letting private sub-fields reach `actor.json`.
- Export resolves each Anvil-valid package with `Idempotency-Key: praxis-<package_sha256>`; validate never resolves.
- Package review provenance is `praxis-approved-record:<record id>:<content hash prefix>` (opaque, no person).
- `ANVIL_ENVIRONMENT` (default `qa` in the deploy script) binds revocation events with the project in
  `ANVIL_EXPORT_BASE_URL`; unbound environments refuse revocations.

## Keyless Praxis <-> Anvil (12 Nov 2026)

- **No API keys between Anvil and Praxis** (owner: "No need for API keys ... it's a waste of time"; Keystone K6; requirement 49172 section 7.1).
  - **Both directions:** each side sends a raw Google-signed ID token for its own runtime account. The "no auth at all" option was not taken.
  - **Inbound checks:** RS256; issuer exactly `https://accounts.google.com`; exact audience (this API's numeric run.app origin); pinned numeric subject and service-account e-mail; `iat`/`exp`.
  - **Grant:** the caller also needs an ANVIL grant row, checked on every request, plus the pilot stop (`ANVIL_CREDENTIAL_NOT_AFTER`).
    - The deploy's setup job creates the grant row. It is audited, and an Admin can revoke it.
    - A redeploy never re-creates or re-enables a revoked grant.
    - A grant row has no usable key.
  - **Scope:** a keyless caller reaches only the five Anvil integration routes; every other route answers 401.
  - **No legacy fallback:** once keyless is configured, ANVIL API keys are refused and new ones cannot be issued (409 `ANVIL_KEYLESS`). Other key kinds are unchanged.
  - **Outbound:** the runtime account's identity token for the Anvil origin, from the metadata server only. `ANVIL_EXPORT_TOKEN` is removed.
  - **Configuration:** Anvil's account and subject are repository variables, not secrets, kept out of this public repository.

## Corrected KYC template: reusable five-state proposal (13 Nov 2026)

- **Owner:** "Finish the corrected KYC and Marketing templates." Contract: Keystone K1–K6; requirement 49172, sections 5.1–5.3 and 7.2.
- **Execution part:** Praxis accepts `anvil.template-execution.v2` as well as v1 and stores it unchanged.
  - v2 needs `federalPolicies` as `{id, version, content_sha256, publication_ref}`.
  - Bank rules stay in `rules`.
  - The contracts endpoint lists `execution_schema_versions`.
- **Case selector:** the template block may carry `caseSelector {field, source, values}`.
  - The source must be a required pick list whose options equal the values exactly.
  - The target is one task per value, so a declared `defaultDistinctTarget` must equal the number of values.
  - No coverage or edge-case quota is allowed. Cases are dataset inputs; the dataset is bound at export only.
- **Outputs:** a reusable form sets `contract.outputsFrom: "template_execution"`.
  - Its answer schema is the template's `execution.output_schema`.
  - It declares no per-task output field or expected answer, because expected answers are private dataset material.
  - A case-selector form must set it.
- **A proposal for an existing workflow** creates the next DRAFT version.
  - The cardinality its template block states (target, coverage, edge cases) replaces what was copied from the latest version.
  - The corrected KYC therefore does not inherit v4/v5's target of 200 and their quotas.
  - Published versions are untouched.
- **Form IDs are never reused.** v4 and v5 keep `golden-kyc-openenv-v2`; the corrected form needs a new ID.

## Marketing Task2 (12 Nov 2026)

Review of the Golden Task2 Marketing handoff v1.1; details in `docs/authoring/MARKETING-TASK2.md`.

- **(owner)** **Rubric scale.** Keep the author's approved 0-4 scale with groups A-G and the B minimum. Praxis adds a
  `zero_to_four` criterion scale with groups beside 5/2/0, and asks Anvil to accept it as an exception to its Q4 answer.
- **(owner)** **Real source data.** FineQuestions and ESCI rows stay in Anvil's fixture archive; Praxis stores only
  dataset, record range, checksum and licence.
- **(owner)** **Route.** DM03 template version 2 with the alternate form `marketing-campaign-task2`, a worked US case
  and an end-to-end test, as for KYC v2.
- **(owner)** **Graph additions.** An `external_system` step (Task3), a `simulated` flag on person steps, and an
  evidence release schedule in the form; the controller's weekly release is the loop back to intake.
- **(chosen by Claude)** A template version's agent mode follows the form it chooses (set when the form is set,
  audited). Without this no template version could be multi-agent.
- **(chosen by Claude)** A form may own its starting workflow (`templateStartingGraph(workflow, version, profileId)`).
- **(chosen by Claude)** The two "several incoming routes" graph warnings on the Task2 workflow stay: both steps are
  reached by exclusive routes. Refining the checker is later work.

## Marketing Task2 as ONE reusable VEYRA Hush One task (13 Nov 2026)

- **Owner and requirement:** "Marketing: the VEYRA Hush One headphone launch template has the five-agent graph and 0–4 rubric, not the old single-agent Phone template." Requirement 49172 section 6; Keystone's four wire decisions.
- **New workflow, "VEYRA Hush One headphone launch"**, with form `veyra-hush-one-launch-v1`.
  - The old "Launch of Noise Cancelling Phone" lineage is left as it is.
  - The form is **not built in.** It reaches Praxis as data in Anvil's template proposal (section 7.2), so an Anvil proposal creates the DRAFT and an Admin publishes it.
- **One reusable task, target 1:**
  - **Removed per-case fields:** case outcome, role and weekly expectations, expected budget handling, findings, rationale, known gaps, evidence release schedule and recorded tool responses. Campaign cases are Anvil dataset inputs.
  - **Outputs:** `contract.outputsFrom: "template_execution"`, plus a required output contract.
  - **Markets:** the five locales are listed as in scope; only qualified ones run (US first).
  - **Budget:** the USD 200,000 is one shared simulated authority, never multiplied per locale.
- **Wire IDs:**
  - The critical failures are `CR-01`…`CR-06`, labelled CR01…CR06 for people.
  - The graph keeps `praxis.workflow_graph.v1-proposed` and the role IDs `orchestrator`, `intent`, `performance`, `brief` and `policy`; Anvil's adapter maps them to its own names.
- **Execution part `anvil.template-execution.v3`** is accepted only with the exact public rubric descriptor:
  - `{scale: zero_to_four, formula: "criterion weight * level / 4", groups A10 B20 C15 D10 E15 F15 G15, minimum {total 80, adaptation 12}, critical_rule_ids CR-01…CR-06}`;
  - a 0–4 template is never checked against the 5/2/0 anchors.
- **Agent mode:** a proposed version's agent mode follows its form.
- **Open-slot tags:** an open slot is asked for coverage tags or an edge case, and a reviewer to confirm them, only when the template has coverage dimensions or edge cases.
- **Invalid proposals:** refused with 422 and audited as `template_proposal.refused`; a repeat with the same Idempotency-Key replays the refusal. Before this fix they returned 500, because the audit guard treated the stored 422 as an unaudited change.

## SME profile chat on Gemini in QA (13 Nov 2026)

- **(owner)** QA has no Claude quota on Vertex, so every SME profile chat answer failed with "I couldn't process that answer just now". The owner chose option 1: let the profile chat run on Gemini, as the suitability assessment already does.
- **Setting:** `PROFILE_MODEL` takes `gemini:<model>`, `claude:<model>` or a Claude id.
  - Empty, it follows a Gemini `AUTHORING_MODEL` (as QA has), otherwise Claude Opus 5 as before.
  - `infra/demo/deploy-demo.sh` sets `gemini:gemini-3.8-flash` explicitly for QA.
- **Same contract for both providers:** the same rules, escaped answer and output schema; output is validated and narrowed to the fields the controller asked for. Any failure is "assistant unavailable", so the candidate keeps "retry or use the form". The model only proposes facts; the candidate confirms each one.

## Anvil-defined templates in the Meta-Compiler: "Defined by Anvil", not "n/6 Valid" (13 Nov 2026)

- **Problem (owner, QA):** KYC v5/v6 and VEYRA Hush One showed "1/6 Valid" with red "to fix" pills (Domain 5, Data 5,
  MCP 1, Guardrails 2, Rubric 1). These are not errors. Those versions have no Harbor blueprint; `blueprintOf()`
  pre-fills only panel 0, so `sectionProblems()` flags every empty stage 1–5 item.
- **Decision (task from the owner's session; chosen by Claude where marked):**
  - A template version with `anvilSpec` set is **defined by Anvil**: its execution, tools, rubric and environment come
    from Anvil's execution part, not from the Harbor blueprint. Publishing and projects already work without it.
  - The template page's stage navigator shows **"Defined by Anvil"** with the execution schema version, a one-line
    rubric summary and the starting graph's role ids, instead of "n/6 Valid" and the per-stage "to fix" pills. The
    stage problems list and the "n/6 valid: fix every stage" Generate hint are hidden; Generate stays disabled (it is
    for Meta-Compiler blueprints).
  - The directory (Admin) shows "Defined by Anvil" on such a row instead of "n/6 valid".
  - **(chosen by Claude)** Data path: `GET /templates/:id/anvil` gains `definition` (`AnvilDefinitionDto`, read-only
    summary from `anvilDefinition()` in `@praxis/shared`); `DirectoryRowDto` gains `definedByAnvil`. Rubric summary:
    a v3 0–4 descriptor reads "0–4 scale, 7 groups, minimum 80; N criteria mapped to evaluators"; otherwise
    "5/2/0 per criterion; N criteria mapped to evaluators".
  - The Meta-Compiler validator (`sectionProblems`, `validSections`, S2-07 / S2-17) is **unchanged** for
    Harbor/Meta-Compiler templates, and the API still returns `problems`/`validSections` for every template.
  - Anvil-owned parts are only read, never edited.

## One slot and one task per case-selector value (13 Nov 2026)

- **(owner)** "Start the fix for one task per state." The first project on KYC v6 got five generic open slots, so two authors could pick the same state and another state would get none.
- **Stored on the template:** a version keeps its `caseSelector` (`{field, source, values}`) in its own column.
  - A proposal or golden pack sets it from its template block; a block without one clears it.
  - A new version made in the UI keeps it (same form). A variant (a new workflow) does not.
  - The migration backfills existing versions from the stored Anvil proposal (`anvil_spec.authoring.template.caseSelector`), which changes nothing else.
- **Slots:** a project on such a version gets exactly one required, non-open slot per value, in the selector's order, whatever the project's target.
  - Each slot carries its value (`coverageTags.case`), and the issued task's `input.slot.case` carries it to the author.
  - Its brief names the value with the form's labels when the form is registered, for example "Governing state: California (CA)".
- **Authoring:** the candidate editor pre-fills the form's selector field (for example `S1.governingState`) from the slot when it is empty.
  - Submission check `case.selector` (section S1) blocks a task whose field differs from its slot's value, or is empty.
  - The slot's value is accepted as a coverage value although it is not a coverage dimension.
- **Projects created before this change:** job `case-selector-slots <projectId> [--apply]` replaces their generic slots with one per value.
  - It is a dry run by default.
  - It refuses once the project has any task, or any slot that is offered or assigned, so no expert's work is touched.
  - It is audited as `project.slots_rebuilt` (actor SYSTEM).

## QA smoke job: `qa-smoke` (14 Nov 2026)

- **(owner)** After several QA P0s that unit tests missed (FK grant on an append-only table, LlamaExtract project ID,
  tokenised quotes, failed jobs holding budget), build an end-to-end smoke test that walks the real journey over the
  public API against real QA infrastructure, run it now and after every QA deploy, and report PASS or FAIL per step.
- **(chosen by Claude)** **Public API only, as named actors.** Unlike `qa-users`, the job never reads the database; every
  id it needs comes from the routes the apps use. The seeded Reviewer `reviewer01@praxis.test` makes every human
  decision (selection, task acceptance); AI output only informs. No route was added; a step that cannot be done through
  existing routes fails and names the gap.
- **(chosen by Claude)** **Steps and dependencies:** `health`, `sign-in`, `project`, `policy`, `staffing`,
  `authoring`, `review`, `export`, `cleanup`. Policy and staffing both need only the project, so one failing still lets
  the other run; authoring needs both. Cleanup runs whenever a project was made. Exit code 0 only when no step failed;
  SKIPPED does not fail the run.
- **(chosen by Claude)** **A fresh SME per run** (`smoke-<UTC timestamp>@praxis.test`). Accepted assignments on
  cancelled projects still count against an SME's concurrent-project limit (2), so one fixed SME would be refused from
  the third run on. Open question for the owner: should cancelling a project close its accepted assignments?
- **(chosen by Claude)** **Policy review:** the PM reviews every extracted rule that has no open problems and excludes
  the others with a recorded reason, because publication needs every draft decided. "Most citations resolved" means at
  least 50% RESOLVED.
- **(chosen by Claude)** **The case the SME saves:** the Golden KYC worked case on the account-opening form; an uploaded
  form's first worked example (Admin route `GET /template-profiles/:id`); otherwise the form's deterministic synthetic
  sample. It cites the rule this run published (key and exact version) and sets the slot's case-selector value.
- **(chosen by Claude)** **Project settings:** chatbot and classic editor (`BOTH`), route SME → PM with the Reviewer
  deciding, one distinct task and one per expert, so a full pass ends with the project COMPLETED (a completed project
  cannot be cancelled; cleanup leaves it). Failed runs cancel their project, pausing it first when in progress.
- **(chosen by Claude)** **Export:** only Praxis's own pre-check. When the deployed export validator is Anvil-gated,
  the step is SKIPPED with that reason, because validating would call Anvil.
- **(chosen by Claude)** **Cost report:** the extraction's cost as the API reports it, and estimates for the calls it
  does not price: suitability $0.01, authoring assistant $0.005, embedding $0.0001. One run is about $0.11.
- **Gap found while building it (in-process run against the real routes):** on KYC v6's per-state form
  `golden-kyc-reusable-v1` the job reaches submit, but the form has no worked example, so the generic sample fails
  `anvil.evaluator-binding` and `profile.S3.environment`. The report says so. Pinning the older account-opening version
  is not possible, because PMs are offered only the newest version of each workflow.
- **(DevOps session for the owner, 14 Nov 2026, after QA run `praxis-qa-smoke-86qrn`)** "Fix the authoring step to
  produce a VALID KYC v6 task … build the synthetic answer from the template itself … don't relax the submit checks."
  - **(chosen by Claude)** No route shows authors the template's evaluator mapping, so the job reads it from the
    workbench pre-check (`POST /me/tasks/:id/check`), as a human author does: `anvil.evaluator-binding` names the
    criterion IDs, then `anvil.evaluator-kinds` names each evaluator and version. No new route and no check relaxed.
  - **(chosen by Claude)** Every pick list takes a value the form allows (the generic sample's S3 environment `none`
    is not on the v6 form). Weights are split evenly to exactly 100; the first criterion is critical; criterion text
    is synthetic.
- **Deploy:** `praxis-qa-smoke` Cloud Run job, deployed but never run by `deploy-demo.sh` (same secrets as
  `praxis-qa-users`, no retries, 1 hour timeout). Runbook: `docs/ops/QA-ENV-SETUP.md` section 7.

## Policy rules page: live extraction progress, rules table and "Apply to project" (14 Nov 2026)

Owner defects "Issue 1" and "Issue 2" on the project Policy rules page. Requirements are in `docs/prd/PRD-POLICY-RULES.md` section 5.6.

- **(owner)** "Since the Project is authored by admin or PM its automatically means reviewed. No need for extra approval." and "No further review required. This screen is done by Admin or PM."
  - Ticking **Apply to project** (PM or Admin) *is* the human review: the rule's current version becomes Reviewed, with the actor recorded and an audit entry (`policy.rule_applied`). There is no separate approval step.
  - The box is ticked exactly when the current version is Reviewed, so no new column is needed.
  - Unticking a Reviewed rule never changes the Reviewed version (it is immutable). A new draft version with the same content is made instead (`policy.rule_unapplied`), and the rule drops out at the next publication.
  - Ticking an Excluded rule makes a new version and applies that one.
- **(owner)** "Read the policy and define the rules that can accepted by the Anvil." The AI drafts each rule's fields (requirement, type, applicability, conditions, exceptions, effective scope, evidence) from the policy text: **Define with AI**. The draft is saved as an ordinary edit (`policy.rule_ai_defined`, model recorded), and the PM can change it before ticking.
- **(owner, guardrail)** The AI only suggests. It never ticks, reviews, excludes or publishes. Prompt suggestions are shown as "Suggested" with a one-line reason, and the PM still ticks each rule.
- **(chosen by Claude)** Rules that are not ticked no longer block publication. The preview lists them as "Not applied", and the published set records them in `excluded` with the reason "Not applied to this project". This is not a silent omission: it follows from the owner's rule that ticking is the review. AC06 still holds, because Draft and Needs-definition versions are never included. Conflicts block only when they involve a ticked rule.
- **(chosen by Claude; the owner did not answer the question)** Evidence quote not found word-for-word in the source: ticking shows a warning, and the PM confirms "I checked the source" (`acceptUnverifiedEvidence`). The audit entry and the published set's content keep the citation's `resolution`. Without a verified locator, the Anvil project-policy manifest points to the whole document version. Without the confirmation the API returns 422 `EVIDENCE_UNVERIFIED`.
- **(chosen by Claude)** Definition gaps (type unknown, no scope, no effective scope): the page runs Define with AI before applying a rule that has gaps. A rule with no requirement text cannot be applied. Any gaps left are recorded in the audit entry as warnings.
- **(chosen by Claude)** Model: `POLICY_AI_MODEL` (`gemini:<model>`, `claude:<model>` or a Claude id). Empty follows a Gemini `AUTHORING_MODEL` (QA, which has no Claude quota), otherwise `claude-sonnet-5-5`. Without `VERTEX_PROJECT_ID` a deterministic mock is used. The cap is `POLICY_AI_DAILY_CALL_CAP` calls per client per day (default 1000), counted from audit entries. Tests use the mock and test doubles, never live calls.
- **(chosen by Claude)** Prompt suggestions are not stored as rule state. Each run is audited (`policy.rule_suggestions_requested`, with the prompt, the document and the suggested rule keys).
- **(chosen by Claude)** Extraction progress: the page polls `GET /policy/extraction` every 3 s while any job is not terminal. It stops when all jobs are terminal and then reloads the rules. It gives up after 35 minutes, since the worker's deadline is 30.
- **(chosen by Claude)** **Apply all suggested** is a button the PM clicks after reading the suggestions. It ticks each suggested rule as that PM, one audited command per rule, and skips any rule whose evidence needs a confirmation. The AI itself still ticks nothing.
- **(owner, via the DevOps session)** A ticked rule that is still incomplete (type unknown, no scope, no effective scope) is applied with a warning but **blocks publication** until it is defined, because Anvil cannot accept it. Unverified quotes warn and need confirmation but do not block. This replaces PRD AC06's separate review step: the tick is the review.

## MVP1 design approved (15 Nov 2026)

- **(owner)** "Ok approved." This covers the MVP1 design in `docs/design/PROJECT-SCREEN-DESIGN.md` and the review page
  (claude.ai artifact "Praxis MVP1 Design", version 7).
- Development follows the no-breakages rule and the build order, starting with step 1: the PM or Admin assigns a
  person to a specific task.
- Before development, the owner tells Anvil (Keystone) to pause integration testing. The message is in the shared
  outputs folder.

## MVP1 build: one PR, built in one run (15 Nov 2026)

- **(owner)** "One PR for everything." Steps 1 to 9 of the MVP1 build order are built on `feat/mvp1-forge` in one continuous run, committed step by step with tests, and opened as one PR.
- Push, merge and deploy each still need the owner's yes. QA runs need the owner's yes in the DevOps session.
## QA fresh start: SME cleanup and matched SME seed (14 Nov 2026)

- **(owner)** "Delete all SME ... First Delete All the users and Purge all the data. Second get 10-15 Profiles which matches the requirement. Then I should be able to directly assign to the Project. and Start authoring the task." Later in the same message: "Also Remove already uploaded documents and Policies. I will start fresh."
- **(owner)** The candidate UI and journey will be rewritten from a spec the owner will give later. Nothing in the candidate app changes here.
- **(chosen by Claude)** "All the users" means SMEs. Console users (Admin, PM, the 10 seeded Reviewers), templates and the audit log are kept.
- **(non-negotiable)** Append-only and immutable rows are never deleted or changed, and triggers are never disabled. An SME with such history is **retired**, not deleted:
  - history that triggers retirement: selection decisions, approved task records, SME-authored tasks, earnings, standings, policy proposals, payouts, certifications, or tasks issued to them;
  - retirement deletes their sign-in identities and sessions, so they cannot sign in and the same email later starts a brand-new account;
  - it deletes their matches, withdraws open applications, cancels proposed or accepted work with no task issued, marks the candidate deleted, and closes and anonymises the account.
  - Matching already skips deleted and closed candidates. Every other SME is hard-deleted with all their rows. Job: `qa-sme-cleanup`.
- **(non-negotiable)** Policy documents, their versions, rules, citations and published rule sets are immutable. "Remove documents and policies" is done by cancelling the projects that hold them with the existing `qa-project-cleanup` job; the owner then creates new projects and uploads policies there.
- **(chosen by Claude)** 12 matched synthetic personas (`apps/api/src/jobs/qa-personas.ts`):
  - 8 KYC personas spread over CA, NY, TX, FL and IL;
  - 4 Marketing personas.
- **(chosen by Claude)** The personas are seeded with `qa-users --matched --project <id>`:
  - only into the projects named, each persona matched to the project's template by track;
  - through the real journey, so a named seeded Reviewer still makes every selection;
  - a template that is neither KYC nor Marketing is refused.
- **(chosen by Claude)** "Directly assign" keeps the PM's Assign click as the decision. `qa-users --accept` then makes the seeded personas accept their proposals through the candidate endpoint, so the PM can sign in as one and author straight away. It never signs up a persona that was not seeded.
- **Run order in QA** (each step needs the owner's direct yes in the DevOps session; dry runs first):
  1. `qa-project-cleanup`, then `--apply`;
  2. `qa-sme-cleanup`, then `--apply` with `QA_SME_CLEANUP_CONFIRM=delete-all-smes`;
  3. the owner creates the new KYC and Marketing projects, uploads policies and publishes each opportunity;
  4. `qa-users --matched --project <kyc> --project <marketing>`;
  5. the owner assigns on the staffing page;
  6. `qa-users --accept`.

## QA reset before the new flow (15 Nov 2026)

- **(owner)** "Delete all the users. We will create it in new flow. Delete all the projects. Only two templates from Anvil. Rest of the templates you can delete it. In Admin keep all the users and password." Also: "If we cannot delete it please archive it."
- **(chosen by Claude)** "Users" means candidate-app people (SMEs and Reviewers). Console users are kept.
- **(non-negotiable)** Rows with locked history are archived, not deleted:
  - projects are cancelled;
  - SMEs are retired (closed, anonymised);
  - templates are retired.
- **(chosen by Claude)** The two templates are named by id (`--keep`). Other versions of the same lineage are left untouched, so published history (KYC v4, v5) stays immutable.
- **Job:** `qa-template-cleanup`.
- **Run order:** projects, then SMEs, then templates. A dry run comes first each time, and each run needs the owner's yes in the DevOps session.
- **(owner, 15 Nov 2026) Standing approvals for the MVP1 build:**
  - push `feat/mvp1-forge` and open the single MVP1 PR;
  - merge it into main once every CI check passes;
  - fold in `feat/qa-sme-reset` (QA reset jobs) and `fix/policy-suggest-timeout`;
  - message the DevOps session to prepare the QA deploy;
  - "gcp deployment".
  - The DevOps session's own rule still asks for the owner's yes in that session for each deploy and QA data run.

## MVP1 step 1: direct assignment (15 Nov 2026)

- **Settings** live in `Client.settings.forge` (`newFlow` default off, `candidateSignIn` default `OFFLINE`), read by
  Admins and PMs at `GET /admin/forge-settings`, changed by Admins only (`PUT`, audited `forge.settings_updated`).
- **(chosen by Claude)** Offline sign-in is refused when `APP_ENV=production` (and for a production build that claims
  `APP_ENV=local`), as the design says. Staging and demo (QA) allow it.
- **(chosen by Claude)** Sourcing works whatever the switch says (it is additive). Direct assignment and change of
  author need the new flow (`409 NEW_FLOW_OFF`).
- **(chosen by Claude)** "New or active projects" for Sourcing: Ready for staffing, Staffing, Staffed, In progress and
  Paused. Draft, Completed and Cancelled are refused (`PROJECT_NOT_OPEN`).
- **(chosen by Claude)** A person is never both SME and Reviewer on one project: the same email assigned in the other
  role is refused (`BOTH_ROLES`) and hidden from the Assign screen.
- **(chosen by Claude)** Task rows (one per coverage slot, CREATED) are made on submit with the new flow on, and lazily
  (audited `project.task_rows_created`) by the project's People and Assign reads and the assign route. The task's
  `input.slot` is built by the same function as `allocateTasks`.
- **(chosen by Claude)** Account for a directly assigned person: an SmeUser already signed in with `mock-<email>`, or
  with that contact email, is reused; otherwise one is created with no sign-in identity (claimed at first sign-in in a
  later step). The SME gets a minimal Candidate (`poolStatus ASSIGNED_DIRECT`) and a ProjectAssignment with no
  proposal; a Reviewer gets no Candidate.
- **(chosen by Claude)** No per-expert cap is applied when the project's `maxPerExpert` is empty. SME places count the
  SMEs currently assigned against `requiredWorkers`; a person who already holds a place can take more tasks.
- **(chosen by Claude)** The first direct author assignment moves a Ready for staffing, Staffing or Staffed project to
  In progress (audited `project.started`, `direct: true`), so Pause and Resume work as today.
- **(chosen by Claude)** Changing the author (only while Assigned and not started): when the old author holds no other
  task on the project, their Sourcing entry and project place are released (audited).
- **(chosen by Claude)** Candidate gate: the new-flow rules apply when the setting is on **and** the SME is assigned by a
  PM or Admin on that project. Then identity, proposal-acceptance, selection and onboarding checks are skipped, pulling
  returns `409 PM_ASSIGNS_TASKS`, `canPull` is false and the studio's first open never allocates. An SME from the
  earlier journey keeps the earlier rules (and can still pull) while the setting is on, so the old journey keeps
  working until the owner retires it.

## MVP1 step 2: task review (15 Nov 2026)

- **Routes.** `GET /projects/:id/forge-tasks` and `GET /projects/:id/forge-tasks/:taskId` (Tasks tab and task page) and
  `POST /projects/:id/tasks/:taskId/decision` (decision box), for Admins and the owning PM. `GET /me/reviews`,
  `GET /me/reviews/:taskId` and `POST /me/reviews/:taskId/decision` for the external Reviewer (candidate app). All need
  the new flow (`409 NEW_FLOW_OFF`); the earlier `/review/...` routes are unchanged.
- **(chosen by Claude)** One engine: the Reviews screen, the Tasks tab and the external Reviewer share the same
  decision code (`decideOneStep` for Author → PM/Admin, `decideStageFor` for Author → Reviewer → PM/Admin), with the
  decider given as a console user or an external Reviewer. Audits keep their action names and add `via: tasks_tab`
  (Tasks tab) or `reviewer: external, smeUserId` (Reviewer).
- **(chosen by Claude)** Checklist: the review checklist keys are generic (realistic, correct, covers the slot, fair
  difficulty, distinct, rubric catches failures), so approving on the Author → PM/Admin route needs all of them true
  (`400 CHECKLIST_INCOMPLETE`), as the Reviews screen does. PM approval on the Reviewer route needs no checklist (as
  today's stage decision), and the external Reviewer's checklist is optional and stored as sent (the design shows only
  per-section comments).
- **(chosen by Claude)** The person who wrote a task (email match) or declared a conflict with its author never decides
  on it from the Tasks tab, Admins included (as the Reviewer route already does). Their row shows "Waiting for PM".
- **(chosen by Claude)** The Tasks-tab decision is bound to the submitted version and its content hash on both routes
  (`expectedVersion`, `expectedRevision`; stale → `409 STALE_STAGE_DECISION` / `STALE_REVISION`); SME → PM decisions made
  here also store the content hash.
- **(chosen by Claude)** The external Reviewer's request also takes `duplicateDecision` and `confirmedCoverage`
  (optional): needed only for a task flagged as a likely duplicate or on an open coverage slot, as the Expert stage
  requires today. Without them such a task could not be passed.
- **(chosen by Claude)** TaskReview has no reviewer kind column: an external Reviewer's decisions carry their SmeUser id
  in `reviewerId`; names are looked up in users, then candidate accounts. The task's console `reviewerId` is set only by
  console users.
- **(chosen by Claude)** Reviewer Home statuses come from the Reviewer's own latest decision: To review (submitted and
  waiting for them), Sent back (they returned it), Approved (they passed it, whatever happened next). Tasks not yet
  submitted and never decided by them are not listed. The Review page shows the latest submitted version, its checks
  and flags (as a Validator sees them), never other authors' content (no similar-task texts).
- **(chosen by Claude)** Task page output: none while Open, the draft read-only while Assigned or In progress, else the
  latest submitted version. "Date" is the latest of created, assigned, started, submitted and decision times.

## MVP1 step 3: candidate app (15 Nov 2026)

- **Routes.** `GET /public/forge-settings` (public: `newFlow`, `candidateSignIn`, for the client sign-in uses),
  `GET`/`POST /me/forge/terms` (Before you start) and `GET /me/forge/home` (Home). Terms routes need the new flow
  (`409 NEW_FLOW_OFF`); Home answers `newFlow: false` with empty lists when it is off.
- **(chosen by Claude)** Account claim. The design makes the email a PM or Admin uploaded in Sourcing the candidate's
  sign-in, so with the new flow on, a first sign-in whose Google email is verified and matches a sourced SME or
  Reviewer in the client links the new sign-in identity to the account made for that person (pre-created in step 1,
  no sign-in identity yet), setting the 18+ time if missing. If no account was made yet, a new one is created and
  every sourced row with that email points at it. An account that already has a sign-in identity is never taken over
  (a second Google account with the same email gets a new, empty account), nor is one when the person's rows point
  at more than one account. Unverified emails never claim. With the new flow off, sign-in never merges by email, as
  before. Audited `candidate.account_claimed` with ids only.
- **(chosen by Claude)** Terms. Acceptance is recorded as Consent rows: `terms:<key>` with the document's sha256 as
  the version (one per current terms document) and `synthetic_data_only` version `1`. Accepting needs the hashes of
  the current versions (`409 TERMS_CHANGED`), is refused for placeholder terms where onboarding refuses them (live
  identity required, or a production build other than demo: `409 TERMS_PLACEHOLDER`) and is idempotent (no second
  set of rows; each call is audited `candidate.terms_accepted`, the repeat with `alreadyAccepted: true`). A newer
  published version must be accepted again.
- **(chosen by Claude)** Directly assigned work (step 1's gate) also needs accepted terms: the gate answers step
  `terms` (`href: /welcome`). The external Reviewer's task page and decision answer `409 TERMS_REQUIRED` until
  accepted; the Reviewer list on Home is not gated.
- **(chosen by Claude)** Home: author tasks are the tasks assigned to the person in projects where they are a directly
  assigned SME (status as `smeTaskStatus`; `reworkComments` counts the latest send-back's comments while in Rework).
  Review tasks are step 2's Reviewer list. Sorted on screen rework first; the next step is rework, then To review,
  then In progress, then New. No tasks at all shows "No tasks for this account yet" with the signed-in email.
- **(chosen by Claude)** Candidate app with the new flow on: the header shows only Home and Sign out (signed out:
  Sign in); sign-in skips the identity step and goes to Before you start until the terms are accepted, then Home; the
  task page returns to Home. A failing settings or session read is treated as the earlier journey and signed out, so
  pages never fail on it. The Online sign-in screen is a later step.
- **(chosen by Claude)** Review comments: the Review page has one comment box per design group of the form's eight
  sections (S1, S2, S3-S4, S5, S6-S8, hyphen as stored). The task page places a comment under every section its key
  covers (a range covers each section in it; an en dash is accepted), highlights those sections, opens on the first
  one, and lists comments naming no section of the form (for example W04 from the console) at the top. The KYC v1
  workbench is unchanged.
- **(chosen by Claude)** The Reviewer's Approve on a task flagged as a likely duplicate needs a tick that it is
  distinct (sent as `ACCEPT_AS_DISTINCT`; send-back sends `REWORK`), and on an open coverage slot a tick confirming
  the task's own coverage tags and edge case, because step 2's API requires them.
## MVP1 step 4: export (15 Nov 2026)

- **(chosen by Claude)** With `newFlow` on for the project's client, a project's tasks are its coverage slots. A slot
  counts as approved when it has a current (not superseded) ApprovedTaskRecord or an ACCEPTED task; a REJECTED task
  does not count. Export opens only when every slot is approved and there is at least one slot; "marked complete", the
  end date and the distinct target no longer open it. Validate still needs one approved task, at any time. Reason text:
  "Export opens when all 5 tasks are approved (1 of 5 now)." ("the task is" for one). With `newFlow` off nothing
  changes. The rule is the pure `exportEligibility` with an optional `allTasks: {totalTasks, approvedTasks}` input.
- **(chosen by Claude)** KYC v7 export: a task whose template has a case selector other than `governing_state` gets
  `case_selector: {field, value}` in its manifest entry. The value is the slot's case value (`input.slot.case.value`),
  or the authored value at `caseSelector.source` when the slot has none. A differing authored value is a package
  problem (`GENERIC_CASE_SELECTOR_MISMATCH`), and no value at all is `GENERIC_CASE_SELECTOR_MISSING`; the task is not
  sent. `coverage: {example_governing_state}` is added when `S1.exampleGoverningState` is a non-empty string, and left
  out otherwise. The new keys change v7 package hashes only.
- **(chosen by Claude)** v6 (state-selector) packages stay byte-identical, behind
  `CASE_SELECTOR_IN_STATE_PACKAGES = false` in `apps/api/src/anvil/generic-package.ts`, until Anvil confirms whether
  v6 should carry `{field: 'governing_state'}` too. A test pins a v6 fixture's package and ZIP hashes to the values the
  code produced before this change. The schema, file names, API paths and identifiers are unchanged.
- **(chosen by Claude)** Export panel: the button is "Export to RL Gym" and validation is "Validate"; the panel shows
  the API's reason while export is closed. The contract §6 text on the Praxis side ("marked complete, or end date")
  describes the old flow only; it was not edited in this step.
## MVP1 step 7: Tutorial and Help (15 Nov 2026)

- **(chosen by Claude)** Tutorial. New nullable `Template.tutorialVideoUrl` and `tutorialChapters` (`[{title, at}]`,
  seconds), migration `20261130000000_template_tutorial` (additive). `PUT /templates/:id/tutorial` (Admin) takes an
  https address of at most 500 characters, or `null` to clear, and up to 20 chapters (title 1-100 characters, `at` 0 or
  more), stored sorted by time; clearing also clears the chapters. It is display metadata, so it creates no template
  version and is set on every version of the workflow (projects keep the version they use, and each sees the same
  video); a new version copies it, a variant (a new workflow) starts without one. Audited `template.tutorial_set` once,
  on the version named, with before/after and the number of versions changed. Template DTOs carry `tutorial`;
  `GET /me/tasks/:id` and `GET /me/reviews/:taskId` carry `tutorial: {videoUrl, chapters} | null`.
- **(chosen by Claude)** Console: the template page has a "Tutorial video" card (address, chapter rows with title and
  mm:ss, Save) for Admins and the current value read-only for PMs. Candidate app: "Tutorial" opens a card with an
  HTML5 video when the address ends in .mp4, .webm or .mov (query and fragment ignored), chapters seek it; any other
  address is a link "Open the tutorial video" (new tab, noopener). The reviewer page also has the Tutorial button, as
  this step's brief asks (the design calls Tutorial "for authors").
- **(chosen by Claude)** Help. `POST /me/tasks/:id/help` (the author's own task, the same access as `GET
  /me/tasks/:id`) and `POST /me/reviews/:taskId/help` (the assigned Reviewer, the same access as `GET
  /me/reviews/:taskId`: new flow on, terms accepted, not their own task) take `{question 1-1000, history ≤ 10}` and
  answer `{answer, scoped: true}`. Help works for any task the caller may open: the author's route with the new flow on
  or off, the Reviewer's only with it on (as the review page). Same Support Bot model and mock as `/me/support/ask`, the
  same per-session limit (20 a minute); the Support Bot has no daily cap, so none is added. Questions are not stored.
- **(chosen by Claude)** The scoped prompt is the SME Support Bot prompt plus task rules: answer only about this task,
  its template's sections and the project's published rules (and how to submit, or for the Reviewer how to send back or
  approve); explain and give a generic example, never write the author's content; for the Reviewer, explain what to
  check and never decide; anything else gets exactly "I can only help with this task and its form. Ask me about a
  section, the rules for this case, or how to submit." Context, as data in the `<record source="this task">` and
  `<template>` tags: the template name and its generated guide, the slot brief, status and coverage tags, each
  section's title and whether it is filled (never the author's answers), the published agent-visible rules in force
  (ids and titles only; the task's snapshot first), and the review comments the person already sees (the author: the
  latest author-facing decision; the Reviewer: their own decisions). No off-topic pre-filter. The local mock answers
  from the help pack, the template guide and the context, and gives the refusal sentence when nothing matches.
- **(chosen by Claude)** On the task page and the review page, Tutorial and Help buttons sit above the page; Help opens
  a right-hand drawer with the scope note, four suggested questions (author or reviewer set), the conversation and an
  Ask box. The general floating Support Bot is removed from the task page (the review page never had it) and stays on
  Home.

## MVP1 step 5: Sourcing and Export to Recruiter (15 Nov 2026)

- **(chosen by Claude)** The recruiter pack is built from the project, never typed in: the role, pay and location from
  the frozen JD snapshot (the live JD before submit); requirements from the JD (mandatory skills, experience,
  education Required; added skills Preferred; a hand-picked JD with no mandatory skills keeps the job post's rule that
  the first skill is Required) and from the demographic profile (the JD's, else the project's filters in plain words);
  the questions from the author job post's question policy (owner-edited or the default, as candidates get them). The
  combined requirements question is shown as "how does their experience meet the requirements in section 2?" so the
  list is not repeated; "Tap all that apply" is dropped and the choices are listed. Evidence text per requirement is a
  fixed phrase per kind ("Role history with dates", "Highest qualification", ...).
- **(chosen by Claude)** The cheat sheet has the eight common sections (S1–S8) in plain words written for recruiters,
  plus the template form's first five field labels and the first field example the form provides, per section.
- **(chosen by Claude)** The pack is the author (SME) pack only. A Reviewer pack for Reviewer-route projects is not in
  the design; it can be added with `?role=REVIEWER` later.
- **(chosen by Claude)** Public names: every free-text value in the pack (project name, JD text, template examples) goes
  through `publicText`, which shows the internal product name as "ADI Forge" and the RL platform as "RL Gym". The PDF
  title, author, creator and producer are "ADI Forge".
- **(chosen by Claude)** Files: the sheet is `candidate-assessment-<project-slug>.xlsx` (slug: the project name with
  each run of other characters replaced by "-", case kept, as in the mockup); the PDF is
  `recruiter-pack-<project-slug>.pdf`. The sheet has a "Candidates" sheet (header row only, frozen, Yes/No drop-downs on
  every "Met?" column for 200 rows) and an "Instructions" sheet. Question headers are "Q1. <question>", cut to 180
  characters so they stay valid assessment keys. The PDF uses the standard Helvetica fonts (no font files), so
  characters outside WinAnsi are replaced; the sheet is embedded as a PDF file attachment.
- **(chosen by Claude)** Import (`POST /sourcing/people/import`): fields `projectId` and `role` come before the file;
  `dryRun` defaults to 0. Row 1 is the header; columns are matched by name (ignoring `*` and "(Gmail)"), so extra or
  reordered columns are fine; a sheet without First name, Last name and Email columns is refused (422 BAD_SHEET), as is
  one with no rows or over 1,000. Each row is checked with the same `SourcedPersonInput` schema and project rules as
  Sourcing → New (shared `sourcingTarget` + `createSourcedPerson`). A row whose email is already on the project for
  that role, or repeats an earlier row, is reported and skipped; other rows still import. Every other non-empty column
  except Agency is kept as the person's assessment `{header: value}`; Agency fills `agency`. The sheet is stored once
  and its key set on every person created from it. Each person gets the usual `sourcing.person_added` audit, plus one
  `sourcing.people_imported` with counts and the file hash (no names or emails). A dry run writes nothing and is not
  audited.
- **(chosen by Claude)** Console: the Sourcing list loads every person the caller may see once and filters in the
  browser (tab, or a search across both roles); the API's `q` search is unchanged. New uploads the profile, then the
  profile PDF and the assessment, and returns to the right tab. "Export to Recruiter" is a button on the project
  summary, shown for every project that is not a draft, cancelled or completed, until the four-tab project page lands.

## MVP1 step 8: console screens (15 Nov 2026)

- **(chosen by Claude)** The switch. Console pages read `newFlow` on the server from `GET /admin/forge-settings`; any
  failure or 403 (Reviewers, Finance) counts as off, and the layout reads it only for Admins and PMs. With it off every
  existing page renders as before (one extra settings read on the project page). No API change in this step.
- **(chosen by Claude)** Project page. With the new flow on, a non-draft project opens on the header and four tabs,
  chosen by `?tab=dashboard|people|tasks|policies` (plain links, default Dashboard). Drafts keep the wizard. The old
  summary's Overview rows are now `projectDetailRows` (same output) and are reused on the Dashboard, with Review route,
  Reviewers and Export to RL Gym inserted before Submitted. Tab counts: SMEs assigned / Required workers, tasks, rules
  in the latest published rule set.
- **(chosen by Claude)** Task labels. Task ID is `TSK-001`... by slot order (the API's list order), computed on screen,
  not stored. Task name is the first sentence of the slot brief (for example "Governing state: California (CA)"),
  since tasks have no other name before the author writes one. "Coverage by <selector>" reads the selector field and
  value from the same brief (case-selector slots: "Application type: Joint (JOINT). ..."; dimension slots: the first
  "label: value"), so v6 shows state and v7 application type without an API change. *(Step 9: the API now sends
  each row's `selector`; the brief is read only when a row has none.)*
- **(chosen by Claude)** Dashboard. Cards: Experts (assigned SMEs / Required workers), Tasks approved / total with the
  number waiting, Rule set (latest published version and its rule count, from `GET /policy/rule-sets`), Rework rate and
  active time (from `GET /dashboard`). Next step, first that applies: a task waiting for your decision (opens it), a task
  waiting for its Reviewer, experts still needed (opens Assign), tasks with no author, all approved (export), tasks in
  rework, else "Authors are working". Reviewers are the people assigned as Reviewer on the project, with an Assign link.
- **(chosen by Claude)** Tasks tab. "Assign SME…" is offered only on Open tasks with no author and lists the SMEs already
  assigned on the project (new people come in through the Assign screen); it calls `POST assignments/direct`. A status
  filter is added, as in the mockup. Changing an author (the API exists) has no control yet. The export area is the
  existing Export panel; its links for tasks that need fixing still open the earlier Task review page (route kept).
  *(Step 9: Change author is on the task page, and in the new flow the fix links open the new task page.)*
- **(chosen by Claude)** Assign screen at `/projects/[id]/assign`: one row per assignable person, a required Task select
  ("To author (SME)"; on the Reviewer route a Reviewer sees "To review (Reviewer)" with only the tasks they may review),
  Assign as SME (replaced by "SME places full" when full) and Assign as Reviewer (Reviewer route only). Matching skills
  shows the skills found in the recruiter's assessment, or "Not assessed yet".
- **(chosen by Claude)** Task page at `/projects/[id]/tasks/[taskId]/review` (the policy page keeps `.../policy`). The
  form is rendered from the template profile, section by section, with arrays of records as tables and unknown shapes
  as JSON; an Open task shows the sections with dashes. Comments are per section (S1 to S8 one by one; add more), and a
  note also counts as the author comment, as the API rules. The checklist shows when the API says it is required; the
  "distinct" confirmation only on Author → PM/Admin for a flagged task (the PM step of the Reviewer route does not need
  it); the coverage confirmation with an editable edge case when the API asks for it. On the Reviewer route the trail's
  Reviewer step offers "Assign reviewer…" (the project's Reviewers, never the author) while the task has an author, no
  Reviewer and is not decided, because the Assign screen hides people already assigned. Validate finds the task's
  approved record in `GET /export` and shows the latest result for it from the last runs.
- **(chosen by Claude)** Admin → Candidate app sign-in at `/admin/candidate-sign-in`: the New flow switch (On/Off) and the
  Offline/Online mode on one page. Admins save; PMs see it read-only. Offline is disabled with an explanation when the
  API says `offlineAllowed: false`. Save sends only what changed, so a stored Offline mode never blocks switching the
  flow where Offline is refused. ~~**Not implemented:** the design says changing the mode signs everyone out of the
  candidate app; the API (`forge/settings.ts`, `PUT /admin/forge-settings`) only audits the change, so the page does not
  claim it. Open for a later step.~~ **Implemented in step 9** (see "MVP1 step 9"): a mode change ends every candidate
  session of the client and the page says so.
- **(chosen by Claude)** Menus. With the new flow on: Home, Projects (Projects, Templates, Approved exports), Sourcing,
  Admin (all existing pages plus Candidate app sign-in) and Tutorials; Reviews, Certification, Partners, Payments and
  Requisitions are hidden from the menu only and their routes still open. Candidate app sign-in shows in Admin for
  Admins with the flow on or off (it is where the flow is switched on), and for PMs only with it on.
- **(chosen by Claude)** With the new flow off, the new Assign and task pages show a short note and a link back instead
  of calling the new-flow APIs (which answer `409 NEW_FLOW_OFF`).

## MVP1 step 6: candidate sign-in modes (15 Nov 2026)

Owner's design: docs/design/PROJECT-SCREEN-DESIGN.md, "Admin: candidate app sign-in mode". Everything below applies
only with `newFlow` on; with it off every sign-in behaves as before (the password routes answer 409 SIGN_IN_MODE, and
Forgot password still answers 202 and sends nothing).

- **(chosen by Claude)** Mode enforcement: Offline keeps `POST /auth/google` (the mock sign-in with email and name);
  `POST /auth/password` and `/auth/password/set` answer 409 SIGN_IN_MODE. Online makes `/auth/google` answer 409
  SIGN_IN_MODE ("Sign in with your email and password."). Production already refuses Offline in the settings; the dev
  token route stays registered only with the mock verifier.
- **(chosen by Claude)** Password sign-in finds the account through a SourcedPerson in this client with that email that
  was assigned at least once and is linked to an account (a released person can still sign in). With several accounts
  for one email, only the single one with a password counts. Every failure (unknown email, no password yet, wrong
  password) is 401 INVALID_CREDENTIALS with one message, verifying against a dummy hash when there is no password.
  An inactive account (403) and a missing 18+ confirmation on the first sign-in (400) are reported only after the
  password matched. Audit `candidate.signed_in_password` holds ids and `firstSignIn` only.
- **(chosen by Claude)** The set link is sent on every direct assignment path (assign as SME or Reviewer, and Change
  author) when the mode is Online, the account has no password and no unused unexpired set link. The email goes to
  the uploaded address inside the same command after the database work, as invites do, so a failed send undoes the
  assignment. Subject "Your ADI Forge account"; the link is `${CANDIDATE_APP_URL}/set-password/<token>`, 72 hours.
- **(chosen by Claude)** `POST /projects/:id/people/:sourcedPersonId/password-link` (Admin, or the PM who owns the
  project): Online only (409 SIGN_IN_MODE otherwise), for a currently assigned person (409 NOT_ASSIGNED); it deletes
  the person's unused set links (no schema change) and emails a new one, also when they already have a password.
  Audit `candidate.password_link_sent` with ids, `replaced` and `expiresAt`.
- **(chosen by Claude)** `POST /auth/password/set` checks the link before the password, so a weak password does not use
  up the link. Rule: at least 12 characters and no email local part (of 3 characters or more) from any address the
  account is known by (shared `candidatePasswordProblem`). Using a link marks every other unused link of that person
  used and signs out all their candidate sessions; it does not sign in.
- **(chosen by Claude)** Forgot password always answers 202 `{ok:true}`. A reset link (1 hour) is created and emailed
  only in Online mode for an email that signs in to an account (same lookup as sign-in, so a sourced but never
  assigned person gets nothing). A failed send is logged without the email and still answers 202. Audit
  `candidate.password_reset_requested` (actor SYSTEM, ids only) only when a link was created.
- **(chosen by Claude)** Candidate app: `/sign-in` picks the form with `signInVariant` (password, offline, classic). The
  Offline form is the existing simulated one, labelled "Offline sign-in (test environment): no password". New pages
  `/set-password/[token]` (no referrer sent) and `/forgot-password`.

## MVP1 step 9: QA smoke and finishing (15 Nov 2026)

- **(chosen by Claude)** QA smoke, new-flow pass. The job is parameterised by environment, so the pass is
  `QA_SMOKE_NEW_FLOW=auto|on|off` (default `auto`: run only when `GET /admin/forge-settings` says the client's new flow
  is on; a 403 or 404 there counts as not available). It runs after the earlier journey's steps, which are unchanged,
  as its own steps (`forge-settings` ... `forge-cleanup`, reported under `forge` in the same JSON line, counted in `ok`
  and the exit code). It never changes the client's settings, so it cannot switch the flow or the mode for others.
- **(chosen by Claude)** It needs Offline candidate sign-in (QA): Online would need the set-password email, which the
  job cannot read. Online is a FAIL of `forge-settings` with the reason, before anything is created.
- **(chosen by Claude)** Its project is `SYNTHETIC QA smoke (new flow) — <UTC date time to the second>` (project names
  are unique per client; seconds keep re-runs apart), on the same template as the earlier journey (or the same
  choice: newest published version, or `QA_SMOKE_TEMPLATE_ID`), review route `QA_SMOKE_FORGE_ROUTE` (default
  Author → Reviewer → PM/Admin, so the Reviewer path is covered; `SME_PM` covers the other). One SME authors every task:
  the per-expert cap cannot exceed the target and the template API does not expose the case selector, so the job
  first makes a one-task project; when the template makes more tasks than that (KYC v6: five states) it cancels it at
  once and makes the real project sized to that count (named `... (5 tasks)`).
- **(chosen by Claude)** Policy without extraction: the same synthetic policy is uploaded and the PM writes one rule
  that quotes it (`POST /policy/rules`), reviews it and publishes the rule set, so tasks can cite a published rule and
  the pass makes no extraction call. The earlier journey still covers live extraction.
- **(chosen by Claude)** People: a synthetic SME and Reviewer per run (`smoke-forge-sme-<timestamp>@praxis.test`,
  `smoke-forge-rev-<timestamp>@praxis.test`, first name SYNTHETIC, agency `SYNTHETIC QA smoke`), uploaded through
  Sourcing → New and assigned to every task. They sign in with the mock Google (Offline) sign-in, accept the current
  terms (missing terms: FAIL "must be published before anyone signs in"), and Home must list every task as New, then
  In review after submit, Accepted after approval. Authoring uses the earlier journey's synthetic case builder and
  pre-check binding, with no assistant call (one embedding per submit is counted).
- **(chosen by Claude)** Decisions are people's: the Reviewer passes each task (checklist, duplicate and coverage
  confirmations only when the API asks), the PM approves each. Before each approval the job checks export is still
  closed with "n of N now", and after the last that it is open and lists every task. It never calls export or
  validate, so it never reaches RL Gym. Cleanup signs the two candidates out (`POST /me/logout`) and cancels the
  project unless it completed; append-only records stay, as in the earlier journey.
- **Found while testing, not changed:** a second earlier-journey run in the same database submits the same golden case
  again, so its review is refused with `DUPLICATE_DECISION_REQUIRED` (the earlier journey's review step sends no
  duplicate decision). This is the earlier journey's behaviour and is left as it is; the new-flow pass sends the
  duplicate decision when the API flags a task.
- **(chosen by Claude)** Task selector. `ForgeTaskRow.selector` is `{field, value, label} | null`, from the task's slot:
  a case-selector slot gives the form field's label and the option's label ("Governing state", "CA",
  "California (CA)"), a dimension slot its first tag in dimension order with the dimension label, an edge-case slot
  "Edge case", an open slot `{field: '', value: '', label: 'Open slot'}`, no slot null. The field is optional in the
  type so a console reading an older API falls back to the brief parser.
- **(chosen by Claude)** Sign-out on mode change. When `PUT /admin/forge-settings` changes `candidateSignIn`, every
  open candidate-app session of the client is revoked in the same transaction (SMEs and Reviewers; other clients and
  console sessions untouched), audited `candidate.sessions_ended` with `{reason: 'sign_in_mode_changed', count}` only.
  The response adds `candidateSessionsEnded`. Switching only `newFlow`, or saving the same mode, signs nobody out; a
  replay with the same Idempotency-Key does nothing more.
- **(chosen by Claude)** Change author. The control is on the task page for Assigned, In progress and Rework tasks
  with an author (as asked), but the design and the API allow a change only before the author starts, so it is
  enabled only for Assigned and shown disabled with "The author can be changed only before they start the task." for
  the other two (the API would answer `AUTHOR_STARTED`). It lists the project's other SMEs (never the author or a
  Reviewer), asks to confirm, then calls `POST /projects/:id/tasks/:taskId/author`; errors show inline.
- **(chosen by Claude)** With the new flow on, the export panel's "needs fixing" links open
  `/projects/[id]/tasks/[taskId]/review` (the Tasks tab's panel is new flow only); the project summary's panel, used with
  the flow off, keeps `/review/tasks/:id`. The recruiter page's back link goes to `/projects/[id]?tab=people` with the
  flow on, else to the project.
- **Runbook:** `docs/design/MVP1-RUNBOOK.md` (switching the flow, Offline and Online, Terms first, the PM/Admin order,
  the QA smoke command).
- **(chosen by Claude)** CI fixes for PR #73. `GET /me/tasks/:id/conversation` now reads the task and its latest run in
  one REPEATABLE READ transaction. Read separately, a run that finished between the two reads came back as done without
  its proposal, so the chatbot stopped polling and never showed Confirm changes (the intermittent conversation-browser
  failure; the route is unchanged from main, so main had the same race). The template page's tutorial button is now
  "Save tutorial": step 7 put a second "Save" on the page beside the Meta-Compiler's Save. The e2e smoke tests expect
  the public names (ADI Forge, RL Gym).

## MVP1 deploy: e2e failures on main 952f17d5 (15 Nov 2026)

- **(chosen by Claude)** The nightly QA deploy stopped on 4 e2e failures (run 43711501765). None was a change in app
  behaviour; all were `next dev` compiling a route on its first request while a test waited. The traces show it: the
  Meta-Compiler page `/templates/[id]` took 12.7 s to compile for one worker, and the other worker's pay-run Approve
  call, proxied through the same dev server at that moment, never returned (m10 pay run); `/projects/new` (4.7 s, smoke),
  `/review/tasks/[id]` (4.5 s, journey) and the factory-blueprint read (journey Reset) used up their 5 s expectations.
  MVP1 made these pages larger, so the first compiles got slower; the PR #73 run was lucky on timing.
- **Fix:** an e2e global set-up (`e2e/warm-up.ts`) requests every page of the console and the candidate app once, after
  the servers start and before any test, so tests never wait on a first compile. It finds the pages from the app
  folders (no list to maintain), never fails the run, and is skipped against a deployed environment. No test assertion
  or timeout was changed, and no app code.
- **(chosen by Claude)** The m10 pay-run test now cancels, through the Finance API, a run an earlier attempt left part-way
  for its week, then builds the week again. Before, a retry found the first attempt's confirmed run and failed on "Finance
  cannot approve before a PM confirms" for that reason alone, hiding the real first failure.
- **Owner, 15 Nov 2026:** "On the new flow." and "Again the old flow is irrelevant". Each failing test was judged against
  the MVP1 new flow. None asserts old-flow behaviour that MVP1 changed. The smoke test accepts the Admin landing on Home
  ("Welcome, …"): it never checks the landing page, and goes on through the Projects menu and New project. It failed
  only because both pages were still compiling (4.6 s and 4.7 s) when its 5 s check ran. All three failures that were
  retried passed on retry with unchanged code, so no test was rewritten.
- **(chosen by Claude)** The PR's first CI run showed the warm-up working (every page compiled in 169 s before the
  tests), but three tests still needed a retry, for test-timing reasons the compile had been hiding. (1) Smoke: MVP1
  Home has its own "New project" link, so after clicking Projects the test found Home's link and clicked it while the
  Projects navigation was still in flight. The test now waits for `/projects`, then for `/projects/new`, as the new-flow
  design intends (Home first, Projects through the menu). (2) Journey: the Reviewer's click on a queued task now waits
  for the review page's URL before looking for the title. (3) The m10 partner sign-in now waits for the form to hydrate,
  as the other two partner sign-ins and `staffLogin` already did; it was submitted before hydration and stayed on the
  sign-in page. The candidate mock sign-in in `smoke.spec.ts` gets the same hydration wait (it failed once on PR #76's
  run with the same symptom). No assertion was removed or relaxed.

  sign-in page. No assertion was removed or relaxed.


## KYC v7 and generic case selector (15 Nov 2026)

- **(owner)** A new template or version is data, not code. KYC v7 (application type) arrived as an RL Gym template
  proposal: `caseSelector {field: product, source: S1.applicationType, values: individual, adult_joint, teen_joint,
  custodial}`, no coverage, target 4, form `golden-kyc-application-type-v1` v3. It is supported with no
  template-specific code; a made-up `risk_tier` template (three values) is tested the same way.
- **(chosen by Claude)** Intake. `caseSelector` gains optional `labels` (value → display label); every key must be a
  selector value. Selector problems (shape or unknown keys, a source that is not a required pick list of the form,
  empty, duplicate or unmatched values, labels for unknown values, a target that is not one per value, coverage or
  edge-case quotas, outputs not from template execution) now carry the code `TP_CASE_SELECTOR_UNSUPPORTED` (was
  `TP_FORM_INVALID`) with a fix text; the code is listed in the contracts. The proposal is refused whole and creates
  nothing. Field types and form IDs keep `TP_FIELD_TYPE_UNSUPPORTED` and `TP_FORM_ID_TAKEN`. The earlier
  `praxis.template_spec.v1-proposed` format is unchanged.
- **(chosen by Claude)** Slots. The existing one-slot-per-value path is the generic path (v6 already used it). Each
  slot's `case` now also stores `label`: the template's label, else the form option's, else the value. The field name
  shown is the form field's label, else the field humanised (`risk_tier` → "Risk tier"). A value is shown with its code
  in brackets only when the value is a short upper-case code ("California (CA)"); otherwise the label alone ("Joint",
  never "Joint (adult_joint)"). So v6 briefs and Tasks-list labels are unchanged, and v7 shows Single, Joint, Minor
  (joint with adult), Custodian. The v7 brief reads "Application type: Joint. Write this reusable task for Joint only;
  set Application type to Joint." Task count and required workers follow the values count as for v6 (the template's
  `defaultDistinctTarget` is the values count).
- **(chosen by Claude)** Authoring. The author form shows the selector field read-only with the slot's label and "Set by
  this task. It cannot be changed."; the editor always writes the slot's value. The API refuses a save (`PUT
  /me/tasks/:id`) or an expert edit that puts another value there (`422 CASE_SELECTOR_LOCKED`, "This task is for
  Custodian. That choice is set by the task and cannot be changed."); an empty field may be saved. An accepted
  assistant proposal never changes it (the slot value is written back). The submission check `case.selector` is
  unchanged. This applies to v6 too: a v6 author can no longer pick another state in a draft (the submission check
  already refused it).
- **(chosen by Claude)** Console. `ForgeTaskRow.selector.label` uses the stored slot label, else the template's
  labels, else the form's option label. The Dashboard reads "Coverage by application type" for v7; no web code
  changed.
- **(chosen by Claude)** Export. As built in MVP1 step 4, plus: a value that is not one of the template's values is
  `GENERIC_CASE_SELECTOR_UNKNOWN`, and a slot made for another selector field is `GENERIC_CASE_SELECTOR_MISMATCH`. When
  any task of a selector template has a selector problem, none of that template version's tasks is sent (the others
  get `GENERIC_CASE_SELECTOR_BATCH_BLOCKED` with the reason), so an export never silently lacks a value. v6 packages
  stay byte-identical (`CASE_SELECTOR_IN_STATE_PACKAGES = false`; the golden hash test is unchanged). The v6 exception
  is keyed on the field name `governing_state`, so a future template that selects by `governing_state` also gets no
  `case_selector` until RL Gym confirms v6 should carry it.
- **(chosen by Claude)** Public names: export problem messages said "Anvil" and "Praxis"; they now say RL Gym and ADI
  Forge, and `generic-package.ts` and `tasks/definitions.ts` are on the public-names guard list.
- **What v7 declares that Authoring does not act on:** `contractStatus: requires_confirmation` is shown on the author
  form as "field contract awaiting domain-owner confirmation" (as for v6) and does not block projects.
  `exportCapabilities {executable: false, blockers: [...]}` is stored with the form and read by nothing: whether RL Gym
  takes the tasks is decided by RL Gym's own validation at export. `S1.exampleGoverningState` is exported as
  `coverage.example_governing_state` only, by its fixed key, as agreed for v7.

## QA seed projects job: `qa-seed-projects` (15 Nov 2026)

- **(owner, via the DevOps session)** The RL Gym team asked for two seeded synthetic projects for Authoring QA in the
  MVP1 new flow on KYC v6: "SYNTHETIC QA lifecycle — KYC v6" (tasks New, In progress and Submitted) and "SYNTHETIC QA
  all-approved export — KYC v6" (every task Submitted). Approvals happen only by the owner in the console, never by
  script. Review route Author → PM/Admin. Synthetic people through Sourcing and Offline sign-in; dry run by default,
  `--apply` with `QA_SEED_PROJECTS_CONFIRM=create-synthetic-projects`; never production.
- **(chosen by Claude)** **Reuse the smoke job's new-flow code.** The API session (named actors, rate-limit waits,
  secret redaction), project creation, the hand-written rule, Offline sign-in with terms, and authoring are now exported
  helpers in `qa-smoke.ts` (`apiSession`, `createForgeProject`, `publishSyntheticRule`, `forgeCandidateSignIn`,
  `draftTask`, `submitTask`, `authorAndSubmit`, `cancelForgeProject`); `qa-smoke` uses the same helpers unchanged in
  behaviour.
- **(chosen by Claude)** **One synthetic SME per task**, with a fixed email per project and slot
  (`qa-seed-<project>-sme-<n>@praxis.test`), so each task has its own author and a re-run finds the same people. A
  project's SME places are target ÷ per-expert cap, and a case-selector template makes one task per value whatever the
  target, so the job reads the draft project's task rows and sets the target to their number (per-expert cap 1) before
  it submits. No probe project is made or cancelled.
- **(chosen by Claude)** **The all-approved project has five tasks, not 2–3.** KYC v6 makes exactly one task per
  governing state (five), whatever the project's target (13 Nov 2026 rule), so the requested 2–3 is not possible on this
  template. On a template without a case selector the job would use a target of 2.
- **(chosen by Claude)** **Lifecycle states by slot order:** tasks 1–2 Submitted, task 3 In progress (draft saved with
  the synthetic case, no pre-check, no submit), the rest New. The owner approves one of the two Submitted tasks.
- **(chosen by Claude)** **Tasks cite the rule through the rule set.** The KYC v6 form has no policy-citation field
  (its contract has no `policies`), so the case body cannot name the rule; each project's published rule set (one
  reviewed rule `R-NW-2.1` quoting the synthetic policy) is every task's policy (`GET /tasks/:id/policy`). No
  extraction, so no LlamaExtract cost.
- **(chosen by Claude)** **Idempotent by name, forward only.** A re-run finds each project by its exact name, reuses its
  rule (publishing the rule set only if missing) and its sourced people, and moves a task only forward
  (New → In progress → Submitted), never past Submitted and never back; a task the owner decided (Accepted, Rework,
  Rejected) or that someone else authors is left as it is and noted. A same-named project that is cancelled, completed,
  on another template or on another review route is an error, never duplicated.
- **(chosen by Claude)** **Report without names or emails.** Per task: task ID, slot label, state, SME status, target
  state, the author's Sourcing person ID, and for Submitted tasks the console approval link
  `/projects/<projectId>/tasks/<taskId>/review`. Paid calls are embeddings only (about $0.0003 per submitted task).

## Approved terms as seed data; menu clean-up (15 Nov 2026)

- **(owner)** The three terms the owner published in QA on 15 Nov 2026 (`contributor`, `confidentiality_ip`,
  `data_use`, v1) are seed data in `apps/api/prisma/seed-data/terms/<key>.json`, byte-exact from the QA export
  (sha256 e0fd5432…, 1b3ad22a…, 8bc7857a…). The `seed` job publishes them on a fresh database instead of placeholders.
- **(chosen by Claude)** Create-only, like an Admin publishing: a key with no document gets version 1; a placeholder
  gets the approved text as the next version; an approved version (including any later Admin edit) is never
  overwritten. A key without a file falls back to the placeholder. `SEED_TERMS_DIR=none` seeds placeholders only, which
  the tests that exercise placeholder behaviour use.
- **(chosen by Claude)** The text is kept exactly as published, including two unfilled brackets ("[contact email]" in
  Contributor terms, "[retention period]" in Data use). Fixing them is the owner's call: publish a new version in
  Admin → Terms and update the seed files.
- **(owner)** Certification, Partners and Payments are hidden from the console menu whatever the new-flow setting;
  the routes stay.

## Rubric recommendations in Authoring: plan (15 Nov 2026)

Plan: `docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md`. Owner spec: `docs/prd/PRD-RUBRIC-RECOMMENDATIONS.md`. **Awaiting the
owner's approval; no code yet.**

- **(chosen by Claude)** Everything sits behind `RUBRIC_RECOMMENDATIONS_ENABLED` (default false), including D8 seeding.
  Model wording sits behind `RUBRIC_AI_ENABLED` (default false). With the defaults, nothing changes in QA and no paid
  call is possible.
- **(chosen by Claude)** Derivation is deterministic, from the selected template version's own field definitions
  (contract pointers, field types, workflow graph, output schema, then a labelled heuristic), never from section
  numbers. Unclassified fields are listed under "Sources not used". The AI only writes wording, labelled; it never
  sets IDs, scoring, applicability or sources.
- **(chosen by Claude)** Derivation metadata, source links (with snapshot hashes) and runs go in new append-only tables
  (`RubricRecommendationRun`, `RubricCriterionAnnotation`), never in `TaskInstance.output`. That's what keeps the
  RL Gym package and `ApprovedTaskRecord.contentHash` byte-identical. Restore uses the existing `TaskSubmission`
  history.
- **(chosen by Claude)** On a template with an evaluator map (KYC v6/v7), a new criterion stays **internal only**,
  labelled "not sent to RL Gym", until a contract change is agreed.
- **(chosen by Claude)** Coverage gaps, unresolved items and duplicate weighting are warnings in S7 and the pre-check.
  They aren't new blockers, and there's no new approval stage.
- **(chosen by Claude)** D8 "template default, SME edits" is the base layer: S7 is seeded from the evaluator map's IDs
  (read-only). Defaults come from an optional `criterionDefaults` key on the criterion field definition (template data,
  validated against the field's scale). Old template versions are unchanged. Fallback: IDs, a name derived from the ID
  (labelled) and blank anchors.
- **(chosen by Claude)** Weights and thresholds come only from structured template data. v7's "weight 5 each" is help
  prose, so it's shown as a linked note and not applied.
- **(chosen by Claude)** The policy rule annotations from PR #81 (mandatory marking, applies-when, responsible actor)
  are used through an interface when present. Without them the fallback is `PolicyRule.required`, and applicability is
  UNKNOWN where the rule body doesn't say. No hard dependency.
- **(owner, D9)** The technical criterion fields get a source instead of free typing. Evaluator kind and version are
  auto-filled, read-only, from `execution.evaluators[]`: kind is `capability.id`, which is what the existing submit
  check requires (the old help text's "e.g. run_evidence" was wrong). Evidence or rule links are a picker of the task's
  rules, step IDs and evidence IDs. Output field, Comparison and Expected value are shown only for evaluators that
  compare the output; Output field is then a picker from the output schema. Help text says "RL Gym".
- **(chosen by Claude)** D9 keeps values already saved: an unknown link or a value on a hidden field is flagged, never
  stripped, so stored and exported bytes don't change. It sits behind the same flag.

## Simplified rubric editor combined with rubric recommendations, D8 and D9 (15 Nov 2026)

Owner spec: `docs/prd/PRD-SIMPLIFIED-RUBRIC-EDITOR.md`. It's combined into `docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md`
(sections 2, 14 and 15). Mockup for approval: `docs/design/mockups/rubric-editor.html`. **Awaiting the owner's approval of
the mockup and the plan; no feature code yet.** Where the specs conflict, the simplified-editor spec wins on what the
author sees, and the recommendations spec wins on derivation and storage.

- **(chosen by Claude) Field list:** the editor shows the owner's 9 fields in order. Step/role and skill appear in the
  "Derived from" chain, exceptions in the Change dialog, "why suggested" under the links, and unresolved items in
  the to-finish list. No extra top-level fields.
- **(chosen by Claude) Whole-task failure:** only what the template supports is offered. For KYC v6/v7 that's "a Fail
  (0) on this criterion fails the whole task" (S7 scoring rule). "Partial triggers it" isn't offered. A behaviour the
  Fail doesn't cover is kept as a note and flagged "Evaluation setup needed". Only the existing `critical` flag is
  exported.
- **(chosen by Claude) Criterion name:** the ID is read-only. The name is editable (as today) with "Reset to template"
  and an "Edited from template" marker. This replaces D8's read-only name, following the later spec.
- **(chosen by Claude) Applicability:** the editor's four kinds (required throughout, required when, permitted option,
  human officer or other role), plus UNKNOWN for derived requirements. The template's own Not applicable, Unknown and
  missing-evidence treatment is unchanged in the export.
- **(chosen by Claude) One link control:** "Derived from" replaces D9's separate "Evidence or rule links" picker.
  Confirmed links of exportable kinds (rule keys, step IDs, evidence IDs) fill the existing `evidenceRefs`; unconfirmed
  suggestions don't. `evidenceRefs` is shown read-only under Technical settings. Saved values are kept.
- **(chosen by Claude) Technical settings:** collapsed and read-only in "Technical grading settings · From template",
  with "Not used" rather than hidden (D9 said hidden). Filled only from the exact template mapping. With no mapping:
  "Evaluation setup needed". "How it will be checked" never says "Ready".
- **(chosen by Claude) Weights:** shown read-only from structured template data only (D8 `criterionDefaults`, groups,
  `weightTotal`). The mockup assumes a v7 version with D8 defaults (weight 5). Plan option B stays the owner's choice
  for today's v7.
- **(chosen by Claude) Suggested additions:** shown separately and labelled AI suggestion / Internal only / Evaluation
  setup needed. They never enter `S7.criteria` on a fixed evaluator map.
- **(chosen by Claude) Mockup data:** the Custodian task on KYC v7, with real criterion IDs, scale, tools and S5 steps.
  Anchor text is from the QA cheat sheet and is shown as D8 template defaults. Policy rule numbers and passages are
  illustrative and labelled as such.

## Rubric editor "make it simple": task-level sources as checkboxes (15 Nov 2026)

Owner direction, relayed by the DevOps session. The S7 criterion's lower block (Critical, Evidence or rule links,
Evaluator kind and version, Output field, Comparison, Expected value) is replaced, for the SME, by one task-level list:
"Sources used for this task", made of real checkboxes. See plan section 16 and the mockup.

- **(owner)** The sources are checkboxes. The policy documents and versions selected in S4 and the template
  references start ticked. The SME can untick a source. "Add another source" adds a ticked row chosen by readable
  name. No typed IDs.
- **(chosen by Claude)** "Derived from" stays on each criterion as small automatic, read-only chips. They're built
  only from ticked sources and the task's own sections. The SME doesn't confirm or remove them, which replaces the
  earlier per-link ✓/✕. "Source link needed" sends the SME to "Add another source".
- **(chosen by Claude)** "Critical" is replaced by the editor's Whole-task failure field (same exported flag), not
  removed: the simplified-editor spec requires it.
- **(chosen by Claude)** The editor no longer writes `evidenceRefs`; values saved earlier are kept. This supersedes
  the decision that confirmed links fill `evidenceRefs`, and keeps exported content unchanged.
- **(chosen by Claude)** S8 "Sources used" on v7 shows the same list. When the field is empty it's filled with one
  readable line per ticked source. Existing text is never overwritten. The field is found from its definition, not
  its section number.
- **(chosen by Claude)** The source list is internal (`RubricTaskSources`, append-only, audited) and isn't exported.

## One mockup for the whole SME task form (15 Nov 2026)

`docs/design/mockups/rubric-editor.html` is renamed `docs/design/mockups/sme-task-form.html` and now covers the whole
KYC v7 SME task form (plan section 17). It's awaiting the owner's approval; no feature code yet.

- **(chosen by Claude)** In S4 the SME picks **documents, not individual rules**. Each picked document brings its
  applied rules. This matches the S4 item shape: Policy ID, Version, Publication reference and SHA-256 are
  document-level. Rules show read-only under "Show rules", with the PR #81 marking.
- **(chosen by Claude)** The S4 picker shows only published documents and their applied rules. Draft, unapplied and
  extraction-state rules are never shown to the SME.
- **(chosen by Claude)** S4, "Sources used for this task" (S7) and S8 "Sources" are linked. Picking a policy in S4
  adds a ticked source, and S8 shows the ticked list. There's one list, not three.
- **(owner, D3)** The declaration text is exactly "I won't use real customer, employer or account information." The
  rule is unchanged.
- **(chosen by Claude)** The S4 picker design is shared with the policy-annotations session (PR #81) through the
  side-session notes, using its six marking labels and chip colours, so both mockups match.
- **(agreed with the PR #81 session)** The S4 picker and the Policies-page mockup match: the six marking labels; chip
  colours (Mandatory teal; when applicable and permitted blue; needs clarification amber; required reference and
  other grey); rows with a jurisdiction chip, "N rules applied" and "Show rules".
- **(chosen by Claude, to confirm with RL Gym)** S4's read-only Policy ID, Version, Publication reference and SHA-256
  come from the project policy manifest identities (PR #81: document id, `rs<set>.d<doc>`, "project rule set vN",
  `sha256`), not from the GB-01…GB-07 identities RL Gym supplied with v7. This gives one source of truth. RL Gym
  confirms which identities its v7 grader expects before S4 ships. The mockup's GB-style values are example data.

## Rubric editor and recommendations: build (15 Nov 2026)

The owner approved the SME task-form mockup and the combined plan. This is built on branch
`claude/rubric-recommendations`, behind `RUBRIC_RECOMMENDATIONS_ENABLED` (off) and `RUBRIC_AI_ENABLED` (off).

- **(chosen by Claude)** The first visit to S7 runs a rules-only derivation (no model) so that every link has a
  snapshot. "Refresh suggestions" reruns it. The same inputs reuse the earlier run, and the reuse is audited.
- **(chosen by Claude)** S8 "Sources": the field shows the ticked list read-only, with a one-click "Fill the field
  below from this list" when the field is empty. It is not filled automatically: that text is agent-visible, so the
  author does it with one click. Existing text is never overwritten. This refines the earlier "filled when empty".
- **(chosen by Claude)** Policy rule annotations (PR #81) are read through `RuleAnnotationSource`. Until PR #81 is
  merged, that returns none: rules show without a marking, and applicability falls back to "Required throughout" when
  a workflow step supports it, else "Undefined". Wiring PR #81's table in is a one-function change, done after it merges.
- **(chosen by Claude)** Matching criteria to sources is deterministic: shared word stems with light suffix stripping,
  at most two links per role and five in all. On KYC v7, which has no default text, some criteria get few links and
  show "Source link needed". That is deliberate: nothing is invented.
- **(chosen by Claude)** D8 and D6 submit checks (`rubric.template-criteria`, `policy.library-reference`) and the D9
  evaluator normalisation on save run only with the flag on. With it off, saving and submitting are exactly as before.
- **(chosen by Claude)** The Criterion item's "Critical" flag is labelled "Whole-task failure" in our help text. The
  key and its meaning are unchanged.
- **(owner, D3)** Before you start and the submit panel use exactly "I won't use real customer, employer or account
  information." with the flag on. The `syntheticOnly` / `syntheticDeclaration` API fields are unchanged.
- **(chosen by Claude)** D5 for template text: with the flag on, template help is shown through `publicText()`
  ("Anvil" becomes "RL Gym", "Praxis" and "ADI-Labs" become "ADI Forge"). The stored template is unchanged, so its
  hashes are too. The arrival check for new templates (D5 part 1) is not part of this work.
## Policy rule classification, mandatory marking and annotations (15 Nov 2026)

Spec: `docs/prd/PRD-POLICY-RULE-ANNOTATIONS.md` (owner, verbatim). Plan: `docs/plan/PLAN-POLICY-RULE-ANNOTATIONS.md`.

- **(owner)** The plan was approved as proposed:
  - An additive `praxis.anvil.project_policy_annotations.v1` document. The v1 manifest is unchanged, and the new
    document stays "proposed" until RL Gym agrees in writing; the owner sends
    `docs/anvil/RL-GYM-POLICY-ANNOTATIONS-CHANGE-NOTE.md`.
  - An automatic AI annotation pass after every extraction, plus a "Suggest annotations with AI" button.
  - A1: "Apply to project" means "include this rule version, with its annotation, in the published set", not
    "mandatory".
  - A5: an applied rule classified Unresolved may publish only when it is marked Needs clarification. Any other
    applied rule with an unknown type still blocks as "incomplete".
- **(owner, defaults in plan §9)**
  - Editors are exported as an opaque user ID plus role.
  - `severity` stays `high` in v1.
  - The new preview checks warn and never block.
  - The RL Gym review is used as test data only.
  - D6 is out of scope.
- **(chosen by Claude)** **Annotation stored in the rule body.** It is the optional `PolicyRuleBody.annotation`, never
  defaulted, so existing content hashes and published digests are unchanged. Editing it goes through `editRule`, so an
  applied rule gets a new draft version that must be ticked again. The append-only `PolicyRuleAnnotationRevision`
  table (trigger) keeps every AI suggestion and author edit, with annotation version, role and time. Omitting the
  annotation on a save keeps it, so older clients never drop one.
- **(chosen by Claude)** **Classification and requirement type.** `classification` is the source of truth. The old
  `requirementType` follows it (applicability_precedence → definition, unresolved → unknown), and the editor hides the
  type selector on annotated rules.
- **(chosen by Claude)** **Links are declared on one rule.** The reverse direction is computed when the rules are read
  (`linkedFrom`, export `linked_from`). The plan said both sides would be kept in sync on save, but writing the
  reverse link into the other rule would un-apply that rule as a side effect. The prompt asks the model for both
  directions (threshold definitions and the rules that use them). The preview also flags an applied rule whose
  threshold definition is not applied.
- **(chosen by Claude)** **When an AI suggestion is used.** It is adopted only on a Draft or Needs definition version
  whose annotation is absent or an unedited AI suggestion. Otherwise it is stored as "offered" (`adopted: false`) and
  shown as "Use AI suggestion". An applied rule is never changed by AI.
  - A compound statement that is not found word for word in the document is dropped.
  - Links to unknown rule keys are dropped.
  - A run is idempotent per run ID and counts toward `POLICY_AI_DAILY_CALL_CAP` as one assistant run. Over the cap it
    is skipped and audited.
- **(chosen by Claude)** **Define with AI on an unannotated rule** queues the same annotation pass for that one rule
  (worker). The plan said Define would return the annotation in its own call; queueing it reuses one prompt and one
  validation path.
- **(chosen by Claude)** **Export provenance is derived, not frozen.**
  - The AI suggestion shown is the current revision when it is unedited; otherwise it is the newest AI revision before
    the author's edit.
  - The approval is the reviewed version's `reviewedById`/`reviewedAt`.
  - Both read immutable rows, so the same published state gives the same bytes. Rule-set content is unchanged.
- **(chosen by Claude)** **Applicability filter.** "Show rules for application type / governing state" on the Rules page
  uses `ruleApplicability` from `packages/shared`. Out-of-scope rules are hidden and unknown stays visible. The model
  is given the template's case-selector values (KYC v7: individual, adult_joint, teen_joint, custodial), never the
  project name.
- **(chosen by Claude)** **The retired `required` flag.** The column stays. The API still accepts `required` and ignores
  it, and no screen shows it; the preview's "marked required" count became counts per marking.
- **(chosen by Claude)** The console user guide has no policy chapter yet, so none was added. The Rules page and the
  rule page explain the annotations in place.
- **(owner, 15 Nov 2026)** **Policies-page mockup approved.** `docs/design/mockups/policy-rules.html` (PR #81) was
  approved before release. The build follows it on these points:
  - **D4:** the rules prompt has a short placeholder, a "Use this example" link, and a "Type what the template needs"
    hint beside the disabled button.
  - **D7:** no cost or budget figures on the Policies page, Admin included. Costs are still recorded by the API for
    the planned Admin "Usage and costs" page; only the "budget is used up" notice remains.
  - **Suggested rules:** they show Accept and Reject. Accept is the Apply tick ("Define with AI, then accept" when
    fields are missing). Reject only hides the suggestion in that session, and the rule stays unapplied.
  - **Filter:** a new "Applied only" filter.
  - **Published versions:** listed with their rules per marking; `GET /policy/rule-sets` gains `markingCounts`.
  - **Out of scope here:** the mockup's "Owner decisions" step shows the A1/A5/AI choices for review only and is not a
    product screen. The S4 picker (step 7) belongs to the SME task form (PR #82), and the rule drawer stays the existing
    rule page (navigation preserved, spec §0).

## MVP1 QA defects in one PR: non-integration scope (15 Nov 2026)

The owner, 15 Nov 2026: "Now combine all the defects into one PR and start coding. Again no integration with Anvil is
needed. Just work in non Integration model." This approves both mockups (PR #81 Policies, PR #82 SME task form). One
branch, `fix/mvp1-qa-defects`, builds: the policy rule annotations, the rubric editor and recommendations, and defects
D1 and D3–D9. D2 (tutorial video) is out: it needs a decision on how videos are generated and what that costs.

- **(owner)** **No RL Gym integration change.** The proposed `praxis.anvil.project_policy_annotations.v1` document,
  its endpoint, contract files, schema script and change note are not taken. This supersedes the "additive document"
  line in the annotations section above. Annotations stay internal. The export modules are byte-for-byte the same as
  `main`, and the pinned v6 package hashes and the v7 export tests still pass.
- **(owner, via PR #81's recommended options)** The automatic AI annotation pass after extraction plus "Suggest
  annotations with AI"; A1 ("Apply" means include, not "mandatory"); A5 (an applied Unresolved rule publishes only when
  marked Needs clarification).
- **(owner)** **AI in QA uses Gemini on Vertex**, the same route as SUITABILITY_MODEL and PROFILE_MODEL (QA has no
  Claude quota). `POLICY_AI_MODEL` and `RUBRIC_AI_MODEL` are empty in `.env.example`. An empty value follows a Gemini
  `AUTHORING_MODEL`. Rubric wording is behind `RUBRIC_AI_ENABLED` (off). Tests use mocks and never call Vertex. AI
  output is a labelled suggestion that a person accepts.
- **(chosen by Claude)** **Which changes are behind the flag.**
  - Always on: D1, D3, D4, D5 (display), D7.
  - Behind `RUBRIC_RECOMMENDATIONS_ENABLED`: D6, D8, D9 and the rubric editor (with their submit checks and the D9
    save normalisation). The flag is off in code and tests by default. QA turns it on with the owner's yes, so other
    environments and the existing jobs see no change until then.
- **(chosen by Claude)** **D1.**
  - A case-selector template's target can't be above its number of cases. The form caps the target and says why;
    the API refuses a higher target with `TARGET_ABOVE_CASES` on create and edit, and clamps the template default.
  - Resource assignments list sourced SMEs who hold no task, as "No open task left" when every task is taken, else
    "Not assigned yet".
- **(owner, D3)** The declaration reads exactly "I won't use real customer, employer or account information." on
  Before you start and at submit. The API's `syntheticOnly` and `syntheticDeclaration` fields are unchanged.
- **(owner, D5 non-integration)** No arrival-check change. Template text (labels, help, section titles, primary
  work, verification, human gate) is shown through `publicText()`: Anvil becomes RL Gym, and Praxis or ADI-Labs becomes
  ADI Forge. The stored template, and so its hashes, are unchanged.
- **(owner, D8 non-integration)** The owner's 20-criterion KYC table (names, Pass/Partial/Fail, weight 5 each,
  critical on identification_verification, screening and decision) is kept in Authoring. It's in
  `apps/api/src/tasks/rubric/defaults/golden-kyc-rubric-v1.ts`, keyed by the `golden-kyc-rubric-v1` evaluator, and
  applies to v6 and v7. It is used only when a template carries no defaults of its own. The SME can edit it and reset
  to the default; reviewers see what changed. This settles plan option B: weight 5 now comes from these defaults.
- **(chosen by Claude)** **The D6 library check is a warning.** The S4 picker stops SMEs typing references, but the
  `policy.library-reference` submit check warns rather than blocks. RL Gym hasn't confirmed which identities its v6/v7
  grader expects (manifest or template-supplied GB IDs), and the QA smoke job still types the template's identities.
- **(chosen by Claude)** **Marketing keeps its conventions.**
  - Levels 0–4, groups A–G, critical rules CR-01..CR-06, and no KYC defaults.
  - In the editor, Weight and Group are editable where the template doesn't set them. A criterion-level whole-task
    failure is flagged "Evaluation setup needed".
  - The golden Marketing test runs end to end with the flag on.
- **(chosen by Claude, D10)** **Pay before the first save.**
  - On Projects → New → Job description, "Generate from the template" shows the generated JDs with editable Wage
    per task, currency, location type and location before the draft exists.
  - The values are kept in the wizard (not auto-saved when the step opens). On Save they are written to the JDs the
    API generates, only where the PM entered a wage and the JD has none.
  - Next is blocked on this step until each needed JD has a wage, and a location unless remote. The problem is shown
    inline. "Use or write my own" needs a chosen JD with a wage.
  - Save itself never asks for a field the PM couldn't see.
- **(owner, D11)** The open-slot edge-case field reads "Edge case this task tests" everywhere, with the owner's help text (`EDGE_CASE_LABEL` and `EDGE_CASE_HELP` in `packages/shared/src/forge.ts`).
- **(owner, D12)** **Save is always visible.** The authoring forms (sections form, generic task page, KYC workbench)
  have a sticky action bar at the bottom with Save. Save is the autosave's flush: it never submits and never runs
  Submit's checks. The bar shows "Saving…", "Saved at HH:MM" or "Couldn't save, try again", and the button becomes
  Try again. Beside Save is "Check and submit", which goes to the last section. Autosave is unchanged. The bar is
  hidden on read-only tasks and in print.
- **(owner, D13)** **Help is a floating mascot: "Ember", our own ADI Forge character.** It is a friendly flame-like
  forge ember with a face, in the ADI Forge purples with a teal spark, with no anvil (an internal name stays out of sight). It is original, with no terminal face or
  cloud-robot silhouette. It is an inline SVG (64 px) fixed at the bottom right, above the sticky Save bar, so it never
  covers Save, Submit or a field. It has a gentle idle bob (none under `prefers-reduced-motion`) and a "Need help?"
  bubble on hover or focus. `aria-label="Help"` with a focus ring; it is hidden in print and while the drawer is open.
  Clicking it or pressing Enter opens the existing Help drawer. It is on the task and review pages. Screenshots are in
  `docs/design/mascot/`.
- **(chosen by Claude, D13)** Tutorial stays at the top of the page: it opens an inline video card, which would cover
  the form if it floated.

## D2 tutorial videos: plan (15 Nov 2026)

Plan: `docs/plan/PLAN-D2-TUTORIAL-VIDEO.md`. **Built 15 Nov 2026 on the owner's "build all the stuff and start on the video"; no live run and no deploy without the owner's direct yes.**

- **(owner)** AI video with Vertex Veo; a missing video never blocks publish; on publish in staging and production,
  only an Admin "Generate tutorial" button in QA; a per-video and a daily cost cap; an Admin approves before SMEs or
  Reviewers see it; generated once per template version.
- **(chosen by Claude)** **Model and clips:** `veo-3.1-fast-generate-001` (GA), 720p, 16:9, 8 s clips, video only,
  2 clips per chapter, one retry per clip. Veo's own audio is not used.
- **(chosen by Claude)** **Narration** is Cloud Text-to-Speech (one Chirp 3 HD English voice), from a script Gemini
  drafts on Vertex (the existing QA model route). Captions (WebVTT) come from the same script.
- **(chosen by Claude)** **On-screen text is drawn by ffmpeg** from the validated script, never by Veo. Veo prompts ask
  for text-free, logo-free scenes with no real likenesses. Every spoken or shown word goes through `publicText()`
  and a hard check for "Praxis", "Anvil" and "ADI-Labs"; a hit fails the run.
- **(chosen by Claude)** **Synthetic example:** the template's own golden example where it has one, else a
  Gemini-drafted one with invented names. Never task, SME or project data.
- **(chosen by Claude)** **Storage:** a new private `TUTORIAL_BUCKET` (`<project>-tutorials`), objects under
  `tutorials/<lineageId>/<runId>/`. `tutorial_video_url` stores `storage:<key>`; the API serves a 12 h V4 signed URL.
  Veo returns bytes (no `storageUri`), so the Vertex service agent needs no bucket access.
- **(chosen by Claude)** **Caps:** `TUTORIAL_VIDEO_COST_CAP_USD` and `TUTORIAL_VIDEO_DAILY_CAP_USD`, blank = live
  generation refused. Worst-case reservation at request time, daily total per environment (UTC) under an advisory
  lock, a per-call check during the run, and an append-only `TutorialSpend` ledger. Suggested values $40 and $100.
- **(chosen by Claude)** **Cost estimate:** $0.08 per Veo second → about $1.33 per chapter. Every form has 8
  sections, so 9 chapters: ≈ $12 per template (worst case reserved $23.49); all three ≈ $36 once. **(owner)** The
  cost is fine: one video per template version.
- **(chosen by Claude)** **Approval** writes the video to the run's template version and later versions of the
  workflow; older versions keep theirs. Regenerating keeps the approved video until the new one is approved. One
  open run per workflow.
- **(chosen by Claude)** Runs in `praxis-worker` as an outbox handler, with `ffmpeg` added to the API/worker image.
- **(chosen by Claude)** The mock pipeline runs only locally; deployed environments without `TUTORIAL_VIDEO_LIVE`
  say generation is off. `TUTORIAL_VIDEO_LIVE` is refused in tests and local development.
- **(chosen by Claude)** A publish while another version of the workflow has an open run doesn't start a second run
  (refusal audited); the Admin generates when the open one is decided. A run with no progress for 2 hours is closed
  as FAILED on the next request.
- **(chosen by Claude)** A clip refused by Veo's safety filter is retried once with a fixed, safe scene; a second
  failure fails the run. Billed calls are recorded before they are made (conservative).
- **(chosen by Claude)** Reject keeps the files (for the audit trail); only Approve changes the template.
- **(chosen by Claude)** The tutorials bucket has CORS for the console and candidate origins, so the captions track
  loads from the signed address.

## Suggested text per field and the rubric table (owner, 15 Nov 2026)
Design: `docs/design/SUGGESTED-TEXT-AND-RUBRIC-TABLE.md`, mockup `docs/design/mockups/suggested-text-and-rubric-table.html`.
The owner accepted all seven recommendations:
1. **(owner)** New human-authorship terms (new `AUTHORSHIP_VERSION`): the author wrote the task or read, changed where
   needed and accepted every suggested text, and it describes how the work is really done. Each field records where its
   text came from (written by the author, suggestion used as is, suggestion edited) with the suggestion version.
   `PRIOR_AI_DRAFT` is replaced by the Submit check "every section confirmed after its last change".
2. **(owner)** Provenance stays in ADI Forge (audit log and reviewer view). The RL Gym export contract is unchanged;
   RL Gym is asked whether it wants an optional per-field flag in a later contract version.
3. **(owner)** Consent is one confirmation per section (cleared when anything in it changes) plus the final declaration;
   each use of a suggestion is audited per field.
4. **(owner)** "Use all suggestions in this section" is kept; section confirmation is still required and the reviewer
   sees the counts. A human Reviewer still accepts or rejects the task.
5. **(owner)** Suggestions use the Gemini model QA already uses for the SME profile chat, behind
   `FIELD_SUGGESTIONS_ENABLED`, mocked in tests. Inputs: template, task slot, the project's published rules and the
   author's own text only, never case snapshots. Agent-brief fields pass the answer-leak and real-data checks first.
6. **(owner)** Every field in both templates (KYC v6/v7, Marketing VEYRA) gets suggestions. S4 policy identities and
   S7 IDs, weights and evaluators stay filled from the template or project.
7. **(owner)** The rubric table is the default S7 view for both templates; Edit opens the existing criterion editor.
   It includes D14 (only blockers shown in red at the top; recommendations collapsed) and D16 (a non-template
   criterion can always be removed; adding one is not offered with a fixed set).
- **(chosen by Claude, build)** Behind `FIELD_SUGGESTIONS_ENABLED` (off by default; on in QA deploys via
  `QA_FIELD_SUGGESTIONS`). Model: `FIELD_SUGGESTIONS_MODEL`, else `PROFILE_MODEL`, else `AUTHORING_MODEL`; the mock
  (template examples) without Vertex. Suggestions are kept per section so a reload never calls the model again; "Suggest
  another" asks for one field. Provenance is derived, never claimed: the hash of the suggestion taken is stored, and the
  saved value is compared with it. A section confirmation stores the digest of the section's saved content.
- **(chosen by Claude, build)** The task's case selector (set by the slot) gets no suggestion and is not counted as
  anyone's writing. S8 counts as a section to confirm (its Sources field is the author's).
- **(chosen by Claude, build)** With the flag on, the conversation review's `PRIOR_AI_DRAFT` block is replaced by
  `SECTIONS_NOT_CONFIRMED`; with it off the earlier rule stands. The authorship terms version is now `human-review/2`,
  so authors of in-progress conversational tasks accept the new terms once.
- **(chosen by Claude, build)** Rubric table: criterion "blocks Submit" = not in a fixed template set, empty name,
  missing required score text, weights not totalling 100 (or a group not totalling its weight), no critical criterion.
  Everything else (source links, applicability, coverage gaps, duplicates) is "Recommended, not required", collapsed.
  The earlier card list stays available as "One card per criterion".

## D18: a task that fails validation goes back to its author, at approval and at export (16 Nov 2026)

Owner (QA defect D18): "If validation fails even if its approved then we need make the task needed for re work. So
that the Author has to rework."

- **(owner)** Every approval re-runs the task's checks first: the one-step accept (Reviews screen and Tasks tab), the
  Reviewer's pass (console Expert and candidate-app Reviewer) and the PM's final approval. Any blocking failure stops
  the approval and moves the task to Rework; warnings never block. The same re-check runs before an RL Gym export; a
  task that fails there goes to Rework instead of being exported.
- **(owner)** The append-only dataset is never edited: a task whose approved record fails at export goes back to
  Rework as a new revision, its record stays, and the record of its next approval is the one exported.
- **(chosen by Claude, build)** What is re-run: the submit checks (coverage and case selector, profile, bound rules,
  RL Gym spec, rubric checks when they ran at submission) on the authored content, the executable contract checks, and
  the per-task export checks: the contract compile of a profile-driven task and, for a template with an RL Gym joint
  spec, the generic package entry. Contract compile blockers are shown as warnings, not blockers: the earlier owner
  decision that a blocked compile never blocks the task (golden KYC, `MISSING_BINDING`) stands. Not re-run: checks that attest what the author did at submission (consent,
  authorship declaration, conversation review, field-suggestion section confirmations), and package problems the author
  cannot fix in the task (template not joint or not published, form version or private-field exposure); those stay in
  the export report as before. The optional check families follow what ran at submission (`checks.options`, inferred
  for tasks submitted before this change).
- **(chosen by Claude, build)** A blocked approval is a REWORK `TaskReview` by the person whose approval or export
  triggered it, with each failing check as a comment under its section (the author's form already places comments by
  section) and the notes "Approval blocked …" / "Export blocked …". The task stores the re-run checks; the audit event
  is `task.rework_validation_failed` (trigger, version, failing check IDs, and on export the kept record ID); the export
  also writes `project.export_blocked`. The move happens only from SUBMITTED (approval) or ACCEPTED (export) at the
  revision read, so a retry changes nothing; the request's Idempotency-Key replays the same answer.
- **(chosen by Claude, build)** The Reviewer's request is answered 422 `APPROVAL_BLOCKED` with the reasons in the
  message and `details.checks`, but the move to Rework is committed (it is the decision's outcome, not a failed
  request). The export answers 422 `EXPORT_BLOCKED_REWORK` with the tasks sent back; no export run is written, and the
  project can export again once those tasks are approved. The earlier `CONTRACT_INVALID` refusal on accept is now part
  of this re-check (Rework, not a bare refusal).
- **(chosen by Claude, build)** An earning recorded at the first approval is not reversed (earnings are one per task;
  reversal stays a person's decision in the ledger). A project already marked complete keeps its status; its export
  waits for the reworked tasks.

## D19 and D20: SME places and the platform pool on the Assign screen (16 Nov 2026)

- **(owner)** The PM can put one SME on each task: Required workers is never lower than the task count, can be raised
  from the project, and a full screen says why. The Assign list includes every available person in the platform pool
  who matches the project's criteria, not only this project's Sourcing profiles.
- **(chosen by Claude, build)** Required workers is raised to the number of expert task rows at submit and whenever the
  task rows are checked (the Assign screen, Resource assignments, the Tasks tab, and before each assignment), audited
  as `project.required_workers_raised`. This fixes existing projects such as QA f7f3cfae with no manual data step. A
  null Required workers still means no limit. The SME-place check also uses the higher of the two, so a stale value
  never blocks.
- **(chosen by Claude, build)** The change control is on the Assign screen (Required workers field and Save), for PMs on
  their own projects and Admins: `POST /projects/:id/required-workers`, never below the task count or the SMEs already
  assigned (422 `REQUIRED_WORKERS_TOO_LOW`), only on new or active projects. Audited as
  `project.required_workers_changed`; the same value again is audited as `project.required_workers_unchanged`.
- **(chosen by Claude, build)** The platform pool is everyone in the client with a candidate record (onboarding or an
  earlier assignment), an active account and a contact email. Criteria: the project's `country` filter, its minimum
  `domain_experience_years`, and the project's JD skills (the template's required skills). Skill evidence is the
  person's listed skills and specialties plus the assessment answers on any of their Sourcing profiles. A value the
  person has not stated is shown as "not stated" and does not exclude them; a stated value that misses a required
  filter, or skill evidence with none of the skills, does. Best match first. Nothing is decided by AI: the PM picks.
- **(chosen by Claude, build)** Unavailable and left out: at their `concurrentProjectLimit` (open projects elsewhere,
  counting a place from the earlier flow or a PM assignment), or already on this project in any role or with a
  Sourcing profile here (that person is listed once, as a Sourcing profile). The concurrent-project limit applies to
  pool people only; this project's Sourcing profiles are listed as before.
- **(chosen by Claude, build)** A pool person can be assigned as SME, or as Reviewer on the Reviewer route. The request
  is `POST /projects/:id/assignments/direct` with `candidateId` and `role` instead of `sourcedPersonId`. It creates
  their Sourcing profile on the project (linked to their account, `submittedBy` the PM, audited as
  `sourcing.person_added` with `fromPool: true`, no names or emails), re-checks availability and criteria (409
  `NOT_AVAILABLE`), then assigns as before: one role per project, never their own task, choosing the task is required.


## D26 and D28: export of evaluator-graded tasks, complete Marketing criteria (17 Nov 2026)

- **(owner, 17 Nov)** Fix D26 and D28. Evaluator-graded templates validate and export on their own path; no author or
  PM sees a blocker they cannot fix in the UI; Marketing criteria arrive complete from the template.
- **(chosen by Claude, from the docs)** **D26 path.** A form with `contract.outputsFrom: "template_execution"` (KYC v7
  `golden-kyc-application-type-v1`, Marketing `veyra-hush-one-launch-v1`) has no per-task output field. Its criteria
  are graded by the template's evaluators (`execution.evaluators[]`, `run_evidence`), and its tasks reach RL Gym in the
  generic package (`praxis.authored-task-export.v1`, four confirmations). The per-task bound contract
  (`praxis.anvil.task.v1`) does not apply to it, and the owner's 11 Nov decision forbids turning evaluator-graded
  checks into agent-output bindings, so no binding is supplied or invented:
  - submission no longer compiles a bound contract for such a form (no "Name the output field…" status stored);
  - a stored status from before the fix is never shown (author task page, review page);
  - project validation and export check such a record as its generic package entry (`taskPackageProblem`, the same
    checks the package builder runs), whatever compile blockers its stored checks still hold. The export file line
    names its `exportContract`; `anvilExport` stays null (there is no per-record envelope on this path).
- **(chosen by Claude)** **Verdicts on the generic path follow the gated validator.** No problem → valid (Praxis's
  pre-check). A problem the author can fix in the task (the D18 list, now shared as `AUTHOR_FIXABLE_PACKAGE`) → needs
  fix. Any other package problem (form, publication, private exposure, size) is the template's or RL Gym's → not
  validated, with the reason. Nothing is reported as a task repair the author cannot make.
- **Open (owner / RL Gym), found while fixing D26.** The published Marketing form's S4 policy citations do not declare
  the sub-fields ADI Forge keeps from agents (`appliesTo`, `rationale`) as private, so RL Gym's public view would differ
  from the agent view and the package refuses the task (`GENERIC_PRIVATE_EXPOSURE`, four confirmations). Marketing
  tasks therefore show "not validated" until a new Marketing template version declares those item fields private. That
  is a form (template hash) change on RL Gym's proposal; not changed here.
- **(chosen by Claude)** **D28 Marketing defaults** (Authoring defaults file, template data unchanged):
  - Levels 3 and 1 are the 0-4 scale's in-between levels and say so, quoting the neighbouring levels' own text
    ("Between Level 4 and Level 2: better than "…", but short of "…""). Nothing new is assessed.
  - When it applies: "Required throughout this workflow." (one reusable task; every criterion is scored on every run),
    used only when the task itself gives none.
  - Derived from: the template rubric criterion ("Template rubric · A1 Relevance"), used only when no task source
    links to the criterion. KYC defaults name no source, so KYC links are unchanged.
  - E3 Readiness arrives critical, with its whole-task failure condition from CR-05. The golden example also marks G2
    critical; the owner asked for E3 only, so G2 stays as before.
  - A criterion still exactly as the D22 defaults filled it (no author change) takes the new defaults when the task is
    opened; once filled, an author's change (for example unticking E3) is kept. Stored suggestions from before the fix
    show the template's applicability, condition and link until the author edits them.

## Marketing form v2: S4 citation visibility declared for RL Gym (17 Nov 2026)

- **(owner, 17 Nov, via the DevOps session)** "ok, do the new Marketing template version too", for isolated RL Gym
  testing while RL Gym is not integrated. Closes the Open item of D26 above (`GENERIC_PRIVATE_EXPOSURE`).
- **(chosen by Claude, from the docs)** **How the visibility is declared.** The four confirmations (still incompatible,
  item 2) record that RL Gym's projection copies whole items of a field without `itemFields`, and that a form can avoid
  the exposure by declaring the citation's `itemFields` with the private ones marked. ADI Forge's mirror of that
  projection (`actorProjection`, verified against RL Gym's fixture) applies declared `itemFields` whatever the field
  type. The documented example names a `repeated_array`; ADI Forge keeps the type `policy_citation` instead, because the
  rule picker, the bound-versions check, D21 source ticks and the policy role all key on it. So:
  - a `policy_citation` field may now declare `itemFields`, as **visibility metadata for RL Gym only**. ADI Forge's
    authoring, checks and agent view keep using the built-in citation sub-fields;
  - a declaration may name only built-in sub-fields with their built-in type, must declare every agent-visible one
    (rule ID, version, locator, quotation) as agent-visible, and never makes a private one visible;
  - **to confirm with RL Gym at integration:** that its projection applies `itemFields` on a `policy_citation` field as
    on a `repeated_array`. Until then this is ADI Forge's documented reading, checked only by ADI Forge's mirror.
- **(chosen by Claude)** **Form `veyra-hush-one-launch-v2`** = v1 plus the S4 declaration (rule ID, version, locator,
  quotation visible; applies-to, rationale, exception private). The binding sub-fields and the hard-failure flag are
  not declared, so RL Gym drops them, as ADI Forge does. Same fields, rubric defaults (D28), starting workflow and
  agent view as v1. A new form ID because form IDs are never reused.
- **(chosen by Claude)** **How QA gets it.** RL Gym starts template changes, but cannot send proposals to QA yet. The job
  `marketing-form-v2 <v1 templateId> --requested-by <admin email> [--apply]` builds the next version from the
  published v1: RL Gym's parts (template key, requirement, execution, skills) and the template block verbatim, only
  the form replaced, worked examples re-pointed to v2. It runs the exact proposal checks and creates a **DRAFT**
  through the same path as a proposal (`storePack`), audited as `template.form_revised` (actor SYSTEM, with the
  requesting Admin). Dry run by default. A Praxis Admin publishes the draft in the console. No migration, no seed.
  When RL Gym integrates it should adopt this form (or propose its own) for its Marketing template.
- **(chosen by Claude)** **The approved v1 task (project 9b9092cf, task a664416f) is not made exportable by v2.** Its
  `ApprovedTaskRecord` names template v1 and form v1, and the package is built from the record's own template version,
  so it stays "not validated". Options considered:
  - *Re-pin the project or task to v2:* rejected. A project cannot change template version, and the record would still
    name v1 (changing it would break append-only); a v2 form against a v1-authored record is `GENERIC_FORM_MISMATCH`.
  - *Export-time visibility override from the newer version:* rejected. The package would send form v2's hash for a
    task authored on v1: a statement RL Gym never agreed to, i.e. invented cross-version behaviour.
  - ***Re-author on v2 (chosen):*** a new Marketing project on the published v2 (target 1); the SME authors the task
    (they may reuse their v1 text: the fields are identical) and people review and approve it as usual. The v1 record
    stays as it is, append-only. Nothing is decided by AI and RL Gym sees one consistent form.

## D31: field suggestions time out on large sections (18 Nov 2026)

QA (Marketing, VEYRA Hush One v2, S2): `POST /me/tasks/:id/suggestions` often failed and the box said "Could not reach
the service". Two causes: the model call ran inside the command's database transaction (15 s limit, so a slower answer
was a Prisma P2028 500), and one model call for up to 30 fields with a 45 s limit outlived the candidate app's 30 s
proxy limit.

- **(chosen by Claude)** **Model call outside the transaction.** New `runCandidateCommandPrepared`: after the
  idempotency check (so a replay never calls the model again) and before the transaction, a read-only `prepare` step
  runs the same task checks on a plain read and calls the model. The transaction then locks the row, checks again
  (owner, editable, still on the work), merges into the latest suggestion state, saves and writes the audit event, as
  before. Authorised, idempotent and audited exactly as today.
- **(chosen by Claude)** **Small parallel batches.** A section's fields (still at most 30) go to the model in batches
  of 8, all at once, each with a 22 s limit, an 8,000-token output cap and short thinking (`quick`, as the policy rule
  suggestions do). Simplest change that keeps the request inside 30 s whatever the section size; no queue or polling.
  A batch that fails or is slow only leaves its own fields without a suggestion; the request fails only when no batch
  answered.
- **(chosen by Claude)** **A clear timeout.** A model timeout is `503 SUGGESTIONS_TIMEOUT` "The suggestion took too
  long. Try again." (other failures stay `SUGGESTIONS_UNAVAILABLE`). The web and candidate proxies now answer a 30 s
  timeout with `504 UPSTREAM_TIMEOUT` instead of "Could not reach the service"; the suggestion box shows the same
  "took too long" message for both. The AI still only suggests: nothing is filled in or confirmed for the author.

## KYC v8: successor of the published v7, successor task revisions, offline export (18 Nov 2026)

RL Gym asked (18 Nov) for a KYC v8 successor of the published v7 with complete policy bindings, and reviewed the
offline candidate package. Its findings: v8 must really be published, `TP_FORM_ID_TAKEN` resolved through a successor
or version path, the four successor revisions really created with review provenance, and the export must be the real
import ZIP. The owner (Product Owner and policy owner) approved a one-time migration exception (APR-01) and every policy
decision (APR-02 to APR-06, APR-09). Code: `apps/api/src/jobs/kyc-v8-successor.ts`, `authored-export.ts`,
`kyc-v8-readback.ts`; inputs embedded in `apps/api/src/jobs/kyc-v8/`.

- **(chosen by Claude)** **TS-24: a successor version keeps an identical form's ID.** A new version of an existing
  workflow (proposal, validate, the Marketing and KYC jobs) may reuse a form ID when its form has the same RFC 8785
  SHA-256 as the form registered under that ID, for the same workflow and client, and a PUBLISHED version of that client
  uses it. The registered form row is reused (audited `template_profile.reused`); no second row is written. A changed
  form, an unpublished one, another workflow's or a built-in form is still `TP_FORM_ID_TAKEN`. Console pack uploads
  keep the old rule. v7 is never edited.
- **(chosen by Claude)** **Inputs embedded, not uploaded.** The v8 spec from the offline package (rev 2, JCS SHA-256
  `8449adb0…`), the four successor candidates, ID map, approvals, change report and the official text of
  31 CFR 1020.220 (eCFR as of 12 Nov 2026, SHA-256 `07069b75…`, public domain) are files in the job directory, so the
  Cloud Run job needs no upload. The job checks every identity it relies on (template ID, version, predecessor hash,
  anvil key, record and task IDs, content hashes) and refuses on any difference.
- **(owner, 18 Nov, via the DevOps session)** **Package rev 2 replaces the hash RL Gym reviewed.** Rev 1 (`fb9a4aa7…`)
  carried stale labels in `requirement.policy_bindings` (applicability `pending`, rule map `draft`). Rev 2 says
  applicability decided 20 of 20 (APR-03a, APR-03) and the rule map approved (APR-04), so v8 hashes to `8449adb0…`.
  Publishing v8 in QA is the decision now; RL Gym asked for every hash to be recomputed at publication. Rev 2 also
  records APR-11 (the policy owner's assessment: the S4 change has no impact on required decision, outcome or business
  meaning) and APR-12 (the owner's approval to create v8 and the successors in QA).
- **(chosen by Claude)** **Three phases, a person between each.** `kyc-v8-successor template` creates the v8 DRAFT
  (the exact spec hash is verified after creation, else rolled back) → an Admin publishes v8 in the console →
  `kyc-v8-successor project` creates the v8 project → an Admin reviews the rules and publishes the rule set →
  `kyc-v8-successor tasks` creates the successor revisions as submitted work → an Admin approves each in the console.
  Every phase: dry run by default, `--apply`, `--requested-by <active Admin>`, idempotent, audited (actor SYSTEM
  `kyc-v8-successor`, with the requesting Admin's user ID).
- **(chosen by Claude)** **How S4 binds the official text: the native policy library.** Today S4 references are checked
  against the project policy library (`policy.library-reference`: document ID as `ruleId`, `rsN.dM` version,
  `project rule set vN` locator and the document version's SHA-256; a warning) and the export accepts any S4 the form
  allows. The candidate's `ruleId: us-31-cfr-1020.220` would fail that check, and its extra `bankPolicyDocument` field is
  not a field of the (unchanged) form. So the v8 project holds the official text as a project policy document (the
  exact bytes, so its SHA-256 is `07069b75…`), and the successor's S4 `statePolicies` lists two library references:
  the official text first, then the bank policy document the v7 task cited (same SHA-256 `a5c0aa…` as v7, its new
  document ID in the v8 project). Same hashes as the candidate; identities are the project's own; private notes kept.
- **(chosen by Claude)** **Rules are re-reviewed, never carried as reviewed.** Projects are isolated, so the v7
  project's published rules are copied to the v8 project as DRAFT rules on byte-identical copies of their documents.
  The three rules the policy owner mapped to the regulation (APR-04: R-COLLECT-CUSTOMER-NAME → (a)(2)(i)(A)(1),
  R-COLLECT-ADDRESS → (A)(3), R-CONFIRM-PENDING-TIN-APPLICATION → (B)) also cite a verbatim passage of the official
  text. A person reviews them and publishes the rule set; the successor tasks wait for that.
- **(chosen by Claude)** **The v8 project mirrors the v7 project with two differences.** Same owner, JDs, dates, target,
  per-task cap and demographic filters; one task per application type. The review route is SME → PM/Admin (the console
  approval is the human decision RL Gym asked for; the original Reviewer's pass is lineage), and no authoring experience
  is set (nobody authors in this project).
- **(chosen by Claude)** **Successor revisions arrive as submitted work, never as approvals.** Sections S1–S3 and S5–S8
  are taken from the approved v7 record and must equal the candidate's verbatim (else refused); only S4 changes. The
  task is assigned to the original SME's candidate record (their content), status SUBMITTED, with one submission,
  a frozen policy snapshot and the input field `successorOf`: predecessor record, task, project, template version and
  content hash, original SME (candidate and SME user IDs) and reviewer IDs and times, carried and changed sections, the
  approvals APR-01, APR-04, APR-05, APR-11 and APR-12 by reference (the job refuses if any is missing from the approval
  records), and the candidate file's hash. The checks an approval re-runs (D18, author
  attestations excepted: those belong to the predecessor's submission) must pass before anything is written. The job
  never writes an `ApprovedTaskRecord` and never extends an old approval: a person approves each revision in the
  console, which writes the record with their user ID, and that record's opaque review receipt is what the export
  carries. The change report's "decision/outcome impact: not assessed" entries are resolved by APR-11 (no impact;
  citation source changed only); the console approval is still the decision on each complete revision.
- **(chosen by Claude)** **TS-17 offline export: `authored-export <projectId> [--apply] [--out <dir>]`.** Builds the
  project's current approved tasks with the same `buildGenericPackages` as the online export (root
  `praxis-export.json`, declared form, actor and private files, exact template and record references,
  `execution {location: anvil_only, paid_calls: false}`), then checks every ZIP against RL Gym's archive bounds (1 MiB
  compressed, 30 MiB expanded, 10 MiB per file, 1200 entries, safe unique paths, STORE or DEFLATE, no encryption) and
  against its own manifest (every declared file present with its JCS SHA-256, nothing undeclared). Writes to a
  directory (never overwriting) or to object storage under `exports/offline/<projectId>/`. Never calls RL Gym.
- **(chosen by Claude)** **Readback: `kyc-v8-readback`.** Read-only JSON for the DevOps publication and approval
  records: v7 and v8 IDs, status, publication time, template and part hashes, form ID; the v8 project's policy
  documents and rule sets; for each successor its predecessor mapping, submissions, reviews and approved records
  (record ID, sequence, content and previous hash, receipt reference) and audit events, with actor user IDs and roles
  only (no names or e-mails).

## KYC v8 tool-binding correction and the declared-tool check (20 Nov 2026)

RL Gym's importer refused 9 `S5.steps[].tool` values of 3 approved v8 tasks that v8's `execution.tools` does not
declare (`PX_TOOL_CALL_MISSING`; the adult-joint task passed). The v8 form's step `tool` is free optional text and
nothing checked it. The owner (Product Owner) decided in chat (APR-13a-d): 7 exact rebindings; the 2 pending-TIN steps
left blank with capability gap CG-01 (no TIN capability in v8; a Template Studio request); v8 unchanged; originals
untouched; the owner approves each revision in the console; a recurrence check. Code:
`apps/api/src/jobs/kyc-v8-tool-binding.ts`, `apps/api/src/anvil/tool-binding.ts`, `authored-export.ts`.

- **(owner, 20 Nov)** **APR-13a-d** as above. The exact pointers, old and new values are embedded in the job
  (`KYC_V8_TOOL_BINDING`), with a semantic justification per change.
- **(chosen by Claude)** **The revision path is the existing one for an approved task (D18).** An approved task may
  leave Accepted (or Rework) as a new submitted version; its approved record stays (append-only) and is not exported
  while the task awaits review; the record written by the next console approval replaces it in exports. The job
  `kyc-v8-tool-binding --requested-by <active Admin> [--apply]` submits the 3 revisions this way (a new
  `TaskSubmission`, the slot back to in progress, audit `task.tool_binding_revision_submitted`). The new record is a
  later record of the same task (`supersedesId` stays null, as for every re-approval); the lineage is in the task
  input `toolBindingCorrection` (predecessor record ID, content hash and asset hashes, each pointer's old and new value
  and justification, APR-13a-c in the v8 job's approval shape, CG-01, RL Gym's request), so the new record carries it.
  The job never writes an `ApprovedTaskRecord`.
- **(chosen by Claude)** **The job refuses, writing nothing, on any difference:** the requester is not an active Admin;
  the template version is not the published one with sha256 `8449adb0…`; the predecessor is not the task's latest
  approved record (superseded or a later record); the task is not Accepted/Rework or its content differs from that
  record; a pointer is not an S5 step tool, or its value is not the expected old value; a new tool is not declared; a
  blank lacks its capability gap; an approval is missing; or the corrected task fails the checks its approval re-runs.
  Putting the old values back must give the approved bytes exactly. A task already carrying the same correction is
  reported (`already_submitted`, with the approval's record once it exists) and not touched.
- **(chosen by Claude)** **APR-13d: the declared-tool check is a package check (`GENERIC_TOOL_UNDECLARED`).** For any
  template version whose execution part declares `tools`, every non-blank `S5.steps[].tool` must be exactly one of
  their IDs (case and spaces count; blank or absent is allowed; templates without `execution.tools` are not checked).
  It is author-fixable, so the console approval and the live export send a failing task to Rework with the message
  under S5 (D18), and both export paths leave it out. The offline `authored-export` refuses to write anything when an
  approved task fails it (or would expose private fields), instead of exporting the rest.
- **(chosen by Claude)** **Offline export: conformance checks and change records.** Before writing, each ZIP is also
  checked on its own bytes: declared tools per task, actor.json exactly the public projection of the private reference
  with no private, criterion or unknown field, private assets under `private/` (plus the existing manifest hash and
  archive checks). Each part with a corrected task gets `<packageId>.change-record.json` next to the ZIP
  (`adi-forge.tool-binding-change-record.v1`): predecessor and successor record IDs and content hashes, actor and
  reference hashes before and after, each pointer's old and new value and justification, approvals and capability gaps.
- **(chosen by Claude)** The PR #99 test fixture now binds the embedded v8 candidates' tools as APR-13a/b did, since
  approval refuses the original values.

## KYC v8 pending-TIN exclusion (APR-14, 21 Nov 2026)

RL Gym has no TIN capability (CG-01), so after APR-13 the Teen joint and Custodial tasks kept a pending-TIN step with
a blank tool. The owner (Product Owner) decided in chat (APR-14): remove pending-TIN verification from those 2 tasks
entirely (S5 step 3 and every dependent instruction, output, rubric, reference and failure-handling text); no
substitute tool; no claim that TIN was verified; record the limitation; v8 unchanged (its contract does not require
TIN); originals append-only; the owner approves each revision in the console. Code:
`apps/api/src/jobs/kyc-v8-tin-exclusion.ts`, `authored-export.ts`.

- **(owner, 21 Nov)** **APR-14** as above, with the field-by-field change list (shared notes
  `kyc-v8-tin-exclusion-changes.md`) embedded in the job (`KYC_V8_TIN_EXCLUSION`) as exact find/replace edits. The
  limitation sentence is appended verbatim to S1.scope and S8.reviewerNotes: "Pending-TIN verification is excluded
  from this benchmark; results do not establish TIN verification or complete regulatory compliance."
- **(chosen by Claude)** **Same revision path as APR-13 (D18).** `kyc-v8-tin-exclusion --requested-by <active Admin>
  [--apply]` moves each task from Accepted (or Rework) to Submitted with an optimistic update, a new `TaskSubmission`,
  the slot back to in progress, audit `task.tin_exclusion_revision_submitted` (actor SYSTEM); it never writes an
  `ApprovedTaskRecord`. Lineage goes in task input `tinExclusion` (`adi-forge.tin-exclusion-revision.v1`); the APR-13
  `toolBindingCorrection` lineage is kept as history. Re-runs report `already_submitted` and, once approved,
  `successorRecordId`.
- **(chosen by Claude)** **Guards.** Each edit's old text must occur exactly once in the current value; the removed
  step must be S5 step index 2 with `tool: ""` citing R-CONFIRM-PENDING-TIN-APPLICATION; S3.tools, S4 and S7.criteria
  may not be listed; the predecessor must be the task's latest record and carry the APR-13 lineage; afterwards the rule
  must no longer be cited anywhere in the task; reverting the edits and re-inserting the step must give the approved
  bytes exactly. Any failure refuses (exit 3) and writes nothing. The unchanged tasks (Individual `7b588c33…`, matched by
  ID prefix as the change list gives it, and Adult joint `a7bd89e2…`) must be accepted on that latest record.
- **(chosen by Claude)** **Change record: a sibling schema `adi-forge.task-change-record.v1`**, written as
  `<packageId>.task-change-record.json` next to the ZIP, rather than a new version of the tool-binding record: APR-14
  edits whole text fields and removes a step, which the pointer/old/new-tool shape of APR-13 does not describe. It lists
  the decision (APR-14, limitation, CG-01); per revised task the predecessor and successor record IDs, content hashes and
  actor/reference hashes, every change (`replace` with pointer, successor pointer if moved, whole old and new value; or
  `remove` with the removed step), and both records' approval receipts (approver user ID and roles, time, record ID,
  receipt ref); and the package's other tasks as `unchanged`. The tool-binding change record skips records carrying
  `tinExclusion`, so in the 4-task export it covers only Individual (still the APR-13 revision). The APR-13d
  declared-tool and actor/private conformance checks are unchanged and run on the same ZIP.

## New RL Gym, part 1: authored task packages by hash (22 Nov 2026)

Design: `docs/design/FORGE-RLGYM-V2-DESIGN.md` (PR #104). Contract read from the new RL Gym's build
(`ADI-Anvil/.claude/worktrees/rlgym-v2-8919f6`: `rlgym/integrations.py` `forge_package`, `rlgym/projects/service.py`
import, `services/stubs/forge_stub.py`), read only, with the owner's OK for that one read.

- **(owner, 22 Nov)** Part 1 first; the author experience, including AI assist on Authoring and Policy, is unchanged.
- **(from the RL Gym build)** RL Gym calls `GET /api/v1/packages/{package_sha256}` with `Authorization: Bearer
  RLGYM_ANVIL_KEY` (Forge's existing `ANVIL` key kind), stores the package's top-level `actor` and `private` objects
  separately, and refuses a package whose SHA-256 over sorted-key compact JSON differs from `package_sha256`.
- **(chosen by Claude)** **Package content `praxis.authored-task-package.v1`:** `schema`, `task_id` (the Forge task
  ID), `revision`, `revision_id` (the approved record), `template` {id, version, sha256}, `form` {profile_id, version,
  sha256}, `agent_mode`, `content_classification: synthetic`, `review` {status, revision_id, receipt_ref}, `actor` (the
  same public projection as the ZIP's `actor.json`) and `private` (the same grader-only reference as `reference.json`).
  The same checks as the ZIP export apply, so a task the export cannot package has no package. Stored as RFC 8785
  bytes; for strings and integers that equals RL Gym's sorted-key compact JSON, so both hashes agree (tested).
- **(chosen by Claude)** **Revision** = the record's position among the task's approved records (1, 2, ...).
- **(chosen by Claude)** **Written when a record is appended** (`appendRecord`, the one path every approval and
  correction job uses), and idempotently again before an export (part 2), so older records get theirs. Building a
  package never fails an approval: a problem simply leaves no package, reported at export as today.
- **(chosen by Claude)** **Table `AuthoredTaskPackage`**, key (client, hash), one package per record, append-only by
  trigger and revoked UPDATE/DELETE. The route reads only the calling key's client. Unknown or malformed hash: 404.
- **(RL Gym chat, 22 Nov, relayed by the owner)** Answers to Forge's four questions:
  - `package_ref` = `forge://packages/<package_sha256>`. RL Gym never follows it; it always fetches by hash from its
    configured ADI Forge URL. RL Gym will accept `forge://` refs whose sha equals `package_sha256` (RL Gym change,
    needed before part 2 works end to end).
  - RL Gym requires the `actor` and `private` objects and reads no other top-level field. Inside them it reads
    optional `actor.tools` (allowed operation IDs; absent = every declared operation), optional `actor.assignment`
    (prompt text; RL Gym will build the prompt from profile, title and sections instead), and in `private`
    `complexity`/`archetype` (V11+) and `slots`/`extra_state_checks` (SME-valued templates). Reference answers come
    from Studio's registry. Its task page will render Forge's shape generically (RL Gym change).
  - Hash: RL Gym re-serialises with Python's encoder, which differs from RFC 8785 for non-integer numbers; RL Gym will
    hash the raw response body instead (RL Gym change). UUID `task_id` is fine.
- **(chosen by Claude)** `actor.tools` = the template's declared tool IDs (`execution.tools`), only when it declares
  some (an empty list would refuse every call). No `actor.assignment`. `slots`/`extra_state_checks` and
  `complexity`/`archetype` wait for F-12 (not built).
- **(chosen by Claude)** Decimals are **not** refused or turned into text: criterion weights are decimals in real tasks,
  and changing them would change grading. Packages stay exact RFC 8785 bytes; until RL Gym hashes the raw body, a
  package containing a decimal fails RL Gym's parsed-hash check. KYC v8 packages contain none (tested).
- **(chosen by Claude)** The new table is added to `APPEND_ONLY_TABLES` in `jobs/grant-app-role.ts`, so the QA and
  production app role cannot update or delete it. `TutorialSpend` (D2, PR #84) was missing from that list and is added
  too; its trigger already blocked changes.

## Authoring side of Studio edge cases, verifiers, RL Gym export and branding (22 Nov 2026)

Source: adi-labs-design `praxis/AUTHORING-SPEC-EDGE-CASES-VERIFIERS-BRANDING.md` (rev 1.0), `AUTHORING-SNAPSHOT.md`
3.1-3.6, `AUTHORING-LOCAL-SETUP.md`, `CHANGES.md` F-05, F-09-F-12; contracts read from Studio PR #14 (`praxis_wire.py`,
inbox API) and the RL Gym build (`forge_stub.py`, `projects/service.py`, `scoring/service.py`), read only. Local only;
additive: the old export path, the old-flow project page and the author workbench are unchanged.

- **(chosen by Claude, spec 5 q1)** Proposal content sits where the spec proposes: `authoring.edge_cases[]` and
  `authoring.verifiers` (`adi.verifier-blocks.v1`). Studio's builder today sends the blocks as `execution.verifier_blocks`
  (per criterion); Authoring reads that too (display only; its case-reference paths are never shown). Grading data is
  refused with `TP_PRIVATE_GRADING_DATA`: an edge case's recipe, outcome, `reference_answers`, minimums or rule; a
  verifier value from `case_reference`. Edge-case slice tags must be values of S1's `complexity`/`archetype` lists when
  those exist. Unknown authoring keys stay refused (`additionalProperties: false`).
- **(chosen by Claude, spec 5 q2)** A task focuses on **at most one** edge case.
- **(chosen by Claude)** Complexity and Archetype are S1 pick-list fields of the template, so the existing workbench
  shows them; nothing is hard-coded. The focus edge case, expected-result slots and extra state checks are a separate
  **Benchmark** panel on the SME task page (`TaskInstance.benchmark`, server-side like `drafting`), so the workbench,
  its autosave and its AI assist are untouched. The panel is editable only while the task is editable, with its own
  version check.
- **(chosen by Claude)** "Choosing an edge case fills in its archetype and complexity" is applied in the package: the
  edge case's archetype always; its complexity unless S1 has one. The panel says so.
- **(chosen by Claude)** Package private part: `complexity`, `archetype`, `edge_case` and, for `sme` templates,
  `verifiers {slots, extra_state_checks}` (spec 2.4). Keys appear only when set, so other packages keep their bytes.
  The RL Gym reads slice tags from `private` (as built). **Gap for the RL Gym:** its scorer reads slots from
  `private.verifier` (singular) or top-level `private.slots`, and an extra check's `criterion`; the spec says
  `private.verifiers` and has no criterion on an extra check. Authoring follows the spec; the RL Gym needs a one-line
  read change (or the spec changes). Golden KYC (`case_reference`) is unaffected.
- **(chosen by Claude)** The approval gate (required slots, choices, allowed checks) is in `writeApprovedRecord`, the
  one path every approval uses: `422 BENCHMARK_INPUT_INCOMPLETE`. The package is written from the approved input in the
  same transaction.
- **(chosen by Claude)** Export: new routes `GET /projects/:id/rlgym-export` and `POST /projects/:id/rlgym-exports`
  beside the old `/export`, `/exports` and `/validate` (kept: additive). Body `rlgym.project-export.v1`,
  `Idempotency-Key` = `export_sha256`, `package_ref` = `forge://packages/<sha>`. The RL Gym template identity
  (`id`, `version`, `spec_sha256`) comes from the RL Gym's qualification receipt (`rlgym_template_id`,
  `rlgym_template_version`, `spec_sha256`), so a version the RL Gym has not qualified cannot be exported. Each task
  carries `complexity`, `archetype`, `edge_case` (spec 1.6) and the focused edge case is added to
  `case_selector.edge_cases`. Revisions above 1 carry `corrects_revision` and, when a review decision reopened the
  task, `sme_batch_id`. Tasks behind a sent `new_case_kind` need for the project's current template version are held
  ("Waiting for new case kind inb-…"). Export runs are append-only (`RlGymProjectExport`). Code adapted from the
  unfinished part-2 draft in the `forge-rlgym-v2-part2` worktree, without its removal of the old path.
- **(chosen by Claude)** Run reviews: `POST /projects/:id/run-reviews` (ANVIL key) → `202 {forge_batch_ref}`,
  idempotent by `batch_id`; a batch carrying `reference_answers` is refused. Decisions are made by the project's PM,
  Admins and Reviewers (console), sent to the RL Gym **synchronously**; they are recorded (append-only, one per item)
  only when the RL Gym accepts them, so a failed send can simply be retried. `task_correction` moves an accepted task
  to Rework with the rationale as the review note (a TaskReview REWORK), the same states as the existing rework.
- **(chosen by Claude)** SME needs: SMEs raise **Raise an edge case** (four parts) or More data from the task page;
  the PM/Admin merges, rejects (reason shown to the SME) or sends. Sending posts only the contract's fields to Studio's
  `POST /api/v1/inbox-items` (`source: "adi-forge"`, one evidence entry per merged need, `raised_by` an opaque
  `sme-<id prefix>`); Studio's Template ID and version are the RL Gym's names for the release (same qualification
  receipt). Status is read on demand (`GET /api/v1/inbox-items/{id}`); no webhook (spec 5 q4: reading is enough for
  now). `SmeNeed` rows change state (open → merged | sent | rejected) with every change audited; they are not
  append-only.
- **(chosen by Claude)** Settings (proposed names kept): `RLGYM_API_URL`, `RLGYM_WORKSPACE`, `RLGYM_FORGE_CLIENT_KEY`,
  `STUDIO_API_URL`, `STUDIO_INBOX_KEY`. Local Studio does not take a bearer key from services: it trusts headers, so
  `STUDIO_TENANT_ID`, `STUDIO_ACTOR_ID`, `STUDIO_ACTOR_ROLES` (default `service`) are added. Studio's inbox read
  requires a designer or admin role, so with a service principal the status read may be refused; the need then keeps
  its last known state.
- **(chosen by Claude)** Branding: one `BrandLockup` (`product`, `tone`) and `PRODUCT_NAME = 'Authoring'`,
  `FAMILY_NAME = 'ADI Labs Forge'`; titles `<Page> · Authoring · ADI Labs Forge`; navy `#082044` header with the purple
  rule on both apps; primary buttons `#8126af`; shield and logo replace the old files under the same names; recruiter
  PDF has the logo and the running header; default sender "ADI Labs Forge Authoring". The names test now allows
  "ADI Labs" (spec 3.5; legal to confirm) and also catches compounds such as "Anvil-ready". Running text that says
  "ADI Forge" is not renamed in this change (part of it is AI prompt text, which this work must not touch).
- **(found in the local run, chosen by Claude)** The RL Gym accepts only project IDs `prj_[a-z0-9]{4,40}` (database
  check), and Authoring's are UUIDs. The export sends `prj_` + the UUID's 32 hex digits; `run-reviews` accepts that
  form (and the UUID) and maps it back. Deterministic and reversible, so re-exports and review batches find the same
  project. The RL Gym may prefer to accept UUIDs instead; then this is one line.
- **Local run (22 Nov 2026, `apps/api/scripts/local-link-check.ts`, throwaway database, real RL Gym on 8200):**
  Studio's four Golden KYC edge cases (projected as Studio's `praxis_wire` does) validate and are stored; the same
  with Studio's recipe and outcome is refused (`TP_PRIVATE_GRADING_DATA`). Export of a Golden KYC project, qualified
  as `tpl_x5rwt6d5eu` v2, passes the RL Gym's schema, hash, active-template and fingerprint checks and stops at the
  package fetch (`FORGE_UNAVAILABLE`: the RL Gym still fetches packages from its Authoring stub on 8212). It imports
  once the owner points the RL Gym's `RLGYM_FORGE_URL` at this Authoring. 3 of the 4 embedded v8 tasks are not sent
  (`GENERIC_TOOL_UNDECLARED`, as in part 1).

## E-007 phase 2, Authoring part (24 Nov 2026, owner: "Phase 0 to Phase 4 as one Phase")

Source: adi-labs-design `shared/enhancements/E-007-verification-bench.md` §0 and §7, ROADMAP Phase A. Owner constraints:
no template changes, no new Authoring screens, S7's 5/2/0 is the scoring truth.

- **Task checks on a frozen snapshot** (`apps/api/src/tasks/task-integrity.ts`, report `praxis.task-check-report.v1`).
  They run on the content being approved, or on the approved record at Validate and Export. Each problem carries
  section, field, check code, severity, who fixes it (author, PM, template, ADI Forge, RL Gym) and whether trying
  again helps:
  - `STEP_TOOL_NOT_OFFERED`: an S5 step names a tool S3 doesn't offer (a tool the template doesn't declare at all
    stays the existing APR-13d problem, not reported twice);
  - `CRITICAL_WITHOUT_FAILURE`: a critical S7 criterion with no fail condition. A whole-task failure, a "0:" anchor in
    its partial credit (the golden KYC style) or the template's own default counts as one;
  - `S7_MAX_MISMATCH`, `S7_THRESHOLD_OUT_OF_RANGE`, `S7_SCALE_NOT_520`: numbers stated in S7's scoring rule that
    contradict the weights or the 5/2/0 scale. No numbers stated means nothing to contradict;
  - `PRIVATE_IN_AGENT_VIEW`: a private long text (40+ characters), or the task's own benchmark code (edge case,
    archetype, complexity), appears in a field the agent sees. **(chosen by Claude)** A pick-list value shared by a
    public and a private field (a party role) isn't a leak;
  - `UNRESOLVED_CLAUSE`: an S4 citation that doesn't resolve to a clause version approved by the time of approval,
    or to a current policy document of the project rule set;
  - `APPROVAL_STALE`: an approved record on another template version than the project's.
- **Where they run.**
  - Approval: the author's problems join the D18 checks, so the task goes back with them pinned. Anyone else's
    problem stops the approval with a plain message (`NOT_APPROVABLE`).
  - Validate: added to the validator's verdict.
  - Export for benchmark: a failing task isn't sent (`CHECKS_FAILED`, with the problems).
  - JSON: `GET /projects/:id/tasks/:taskId/check-report`.
- **Export receipt** `praxis.export-receipt.v1`, kept with the run (`RlGymProjectExport.authoring_receipt`, not sent).
  - For each task sent: export digest, record content hash, package, snapshot and check-report digests.
  - `receipt_sha256` is the JCS SHA-256 of the receipt. It's unsigned: signing is phase 7.
- **The RL Gym's answer per task.** It's accepted, duplicate (the same revision was received before, or the receipt
  was replayed) or rejected (blocked, or the export refused). **(chosen by Claude)** It's derived in Authoring because
  the RL Gym's receipt gives counts, not a list.
- **Benchmark review bound to the score pass.**
  - Each item shows its run, score pass and evidence digest (the RL Gym's `evidence_sha256`, else the episode's JCS
    SHA-256).
  - A decision sends the pass and digest it saw. Another pass gives `STALE_SCORE_PASS`, other evidence gives
    `EVIDENCE_CHANGED`, and a pass the RL Gym has since re-scored gives `SUPERSEDED_SCORE_PASS`. A decision on an
    older pass never stands for a newer one.
  - Choices are Accept (the score stands: agent failure confirmed), Dispute (task, rubric, grader or environment) or
    Can't assess. **(chosen by Claude)** Can't assess stays in ADI Forge (`kept_in_forge`), since the RL Gym takes
    only its five decisions. The others go with `verdict`, `score_pass` and `evidence_sha256`.

## Owner small-fix path and existing tasks (24 Nov 2026)

- **Owner:** "Keep the existing tasks which I authored." The stronger checks never block tasks approved before them
  (`STRONGER_CHECKS_FROM` = 24 Nov 17:34 UTC, commit 7c12b835):
  - their problems are warnings, with the gap "approved before the stronger checks";
  - they still export and run;
  - the export receipt marks them so;
  - approvals are never back-filled.
- **Owner:** "As long as it's a small fix I can do it myself" (SME time costs about $1000 a day). A PM or Admin corrects
  one field of an approved task on the console task page ("Correct this approved task"), with a reason:
  - every check runs on the corrected content first (submit checks, package check, stronger checks); a failing one
    changes nothing;
  - the correction is the human approval of a new revision: a new submission version, EDIT and ACCEPT reviews, a new
    approved record;
  - the earlier record is kept exactly (append-only); the author keeps authorship; the corrector is the reviewer;
  - the audit event is `task.corrected_after_approval`, with the changed paths;
  - Re-export sends the correction as the next revision (`corrects_revision`);
  - the task's author, or someone with a declared conflict, can't correct it.
- **Before every migration**, a local `pg_dump -Fc` of praxis_authoring_v2 goes to `~/adi-backups/authoring-<timestamp>/`
  (outside the repository). Migrations are additive only.

## E-001 §6b: edge-case families in Authoring (24 Nov 2026)

- **Contract with Studio** (agreed; Studio commits 4d6f712 and 3786a43):
  - Authoring pulls `GET /api/v1/templates/{id}/versions/{v}/edge-case-catalog` (edge-case-catalog.v2: families with
    variants, states, outcomes, outcome_fields). A 404 means Authoring uses the template's S4 edge cases.
  - Authoring holds the batches and writes `POST /api/v1/outcome-requests` (outcome-request.v1: verdict
    confirm/reject/cannot_decide, decision + fields + rationale + evidence, sme-/admin- pseudonyms, `second_check`).
- **Picker.** The SME's Benchmark panel picks a family and either every variant that counts (later ones too) or
  chosen ones.
  - `familyFocus` is stored beside `edgeCase`, so it's additive.
  - Older tasks show their family at read time, and their stored data is never rewritten.
  - Export sends the family's usable variants in `case_selector.edge_cases`. There are no new wire fields, and
    packages are unchanged.
- **Outcome batches** (tables `OutcomeBatch`, `OutcomeBatchItem`, migration 20261208000003, dump taken first):
  - Project → Benchmark → Edge-case outcomes shows the variants waiting for a person's outcome, including migrated
    ones.
  - The PM makes one batch for one SME on the project, or answers it as Admin acting for an SME.
  - The SME answers on the SME app's Edge-case outcomes page, and the bell shows it.
  - The second check is off by default (owner: SME time costs about $1000 a day); the PM can switch it on per batch,
    and then a PM or Admin other than the writer checks it.
  - The batch is written to Studio whole. A failed send keeps every answer, so the PM can send it again.
- **Defaults the owner may change:**
  - b: an outcome is a decision, a rationale and at least one piece of evidence to cite;
  - c: batches count as SME time (reporting only, not built yet);
  - d: variants are set per task, and a run can only narrow them (`narrowForRun`);
  - e: SMEs can add variants (through New edge-case family; adding to an existing family is next).
- **Data safety.**
  - `data-digests` job (counts and content digests of tasks, records, packages, submissions and exports).
  - Test `phase-a-data-safety`: Phase A migrations are additive only.
  - Verified 24 Nov: all digests equal to the coordinator's pre-Phase-A backup after the four migrations.

## D-056: S4 policy ids mapped to the environment's at export (owner, 24 Nov 2026: "4. Yes")

- **Problem.** A task's S4 cites ADI Forge's own id, and the benchmark environment knows its policies by other ids
  (golden-kyc-openenv@12: KYC-01 to KYC-04, GB-02, GB-03, GB-05), so the agent's `policy.read` returns 0 records.
  - All 4 authored tasks in the owner's KYC project cite the bank policy document 54e00852… at rs2.d1, not one rule.
- **Mapping source.** A reviewed file, `apps/api/src/anvil/policy-id-maps.json` (`praxis.policy-id-map.v1`).
  - Keyed by environment version, with each environment policy's text_sha256 (from Studio's @12 note: its rows have
    no version or content hash). It applies to the Studio template releases listed in `applies_to`
    (tpl_x5rwt6d5eu v8).
  - Entries map at document level, which is what the tasks cite. Rule-level entries are optional. Each entry has a
    reason, and `confirmed_by` stays null until the owner confirms it (mechanical, no SME time).
  - Proposed by meaning from rule set v2's approved texts. The APR-04 rule-clause map is not available in this repo.
    - 4 of the 11 rules map. 7 have no clear match and stay flagged.
    - The document maps to KYC-02, GB-02, KYC-03 and GB-05.
- **Export only (coordinator: option 1).** Each task entry gains `policy_id_map` only for citations with a confirmed
  match: `{environment_version: "golden-kyc-openenv@12", map: {"<source id>": [env ids]}, policies: {id: {content_sha256}}, source_sha256}`,
    the RL Gym's accepted shape (fde41cf). content_sha256 is Studio's text_sha256.
  - The RL Gym applies it at reset.
  - The stored task, its approvals, its package (same hash) and earlier exports are unchanged.
  - A task with no confirmed mapping exports exactly as before.
- **Never guessed.** These cases are flagged as `POLICY_ID_UNMAPPED` and left out of the map:
  - a citation with no entry;
  - a citation at another content hash;
  - an entry that is not confirmed;
  - an entry with no clear match;
  - an id the environment does not declare.
  - Validate shows the flag as a warning owned by ADI Forge support. The export run lists it per task in
    `policyIdsUnmapped`, and the RL Gym panel shows it. It does not block.
