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
| Billing budget | "Bugdet Alert For Praxis", 1000 USD, scoped to this project |
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
| 3 | Caps: deployer passes `AUTHORING_MODEL` and `AUTHORING_DAILY_CALL_CAP`; `llm.call` metric and alert; Vertex budget | Open |
| 4 | Policy extraction in QA: Document AI layout parser, LlamaExtract key slot | Open (blocked by O2) |
| 5 | Migrations (incl. `20261111000000_authoring_v21_modes`) and seed, catalogue templates | Open |
| 6 | First wave deploy on the owner's go; smoke job (exit 0); admin check shows `vertex` | Open |

## 4. Open items

- **O1 — demo-data job fails on re-run.** `demo-setup` looked projects up as the demo PM, who sees only their own
  projects, so it missed "SYNTHETIC TEST — Harbor marketing decisions" and got 409. **Fixed on `feat/authoring-v21`**
  (looks up as Admin, with a regression test). Not yet on `main`; reaches QA with the Wave 1 PR.
- **O2 — live policy extraction is refused in QA.** The app allows `POLICY_EXTRACTION_LIVE` only when
  `APP_ENV=staging`, and QA runs `APP_ENV=demo`. The Terraform `policy-extraction` module (PRs #36, #37) has the same
  staging-only rule and is not applied to QA. Needs an owner decision and a code change.
- **O3 — no app spend caps in QA.** `infra/demo/deploy-demo.sh` must pass `AUTHORING_MODEL` and
  `AUTHORING_DAILY_CALL_CAP` (names now fixed by the code session). Infra change, made on the owner's go.
- **O5 — chatbot model.** `AUTHORING_MODEL` defaults to `claude-opus-5`; QA will set `claude-sonnet-5-5`. The code
  session must confirm the chatbot's request shape works on Sonnet 5.5 (it rejects `thinking: disabled`).
- **O6 — Claude quota.** Waiting for Google to grant the three increases above. Check: Cloud Quotas preference
  `praxis-qa-anthropic-claude-sonnet` shows granted value 30.
- **O4 — smoke job.** A `praxis-vertex-smoke` Cloud Run job (API image, runtime service account) to run the smoke
  check on demand. Added to the deployer with O3; executed only when the owner says yes.
