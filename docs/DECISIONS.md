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
