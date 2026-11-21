# First-principles code review — 20 Nov 2026

Scope: all of `main` at 40aa67c9 plus branch `fix/env-images-first-principles` (35b981ab): `apps/api`, `packages/shared`,
`apps/api/prisma`, `apps/web`, `apps/candidate`, `infra`, `.github`, Dockerfiles. Six reviewers read one area each; every
finding marked **✔** below was re-checked against the code by the lead reviewer. Others are reported with file:line
evidence but not independently re-run. Nothing outside the grading image has been changed yet.

Severity: **P0** = fix before any external tester / live money / real candidates. **P1** = fix this cycle. **P2** = backlog.

---

## Already fixed on this branch (environment images)

| What | Status |
|---|---|
| Sandbox loopback (127.0.0.1) was down in the grading netns; now brought up and checked by a real bind+connect, logged `loopback=up/down` | Fixed, e2e 18/18 |
| `verify-docker.ts` built an unpinned ad-hoc image under the same tag as the DockerRunner | Fixed: builds `infra/harbor-verify/Dockerfile` |
| Grading image had no build-time runtime check | Fixed: `pip check`, bash, pytest version, grader imports |
| DockerRunner scored by pass ratio with `sh`, no reward reset, no `--noconftest` | Fixed; **still not identical** to `grade.py` (single uid, writable verifiers) — see E1 |

Open item: whether Cloud Run gen2 grants `CAP_NET_ADMIN` (loopback up) is unverified; the first staging grading log shows it.

### Batch A (same branch, 20 Nov) — decisions in docs/DECISIONS.md "Batch A"

| Finding | Status |
|---|---|
| E0 placeholder generators in production | **Fixed**: real shared generators + C3 bundle builder; placeholders deleted; startup refuses substituted deps with a real runner. Surfaced and fixed two bugs the placeholders hid: studio title rejected as "unknown field"; stored `taskJson` had `task: null` (now read from the bundle). |
| E1 (runner half) DockerRunner ≠ production | **Fixed**: DockerRunner runs `grade.py` itself (local mode). New CI step grades the same bundles through it (`scripts/harbor-docker-runner-e2e.ts`). Surfaced: home reset silently failed without DAC_OVERRIDE → now fails closed. |
| E1 (evidence half) agent-writable `env_state.json` | **Open — owner + RL Gym decision** (runtime contract; see DECISIONS.md). |
| I4 rollback picks wrong revision | **Fixed**: record-then-restore (`infra/deploy/cloud-run-state.sh`, CI-tested with fake gcloud). |
| I5 grading image not promoted / not rolled back | **Fixed** for release and staging promotion; QA promotion keeps prod's grader and says so (QA has no grading job). |
| I6 promotion by mutable tag | **Fixed** for services (digest of serving revision). |
| I7 web image missing `public/` | **Fixed**, verified: PDF served 200 from the built image. |
| I10 netns overridable per execution; dead userns fallback | **Fixed**: job mode always requires netns; fallback removed. Restricted Google APIs egress still open (Batch C, Terraform). |
| grade.py robustness (gzip bomb, bad tar, duplicate entries, download errors) | **Fixed**: clean grading errors, 200 MB decompression cap. |

---

## P0 — fix first

