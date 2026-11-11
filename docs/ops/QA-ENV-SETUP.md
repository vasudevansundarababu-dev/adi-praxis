# QA environment setup for authoring v2.1 waves

Status: **in progress** (started 10 Nov 2026). Owner walks through each step with the DevOps agent; this file records
what was checked, what was configured and what is still open. No secret values are written here.

QA = the existing test project `adi-praxis-test-0928` (project number 742785092638, us-central1). It is deployed by
`infra/demo/deploy-demo.sh` (from the **Nightly build** workflow or by hand), not by the Terraform in
`infra/terraform` (that covers staging and production only).

## 1. What is there today (checked 10 Nov 2026, read-only)

| Item | State |
| --- | --- |
| Project, billing | Active, billing linked |
| Cloud Run services | `praxis-api`, `praxis-worker`, `praxis-web`, `praxis-candidate` ready, build `nightly-20261110-79a8a9e` (`APP_ENV=demo`) |
| Cloud Run jobs | `praxis-migrate` (succeeds), `praxis-demo-setup` (**fails**, see open item O1) |
| APIs | Vertex AI (`aiplatform`), Run, SQL, Redis, Secret Manager enabled. **Document AI not enabled.** |
| Runtime service account `praxis-demo-run` | `aiplatform.user`, `cloudsql.client`, `secretmanager.secretAccessor`, `logging.logWriter`, `monitoring.metricWriter` |
| Vertex wiring | `VERTEX_PROJECT_ID=adi-praxis-test-0928`, `VERTEX_LOCATION=global` on the API and worker |
| Spend caps in the app | None set (`deploy-demo.sh` passes no caps) |
| Billing budget | "Bugdet Alert For Praxis", 1000 USD, this project but one service only; from 10 Nov also "PraxisQA All Services", 500 USD, all services |
| Secrets | Database, Redis, mock secret, demo passwords. **No `llamaextract-api-key`.** |
| GitHub wiring | `TEST_GCP_PROJECT`, `TEST_WIF_PROVIDER`, `TEST_DEPLOYER_SA`, `NIGHTLY_ENABLED=true` set |
| Last Nightly build | Run 42757420232: CI green, deploy red at the demo-data step (O1) |

## 2. What authoring v2.1 adds (branch `feat/authoring-v21`, from the code session)

| Setting (non-secret) | Default | Purpose |
| --- | --- | --- |
| `AUTHORING_MODEL` | `claude-opus-5` | The chatbot facilitator's model on Vertex. Needs Model Garden access in QA. |
| `AUTHORING_DAILY_CALL_CAP` | `300` | Chatbot calls per client per UTC day; over the cap the API answers 429 `MODEL_DAILY_CAP`. |
| `VERTEX_PROJECT_ID` / `VERTEX_LOCATION` | already set | Switch live mode on (blank = mock). |
| `EMBEDDING_LOCATION` / `EMBEDDING_MODEL` | already set / `text-embedding-005` | Embeddings; also used by the smoke check. |

- **Migration:** `20261111000000_authoring_v21_modes` (`Template.agent_mode`, `Project.review_route`). The QA deploy
  already runs `praxis-migrate` before the services, so it is applied on the first wave deploy.
- **Smoke check (two small billed calls; owner says yes first):**
  `pnpm --filter @praxis/api exec tsx scripts/vertex-smoke.ts`, run inside QA as a one-off Cloud Run job on the API
  image with the runtime service account. Prints model, latency and dimensions only. Exit 0 = live chatbot and
  embedding calls worked; 2 = mock mode (`VERTEX_PROJECT_ID` not set); 1 = a call failed.
- **Admin check:** `GET /api/v1/admin/model-providers` in the console must show mode `vertex`, the configured models
  and today's chatbot calls against the cap.
- **Usage logging:** every live call writes one structured log line with event `llm.call` (model, latency, tokens;
  no prompt text). Suggested: a log-based metric on `llm.call` with an alert, alongside the billing budget.

## 3. Steps

| # | Step | Status |
| --- | --- | --- |
| 1 | How a wave build reaches QA | **Decided 10 Nov: option A.** Develop and test on `feat/authoring-v21`, PR to `main` (CI green, owner approves), then the Nightly build (or Run workflow / `/qa deploy`) deploys `main` to QA. Pipeline unchanged. |
| 2 | Vertex: Model Garden access for `AUTHORING_MODEL` (Claude) and Gemini, quota | **In progress.** Owner chose Claude Sonnet 5.5 (`claude-sonnet-5-5`) for the chatbot, Haiku 5.5 as the cheap backup, instead of Opus 5. Sonnet enabled in Model Garden (10 Nov). Claude quota was 0 for every model (`global_online_prediction_requests_per_base_model`, all `anthropic-*` base models), so live calls returned 429. Increase to 30/min filed 10 Nov for `anthropic-claude-sonnet`, `anthropic-claude-haiku` and `anthropic-count-tokens` (Cloud Quotas preferences `praxis-qa-*`); waiting for Google. |
| 3 | Caps: deployer passes `AUTHORING_MODEL` and `AUTHORING_DAILY_CALL_CAP`; `llm.call` metric and alert; Vertex budget | **Deployer done (local commit, 10 Nov):** `infra/demo/deploy-demo.sh` with `PRAXIS_VERTEX=1` sets `AUTHORING_MODEL=claude-sonnet-5-5` and `AUTHORING_DAILY_CALL_CAP=300` (both overridable) and deploys, never runs, job `praxis-vertex-smoke` when the build contains `apps/api/scripts/vertex-smoke.ts`. **Budget done (10 Nov):** owner created "PraxisQA All Services", 500 USD/month on My Billing Account, QA project only, all services, alerts at 50/90/100%. (The older 1000 USD QA budget counts one service only.) Optional later: an `llm.call` log metric and alert. |
| 4 | Policy extraction in QA: Document AI layout parser, LlamaExtract key slot | Open (blocked by O2) |
| 5 | Migrations (incl. `20261111000000_authoring_v21_modes`) and seed, catalogue templates | Open |
| 6 | First wave deploy on the owner's go; smoke job (exit 0); admin check shows `vertex` | Open |
| 7 | Clean up old projects and budgets (owner, after steps 1–6) | Open. See section 5. |

