# Deployment cheat sheet (print me)

**One rule:** only `main` is deployable. QA nightly · Staging weekly · Production never automatic.

```
branch → local server + unit tests → PR → CI green → main
main → Nightly (02:00 IST) → QA            (also: on-demand)
main → Weekly (Sat 12:00 CST) → Staging    (also: on-demand)
QA or Staging → Production                 (owner approval only)
```

## Where things run

| Environment | Project | How it gets there | Auto? |
| --- | --- | --- | --- |
| **QA** (= test) | `adi-praxis-test-0928` | Nightly build, or on-demand | Nightly yes |
| **Staging** | `adi-praxis-staging` | Weekly build (Sat 12:00 CST), or on-demand | Weekly yes |
| **Production** | `adi-praxis-prod` | Production agent only | **Never** |

## What I type

| I want to… | Type this | Where |
| --- | --- | --- |
| Pause the nightly QA build | `/nightly off` | GitHub issue comment |
| Resume it | `/nightly on` | GitHub issue comment |
| Deploy `main` to QA now | `/qa deploy` | GitHub issue comment |
| Deploy `main` to Staging now | `/staging deploy` | GitHub issue comment |
| Send QA build to production | `/production deploy from qa` | GitHub issue comment |
| Send Staging build to production | `/production deploy from staging` | GitHub issue comment |
| Mark a fix verified on QA | `/verified` | GitHub issue comment |
| Send a fix back | `/failed` | GitHub issue comment |

Same requests work in **OpenHands chat**. Production also needs my **approval** on the `production`
environment (or the agent waits for my comment).

## Buttons in GitHub

- **Actions → Nightly build → Run workflow** = on-demand **QA** build (current `main`).
- **Actions → Deploy staging → Run workflow** = on-demand **Staging** build (current `main`).
- **Actions → Roll back → Run workflow** = one-step rollback (staging or production).

## Before it reaches `main`

```
pnpm services:up      # start Postgres/Redis/etc
pnpm db:migrate
pnpm db:seed
pnpm dev              # run the app locally
pnpm -r typecheck && pnpm test
```

Green PR required. **No direct pushes to `main`.**

## The agents

- **DevOps agent** — CI, builds, QA/Staging deploys, rollback, opens PRs.
- **Promotion agent** — waits for my approval before promoting.
- **Production agent** — deploys QA/Staging build to production **only when I say so**.

## Never (agent hard limits)

No direct push to `main` · no production deploy without me · no IAM/secrets/billing/Terraform-state
changes · no new environments · no spend over cap (staging Claude $2/run, $10/day).

## One-time Settings clicks (only I can do these)

- **Branches → `main`**: require PR + green CI, no direct pushes.
- **Environments → `production`**: required reviewer = me.
- **Environments → `staging`**: optional required reviewer = me.
- **Actions → General**: allow workflows to create/approve PRs.
- **Variables → Actions**: `NIGHTLY_ENABLED`, `GCP_PROJECT_STAGING`, `TEST_GCP_PROJECT`, WIF providers, service accounts.

Full detail: `docs/ops/DEPLOYMENT-PIPELINE.md`.