| # | Area | Finding | Evidence | Fix |
|---|---|---|---|---|
| E0 ✔ | Environments | **Production builds task environments with the TEMPORARY placeholder generators.** `resolveDeps()` defaults to `temporaryDeps`; verifiers are `assert True` with no fixture and no reward write, so real (job/docker) runners score every bundle 0.00; dropzone paths not validated (SME input can overwrite `eval/`/`solution/`); tar names >100 bytes truncated; no judge files. | `meta-compiler/deps.ts:154-164`, `app.ts:349,381`, `worker.ts:44` | Default `resolveDeps` to the shared `generateArtifacts`/`studioSteps`/`studioAnswerProblems` + `harbor/bundle.ts buildBundle`; keep temp deps for tests only; startup check that refuses temp deps when `HARBOR_RUNNER != mock`. |
| E1 | Environments | **Agent can forge graded evidence.** Verifiers score from `var/lib/harbor/env_state.json`, writable by task code. | `generate/mcp-mock.ts:93-98`, `verifiers.ts:140-152`, `grade.py WRITABLE_DIRS` | Run the MCP mock as a separate uid/process owning the state file; agent talks to it over loopback (enabled on this branch) or stdio pipe. Also: run `grade.py` itself in DockerRunner (local-file mode) so local == prod. |
| P1-pay ✔ | Payments | **Pay run can pay twice.** Status read unlocked → Trolley call → lock afterwards; no Idempotency-Key; Trolley adapter creates a new batch each call. Plus: payments missing from the create response are marked FAILED and re-paid next week. | `pay/payruns.ts:145-171`, `pay/provider.ts:193-201`, `routes/payments.ts:148` | APPROVED→SUBMITTING conditional claim before the call; persist batch key; adapter looks up existing batch by key; missing ref = unknown, resolved by `externalId` lookup; block cancel while SUBMITTING. Re-check holds at submit. |
| R1 ✔ | Review | **Two reviewers can both accept one task** → two dataset records, two `task.accepted`, double earning. | `tasks/review-service.ts:82-88,183` (no lock) | `lock(tx, taskId)` first; conditional `updateMany` on status+revision; partial unique index on `ApprovedTaskRecord(task_instance_id) WHERE supersedes_id IS NULL`. |
| R2 ✔ | Review | **Admin can approve own task** on the one-step route. | `tasks/review-service.ts:64` | Remove the Admin exemption (stage route already forbids it). |
| D1 ✔ | Dataset | **Append-only bypassable by the app's own DB role**: TRUNCATE guarded only by a GUC any session can set; app connects as table owner (can disable triggers). | `migrations/20260927090000_m6_append_only/migration.sql:17-32` | Separate migration-owner role; runtime role gets INSERT+SELECT only; test truncation keyed on a dedicated test role, not a GUC. |
| D2 ✔ | Dataset | **Corrections can fork the chain**: no unique on `supersedes_id`/`prev_hash` (ApprovedTaskRecord), no FK/unique on RLReviewRecord supersession. | `schema.prisma:1037,1124`; `routes/dataset.ts:151` | Partial unique indexes (also fixes missing lookup indexes). |
| A1 ✔ | Auth/config | **Mock sign-in reachable outside local**: `/auth/dev/google-token` registered whenever the Google mock is active; production guards key on `NODE_ENV` (defaults `development`), not `APP_ENV`; `COOKIE_SECURE` defaults false. | `routes/candidate-auth.ts:287-295`, `config.ts:6,21,33,268` | Dev routes only when `appEnv==='local'`/test; derive "deployed" from `APP_ENV`, make it required; refuse default `MOCK_SECRET` and insecure cookies when deployed. |
| C1 ✔ | Certification | **Ordering questions leak the answer** (ids assigned in correct order before shuffle). | `cert/generator.ts:395` | Shuffle first, then assign ids; crypto shuffle. |
| C2 | Certification | Selfie check not tied to the account's verified identity (stand-in can sit the test). Concurrent starts bypass attempt limit. | `cert/selfie.ts:22-35`, `cert/attempts.ts:146-164` | Compare name+DOB of new vs original Stripe session in memory (nothing stored); lock-then-read + conditional increment. |
| S1 ✔ | Web | **Support Bot sends one-time API keys, partner secrets and form PII to the LLM** (`role="status"` text + field values, no redaction). | `components/support/support-bot.tsx:55-69`, `api-clients.tsx:49`, `secret-once.tsx:17`, `api/routes/support.ts` | `data-sensitive` opt-out honoured by `describeScreen`; skip email/tel values; server-side redaction as defence in depth. |
| I1 ✔ | CI/IAM | **WIF trusts the whole repo**: any workflow on any branch can impersonate `praxis-deployer` (run.admin + actAs on secret-holding SAs) — bypasses the production reviewer gate. | `infra/terraform/modules/iam/main.tf:146,155,198` | Bind deployer to `attribute.environment/production` + `repository_id`; planner to its own subject. |
| I2 | CI/IAM | **PR `terraform plan` can print any secret into public logs** (planner has project-wide `secretAccessor` + state `objectAdmin`; tfvars written on PRs). | `.github/workflows/ci.yml:101-143`, `iam/main.tf:168,189` | Plans only from protected refs/env; drop secretAccessor; state `objectViewer`; no prod plans on PRs. |
| I3 | CI | **Nightly agent: prompt injection → deploy-capable credentials** (`Bash(pnpm:*)`/`git:*` ≈ arbitrary exec, `actions: write`, OIDC token). | `.github/workflows/nightly-agent.yml:17-22,89-132` | Exact command allowlist; drop `actions: write`; agent-only WIF subject; branch rules on environments. |

