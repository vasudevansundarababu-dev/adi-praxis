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

## 2. Steps

| # | Step | Status |
| --- | --- | --- |
| 1 | How a wave build reaches QA (branch build or PR to `main`) | Waiting for owner |
| 2 | Vertex: Model Garden access for Claude and Gemini, quota, smoke call | Open |
| 3 | Spend caps: app caps passed by the deployer, Vertex budget alert | Open |
| 4 | Policy extraction in QA: Document AI layout parser, LlamaExtract key slot | Open (blocked by O2) |
| 5 | Migrations and seed, catalogue templates | Open |
| 6 | First wave deploy on the owner's go, smoke check | Open |

## 3. Open items

- **O1 — demo-data job fails on re-run.** `demo-setup` tries to create "SYNTHETIC TEST — Harbor marketing decisions"
  again and gets 409. Application code; passed to the authoring v2.1 code session.
- **O2 — live policy extraction is refused in QA.** The app allows `POLICY_EXTRACTION_LIVE` only when
  `APP_ENV=staging`, and QA runs `APP_ENV=demo`. The Terraform `policy-extraction` module (PRs #36, #37) has the same
  staging-only rule and is not applied to QA. Needs an owner decision and a code change.
- **O3 — no app spend caps in QA.** The deployer must pass the caps the authoring chatbot and planner read, once the
  code session fixes their names.
