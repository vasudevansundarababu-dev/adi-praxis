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