## P1 — this cycle

| # | Finding | Evidence |
|---|---|---|
| I4 ✔ | Auto-rollback on *any* failure picks the 2nd-newest revision → can silently drop prod back a release (e.g. failed migration). | `release.yml:85-91`, `production-agent.yml:129-135` |
| I5 ✔ | Production promotion never updates `praxis-harbor-verify`; QA has no grading job; rollback ignores job images. | `production-agent.yml` (no harbor), `infra/demo/cloudbuild.yaml` |
| I6 | Promotion deploys a mutable cross-project tag, not a digest. | `production-agent.yml:54-57` |
| I7 ✔ | Web image omits `apps/web/public` → template-instruction PDFs 404 when deployed. | `apps/web/Dockerfile:23-26` |
| I8 | Canary smoke tests hit the load balancer (90% old revision), not the rc tag. | `release.yml:57-77` |
| I9 | Deploy workflows build any ref on dispatch; tag releases run no tests; actions pinned to mutable tags; Node bases unpinned and images rebuilt on deploy (tested ≠ deployed). | `deploy-staging.yml`, `release.yml`, `apps/*/Dockerfile:3` |
| I10 | Sandbox VPC reaches all `*.googleapis.com` (exfil channel if netns ever off); `HARBOR_REQUIRE_NETNS` overridable per execution; userns fallback in `grade.py` is dead code (fails closed). | `harbor-sandbox/main.tf:18-31`, `grade.py` |
| T1 | Partner webhooks: SSRF to localhost/private/metadata; raw errors returned to partner. | `supply/partners.ts:26`, `supply/webhooks.ts:35` |
| T2 | External/paid calls inside 15 s transactions: project export (Anvil), rubric AI, Stripe identity, reset/invite email, campaign close. | `project-export.ts:142`, `rubric/service.ts:437`, `candidate-auth.ts:184`, `submissions.ts:81` |
| T3 | Paid model call before Idempotency-Key validation bypasses daily budget. | `routes/meta-compiler-assistant.ts:101-133` |
| T4 | Outbox events that exhaust 8 retries are lost (no dead-letter sweep/alert). | `outbox/dispatcher.ts:12-42` |
| T5 | Payment routes, sign-in/out lack `runCommand` idempotency/audit. | `routes/payments.ts:148-219`, `auth.ts:30-56` |
| T6 | Field suggestions ignore human-authorship-only projects. | `tasks/suggestions/service.ts:60` |
| T7 | Raw uploads kept even when likely real IDs/IBANs detected (conflicts with "ID numbers never stored"). | `tasks/drafting/service.ts:70-75`, `policy/proposals.ts:50` |
| T8 | Guardrails dodged by nesting/formatting (`"$50,000"`, nested dicts); empty CONTAINS_ANY term hard-fails every task. | `generate/verifiers.ts:155-202`, `blueprint/schema.ts:122` |
| T9 | Studio registration mutates a process-wide, cross-tenant registry. | `meta-compiler/studio.ts:57-61` |
| T10 | Cert: regenerating without tier overwrites published tiers; submission not atomic and one Vertex error stalls the hourly sweep. | `cert/pipeline.ts:150`, `cert/attempts.ts:215-252,399` |
| T11 | Selection: two reviewers can record conflicting decisions; assessment can stick in EVALUATING forever. | `candidate/selection-service.ts:31,130-178` |
| T12 | Anvil-rejected package reports untouched tasks as `valid`. | `anvil/validator.ts:245` |
| T13 | Supply: one SME can end with two candidate records → lost earnings/certifications. | `supply/submissions.ts:268-278` |
| W1 | No `error.tsx`/`not-found.tsx` in either app; server fetches throw → unbranded crash page. | `apps/*/lib/api.ts` |
| W2 | Test player loses last answer if submitted during autosave; deadline auto-submit retries every second. | `cert/test-player.tsx:52-71,138-165` |
| W3 | Client idempotency keys regenerated per call (comment claims retry safety). | `web/lib/client-api.ts:13-20`, `candidate/lib/client.ts` |
| W4 | Internal names visible: "Anvil-ready", `Praxis-Signature` header, `ADI-Praxis-*-Guide.pdf` + PDF titles, "ADI ADI Forge" typo, Trolley batch "Praxis pay run", candidate text "Praxis never sees…". | see reviewer list |

