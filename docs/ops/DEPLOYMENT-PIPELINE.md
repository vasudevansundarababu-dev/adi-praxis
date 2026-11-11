# Deployment pipeline and agents

Owner-approved ground rules for how code reaches each environment, and the agents that carry it there.
Status: **agreed 10 Nov 2026**. This document is the contract; the wall version is [WALL-CHEATSHEET.md](WALL-CHEATSHEET.md).

## 1. The rule in one sentence

Only `main` is deployable. `main` reaches **QA** nightly, **Staging** weekly, and **Production** never
automatically — production happens only when the owner approves or explicitly invokes the Production agent.

## 2. The pipeline

```
feature branch ──► local server + unit tests ──► PR ──► CI green ──► main
                                                                      │
                        ┌─────────────────────────────────────────────┤
                        ▼                                             ▼
              Nightly build → QA                        Weekly build (Sat 12:00 CST) → Staging
              (also: on-demand QA)                      (also: on-demand Staging)
                        │                                             │
                        └──────────────────┬──────────────────────────┘
                                           ▼
                             Production agent (owner approval or invocation)
                             "deploy the build running on QA|Staging to production"
```

| Environment | GCP project | Reached by | Automatic? |
| --- | --- | --- | --- |
| **QA** (= existing *test*) | `adi-praxis-test-0928` | Nightly build, or on-demand QA build | Nightly is automatic while enabled |
| **Staging** | `adi-praxis-staging` | Weekly build (Saturday 12:00 CST), or on-demand Staging build | Weekly is automatic |
| **Production** | `adi-praxis-prod` | Production agent only | **Never** |

## 3. Stage by stage

### 3.1 Feature branch (before `main`)

Every branch is proven before it reaches `main`:

- Run the app locally: `pnpm services:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`.
- Run the tests: `pnpm -r typecheck` and `pnpm test` (API integration tests use real PostgreSQL and Redis
  through docker compose, as CI does).
- The DevOps agent runs the same branch on a local server plus the full unit/integration suite before it
  opens or pushes the PR.

### 3.2 Pull request → `main`

- `main` is protected: a green PR is required and direct pushes are refused.
- CI (`.github/workflows/ci.yml`) runs on every pull request: typecheck, unit and integration tests
  (real Postgres + Redis), Playwright smoke tests, container builds, and `terraform plan` when
  infrastructure changes.
- Merge only after CI is green and the owner has approved.

### 3.3 QA (nightly, and on demand)

- Workflow: **Nightly build** (`.github/workflows/nightly-build.yml`), scheduled 02:00 IST, deploys to the
  **test** project (`TEST_GCP_PROJECT`) with real Claude on Vertex.
- QA and *test* are the same environment. The word "QA" in conversation means the existing test project;
  no new environment is created.
- **Weekly off-switch:** when no work happened that week, set repository variable `NIGHTLY_ENABLED=false`
  (or comment `/nightly off` on any issue). Re-enable with `NIGHTLY_ENABLED=true` or `/nightly on`.
- **On-demand QA:** run the **Nightly build** workflow manually (Actions → Nightly build → Run workflow)
  to deploy current `main` to QA at any time — for example to keep testing through the week before the
  Saturday staging build. No nightly tag or release is needed for an on-demand run.

### 3.4 Staging (weekly, and on demand)

- Workflow: **Deploy staging** (`.github/workflows/deploy-staging.yml`), now triggered by a **weekly
  schedule (Saturday 12:00 CST)** and `workflow_dispatch`, **not** by every merge to `main`.
- Runs migrations, deploys every service, then smoke-tests staging.
- **On-demand Staging:** Actions → Deploy staging → Run workflow (takes current `main`). Use this for
  customer demos. The build always comes from `main`, so it is the same artefact QA validated.
- Staging stays the pre-production environment: synthetic data only, never real candidates.

### 3.5 Production (on demand, owner approval only)

- There is no automatic path to production.
- The **Production agent** waits for the owner to approve or to invoke it by name, with an explicit
  source and target:

  > "Production agent, deploy the build running on **staging** to production."
  > "Deploy the build running on **QA** to production."

- It deploys **the image already running** on the named source (same commit/digest), not a rebuild.
- The `production` GitHub environment stays behind required reviewers, and the release keeps the canary
  and smoke-test steps plus the automatic rollback-on-failure.

## 4. The agents

