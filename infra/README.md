# Deploying ADI Praxis to Google Cloud (M8)

Everything is Terraform (`infra/terraform`) and GitHub Actions (`.github/workflows`). Nothing is created by hand in the console. This milestone ships the code only: nothing has been applied or pushed.

## Layout

| Path | What |
| --- | --- |
| `terraform/bootstrap` | One-time per project: the versioned state bucket (local state). |
| `terraform/modules/*` | One module per concern: `network`, `database`, `redis`, `storage`, `iam`, `registry`, `run-services`, `edge`, `monitoring`; `platform` composes them. |
| `terraform/envs/staging`, `terraform/envs/production` | Thin roots with each environment's settings (staging: single-zone SQL, Basic Redis, min instances 0; production: HA SQL, Standard Redis, min instances per SPEC). |

## First deployment of an environment

1. Create the GCP project (`adi-praxis-staging` or `adi-praxis-prod`) and link billing.
2. `terraform -chdir=infra/terraform/bootstrap init && terraform -chdir=infra/terraform/bootstrap apply -var project_id=<project>`.
3. Copy `envs/<env>/terraform.tfvars.example` to `terraform.tfvars` (git-ignored) and set the repository, domains and alert emails. Pass secret values as `TF_VAR_app_secret_values='{"stripe-secret-key":"…",…}'` rather than in files. Every secret needs a value on the first apply, because Cloud Run reads its `latest` version (use a placeholder for one you do not use yet, such as `rl-gym-webhook-secret`); after that Terraform ignores the values, so later plans need none. Rotate a secret with `gcloud secrets versions add`.
4. `terraform -chdir=infra/terraform/envs/<env> init && terraform -chdir=infra/terraform/envs/<env> apply`. Services start on a placeholder image.
5. Point DNS for the three hostnames at the `load_balancer_ip` output; the managed certificate activates once DNS resolves.
6. In GitHub, set repository variables `GCP_REGION`, `GCP_PROJECT_<ENV>`, `GCP_WIF_PROVIDER_<ENV>`, `GCP_DEPLOYER_SA_<ENV>`, `GCP_PLANNER_SA_<ENV>` and `DOMAINS_<ENV>` (a Terraform object, for example `{console="app.example.com",candidate="experts.example.com",api="api.example.com"}`), all from the Terraform outputs. Also set the `E2E_WEB_URL`/`E2E_CANDIDATE_URL` variables and `E2E_*` secrets on each GitHub environment. Protect the `production` environment with required reviewers.
   Also add a repository secret `TFVARS_<ENV>` holding your `terraform.tfvars` without `app_secret_values` (`alert_emails`, `billing_account`, `smtp`, `rl_gym_webhook_url`). Pull-request plans and the weekly drift check read it; without it they plan to remove the budget, the alert emails and the SMTP settings. It is a secret, not a variable, because the repository is public. A plan prints values only for resources that would change, so keep it in step with `terraform.tfvars`.
7. Merge to `main` (staging) or push a `v*` tag (production). The workflow builds images, runs `praxis-migrate`, deploys and runs the smoke tests.
8. Create the first Admin once: `gcloud run jobs execute praxis-migrate --region <region> --args=src/jobs/run.ts,seed --update-env-vars SEED_ADMIN_EMAIL=…,SEED_ADMIN_PASSWORD=…`. It uses the same image and the migration role.

## Day to day

- **Pull request:** typecheck, unit and integration tests (docker compose), Playwright smoke tests, container builds, and `terraform plan` for changed infrastructure (read-only planner identity).
- **Merge to `main`:** nothing deploys automatically. `main` reaches **QA** on the nightly build (and on demand) and **staging** on the weekly build (Saturday 12:00 CST, and on demand). See `docs/ops/DEPLOYMENT-PIPELINE.md`.
- **QA:** the existing test project (`TEST_GCP_PROJECT`). Pause the scheduled build with `NIGHTLY_ENABLED=false` or `/nightly off`; run it on demand with Actions → Nightly build → Run workflow.
- **Staging:** weekly or on demand (Actions → Deploy staging → Run workflow); both deploy current `main`.
- **Production:** the **Production agent** promotes the build already running on QA or staging (`/production deploy from qa|staging`), behind the `production` environment's required reviewers. It never rebuilds from a branch. Tag `v*` still runs the canary release.
- **Tag `v*`:** needs approval, then migrations, new revisions with no traffic, 10% canary, smoke tests, and 100%. Any failure shifts traffic back.
- **Rollback:** the **Roll back** workflow moves every service to the previous revision in one step. Migrations are written to stay backward-compatible for one release.
- **Drift:** a weekly `terraform plan -detailed-exitcode` fails if anything changed outside Terraform.

## Security notes

- The app connects as `praxis_app`, which the migrate job grants only what it needs. It has no `UPDATE`/`DELETE`/`TRUNCATE` on `ApprovedTaskRecord`, `RLReviewRecord`, `AuditEvent`, `SelectionDecision` or `TaskReview`, and no DDL. Database triggers block those statements too. `praxis_migrator` owns the schema.
- Cloud SQL, Memorystore and the private buckets have no public address. Only `brand` is public. Outbound traffic leaves through Cloud NAT with a fixed IP (`nat_ip` output).
- GitHub authenticates through Workload Identity Federation limited to this repository; no service-account keys exist.
- The nightly hash-chain check runs as the `praxis-verify-chains` job from Cloud Scheduler. A break logs `alert: true` and pages through the "hash chain broken" alert.