## 4. Open items

- **O1 — demo-data job fails on re-run.** `demo-setup` looked projects up as the demo PM, who sees only their own
  projects, so it missed "SYNTHETIC TEST — Harbor marketing decisions" and got 409. **Fixed on `feat/authoring-v21`**
  (looks up as Admin, with a regression test). Not yet on `main`; reaches QA with the Wave 1 PR.
- **O2 — live policy extraction is refused in QA.** The app allows `POLICY_EXTRACTION_LIVE` only when
  `APP_ENV=staging`, and QA runs `APP_ENV=demo`. The Terraform `policy-extraction` module (PRs #36, #37) has the same
  staging-only rule and is not applied to QA. Needs an owner decision and a code change.
- **O3 — app caps in QA.** Done in the deployer (step 3); live from the first wave deploy. The change must reach `main`
  (its own PR, or with Wave 1) before the Nightly build uses it.
- **O4 — smoke job.** `praxis-vertex-smoke` is deployed by the deployer; run it only on the owner's yes:
  `gcloud run jobs execute praxis-vertex-smoke --region us-central1 --wait` (exit 0 live, 2 mock, 1 a call failed).
- **O5 — chatbot model.** Done on `feat/authoring-v21` (commit 1f96d1db): `AUTHORING_MODEL` defaults to
  `claude-sonnet-5-5`; the request sends no thinking, tool_choice or sampling settings, and a test pins that shape for
  Sonnet 5.5 and Haiku 5.5. Open owner decision: Sonnet 5.5 runs at its default effort (high); a lower effort would
  cut QA cost at some cost in chatbot quality.
- **O6 — Claude quota DENIED (10 Nov, blocks the live chatbot).** Google denied the 30/min requests for
  `anthropic-claude-sonnet` and `anthropic-claude-haiku` within seconds (automatic denial, `stateDetail: Quota request
  denied`); `anthropic-count-tokens` still pending. Claude quota is 0 in every project (QA, staging, demo, Anvil), so
  no project can call Claude on Vertex today. Needs an owner decision: appeal to Google and/or a non-Claude path for
  the chatbot.

## 5. Step 7: clean up (owner, after the QA setup is finished)

The owner removes projects no longer needed. Nothing is deleted by an agent. Projects found on 10 Nov 2026:

| Project | Billing account | Keep? |
| --- | --- | --- |
| `adi-praxis-test-0928` (QA) | My Billing Account | **Keep** — QA for the waves |
| `adi-praxis-staging` | Praxis-Billing | **Keep** — weekly staging |
| `adi-praxis-prod` | Praxis-Billing | **Keep** — production |
| `adi-praxis-demo-0927` (old click-through demo, ~110–130 USD/month) | My Billing Account | Candidate to delete — owner decides |
| `adi-anvil-mvp-2026`, `gen-lang-client-0032350917` (Anvil) | — | Anvil's, not Praxis's — owner decides separately |

Also tidy budgets: the "Budget Alert For Vertex API" (500 USD) watches only the demo project, so delete or repoint it if
the demo project goes. QA should keep an all-services budget on My Billing Account.

**Is the demo project still used? (checked 10 Nov 2026, read-only)**

- Real visits to the console or API: last on **31 Oct** (about 60 requests) and **7 Nov** (about 450 requests).
  Nothing since then except the background worker running on its own.
- No GitHub workflow, variable, secret or environment uses it.
- Only documents mention it: `docs/user-guide/01-getting-started.md`, `docs/user-guide/ROLES-AND-ADMIN.md`,
  `docs/user-guide/VIDEOS.md`, `e2e/demo-videos/run.sh` (in `adi-praxis`, copied into `adi-praxis-testing`). Update
  these when the project is deleted. `adi-anvil` and `adi-autonomous-qa` do not mention it.
- The `@praxis.demo` logins are the shared demo accounts and also exist in QA, so they are not a reason to keep it.

Deleting a project (`gcloud projects delete <id>`, or IAM & Admin → Manage resources) stops its billing and can be
undone for 30 days. Before deleting the demo project, check nothing still points at its URLs (handbook artifact, tester
emails).