| Agent | Runs as | Job | May | May not |
| --- | --- | --- | --- | --- |
| **DevOps (pipeline) agent** | GitHub Actions workflows | CI, builds, nightly QA, weekly staging, on-demand builds, rollback, status reports, open PRs | Trigger QA/Staging builds; run tests; open PRs; roll back staging/production | Merge to `main`; deploy production; change IAM/secrets/billing/terraform state; create environments |
| **Promotion agent** | Scheduled automation (OpenHands) | Waits for the owner's approval comment before any QA→Staging→Production promotion | Watch issues/comments; report status; request approval | Promote without approval |
| **Production agent** | Scheduled automation (OpenHands) | Deploys a named source (QA or Staging) to production on the owner's approval or invocation | Deploy the running image from QA/Staging to production; smoke-test; roll back on failure | Deploy without approval; rebuild from a branch |

**How the owner drives them**

- **OpenHands chat** and **GitHub issue comments** are the two channels.
- Issue commands follow the existing pattern in `.github/workflows/issue-commands.yml`:

  | Command | Effect |
  | --- | --- |
  | `/nightly off` | Set `NIGHTLY_ENABLED=false` — pause the nightly QA build |
  | `/nightly on` | Set `NIGHTLY_ENABLED=true` — resume it |
  | `/qa deploy` | Run an on-demand QA build from `main` |
  | `/staging deploy` | Run an on-demand Staging build from `main` |
  | `/production deploy from qa` | Production agent: promote the build running on QA |
  | `/production deploy from staging` | Production agent: promote the build running on Staging |
  | `/verified` | Mark a fix verified on QA and close the issue |
  | `/failed` | Reopen and send the issue back to triage |

## 5. Hard limits (never crossed)

- No direct push to `main`; no merge without a green PR and owner approval.
- No production deploy without the owner's explicit approval or invocation.
- No changes to IAM, secrets, billing, or Terraform state by an agent.
- No new cloud environments or projects.
- No spend beyond the approved cap (staging live Claude: $2 per run, $10 per day).

## 6. Repository settings the owner must set (Settings clicks)

Agents cannot do these; they are one-time and in the GitHub UI.

| Where | Setting | Why |
| --- | --- | --- |
| Settings → Branches → `main` | Require a pull request, require status checks (CI), no direct pushes | Rule 1 |
| Settings → Environments → `staging` | Add the owner as a **required reviewer** (optional) | Extra gate for demos |
| Settings → Environments → `production` | Add the owner as a **required reviewer** | Rule 5 |
| Settings → Actions → General | Allow workflows to create and approve pull requests (for the agents) | Agents open PRs |
| Settings → Variables → Actions | `NIGHTLY_ENABLED`, `QA`/`TEST` and staging/production project variables, WIF providers, service accounts | Wiring |

## 7. Variables and workflows at a glance

| Name | Kind | Value / purpose |
| --- | --- | --- |
| `GCP_REGION` | variable | `us-central1` |
| `GCP_PROJECT_STAGING` | variable | `adi-praxis-staging` |
| `GCP_PROJECT_PRODUCTION` | variable | production project id |
| `TEST_GCP_PROJECT` | variable | `adi-praxis-test-0928` (QA) |
| `GCP_WIF_PROVIDER_STAGING` / `GCP_DEPLOYER_SA_STAGING` | variable | staging deploy identity |
| `GCP_WIF_PROVIDER_PRODUCTION` / `GCP_DEPLOYER_SA_PRODUCTION` | variable | production deploy identity |
| `TEST_WIF_PROVIDER` / `TEST_DEPLOYER_SA` | variable | QA deploy identity |
| `NIGHTLY_ENABLED` | variable | `true` / `false` — the nightly off-switch |
| `E2E_WEB_URL`, `E2E_CANDIDATE_URL`, `E2E_*` secrets | vars/secrets | smoke tests |

| Workflow | File | Trigger |
| --- | --- | --- |
| CI | `ci.yml` | pull request, called by others, dispatch |
| Nightly build (QA) | `nightly-build.yml` | nightly schedule (gated by `NIGHTLY_ENABLED`) + dispatch |
| Deploy staging | `deploy-staging.yml` | weekly Saturday 12:00 CST + dispatch |
| Release production | `release.yml` | tag `v*`, behind the `production` environment |
| Roll back | `rollback.yml` | dispatch (staging or production) |
| Terraform drift | `drift.yml` | weekly |

## 8. What changes when this is implemented

1. `nightly-build.yml` — re-enabled, gated on `NIGHTLY_ENABLED`, and documented as the QA deployer.
2. `deploy-staging.yml` — `on:` changes from `push: main` to a weekly schedule + `workflow_dispatch`.
3. New `production-agent.yml` (or equivalent) — accepts `source = qa|staging`, deploys the running image,
   behind the `production` environment's required reviewers.
4. New promotion agent config — waits for the owner's approval comment.
5. `issue-commands.yml` — extended with `/nightly`, `/qa deploy`, `/staging deploy`, `/production deploy`.
6. Repository settings from section 6.

None of these is live until the owner merges the PR that adds them.