## P2 — backlog (summarised)

CSP allows `'unsafe-inline'`, no `media-src` (external tutorial videos blocked); unvalidated route params into API paths;
invites auto-redeemed on page load; worker `setInterval` unhandled rejection; client `x-request-id` trusted into audit;
N+1 queries (partner portal, campaigns, profiles); embedding calls without timeout; SDK default 10-min timeout + 2 silent
paid retries on judge/drafter; Cloud Run execution not cancelled on runner deadline; jobs re-claim RUNNING runs;
non-expiring API keys by default; QA cleanup jobs refuse only `production`; Artifact Registry tags mutable and cleanup
deletes nothing; `.dockerignore` misses nested `.env*` and `*.tfvars`; Cloud SQL lacks API-level deletion protection;
shared CI concurrency group cancels deploys; currency-mixed second-approval threshold; MCP mock accepts NaN and its serve
loop crashes on non-object JSON; `pyLines` splits on U+2028; trajectory URL accepts any scheme; future-dated migration names.

## Decisions only the owner can make

1. **Licence number + certificate scan** are stored in plain JSON/storage (`cert/attempts.ts:380`, `schema.prisma:2426`).
   SME-SUPPLY.md asks for the check, but it sits next to "ID numbers/images never stored". Keep (encrypt, scan, delete
   after decision) or store only a verification reference?
2. **SME can disable every guardrail**, including `no_identity_numbers` / `no_tipping_off` (`answers.ts:55`). Intended,
   or add `sme_toggleable` (default false)?
3. **Uploads with detected real identifiers**: refuse at intake, or keep only the redacted text?

## Comments

Reviewers listed ~58 specific places where a WHY comment is missing (e.g. `platform/command.ts:168` actor-id prefixes,
`outbox/dispatcher.ts:36-42` enqueue-before-commit safety, `pay/payruns.ts:51` the `periodStart - 1ms` hack,
`grade.py` byte multipliers). Several "missing comment" sites are actually bugs (`cert/generator.ts:395`,
`dataset/verify.ts:32`, `review-service.ts:64`), so comments go in with each fix, not as a blanket pass.

## Recommended order

1. **Batch A — environments (E0, E1, I5, I7)**: real generators in production, mock-owned state, DockerRunner runs
   `grade.py`, promote/rollback the grading image, web `public/`. Directly continues this branch.
2. **Batch B — money & dataset integrity (P1-pay, R1, R2, D1, D2, T5)**.
3. **Batch C — secrets & identity (A1, S1, I1, I2, I3, T1)** — I1–I3 change IAM/Terraform and need an operator apply.
4. **Batch D — certification (C1, C2, T10)**, then P1 remainder, then P2.

Each batch: tests for every finding, one PR, fixed in `main` and `release/1.0` per docs/RELEASES.md.
