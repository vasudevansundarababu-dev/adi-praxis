# ADI Praxis

ADI Praxis, by ADI-Labs, lets experts author diverse, verified tasks from domain workflow templates (e.g. Banking / KYC). Accepted tasks feed an append-only dataset used by the separate RL Gym platform.

The specs in [docs/](docs/) are the source of truth:
- [SPEC.md](docs/SPEC.md): the main spec, including the build plan (M0 to M8).
- [FLOW2-SME.md](docs/FLOW2-SME.md): the SME candidate flow.
- [TASK-KYC.md](docs/TASK-KYC.md): the KYC task definition.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/api` | Fastify + Zod API, Prisma schema and migrations, outbox worker |
| `apps/web` | Next.js console for Admins, PMs and Reviewers (port 3100) |
| `apps/candidate` | Next.js mobile-first candidate app (port 3101) |
| `packages/shared` | Shared types and schemas, theme tokens (`theme/`) and logo files (`brand/`) |
| `infra/` | Local Docker init scripts. Terraform arrives in M8 |

## Local setup

Requirements: Node 22 or later, and Docker.

pnpm (version pinned in `package.json`) must be on your PATH, because the root scripts call it. Either run `corepack enable`, or, if that can't write to `/usr/local/bin`, run `corepack enable --install-directory ~/.local/bin` (with `~/.local/bin` on your PATH) or `npm install -g pnpm@10`.

```sh
cp .env.example .env    # local defaults; never commit .env
pnpm install
pnpm services:up        # Postgres + pgvector, Redis, Mailpit, fake GCS
pnpm db:migrate         # apply migrations to the dev database
pnpm db:seed            # client, first Admin, reason codes, taxonomy, template catalog
pnpm db:seed:candidates # LOCAL ONLY: 200 synthetic "Test Expert" candidates for FLOW 2 matching
pnpm dev                # API on :4000, console on :3100, candidate app on :3101
pnpm worker             # in a second terminal: outbox dispatcher + event handlers
```

Sign in to the console at http://localhost:3100 with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

The candidate app is at http://localhost:3101. With `GOOGLE_OAUTH_CLIENT_ID` and the Stripe keys blank (the default), it shows a clearly labelled **dev sign-in (mock Google)** and a **simulated identity provider** page; both exist only in development builds, and the API refuses to start in production without the real keys. The SME profile assistant likewise runs on a local heuristic mock unless `VERTEX_PROJECT_ID` is set (Claude via Vertex AI); tests never call Claude. API docs are at http://localhost:4000/docs, and outgoing email appears in Mailpit at http://localhost:8035.

Local services use offset host ports (Postgres 5442, Redis 6389, SMTP 1035), so they don't clash with other Docker stacks.

## Tests

```sh
pnpm services:up
pnpm test
```

API tests are integration tests against real Postgres and Redis. They use the separate `praxis_test` database and refuse to run against any other. External services (Google, Stripe, Vertex AI, email and SMS) are always mocked; tests never call live services.

UI smoke tests use Playwright with your installed Chrome. They start their own API and apps on ports 4300, 3300 and 3301 against a separate `praxis_e2e` database, so a running `pnpm dev` is not disturbed:

```sh
pnpm test:e2e
```

Next.js may add its `.next-e2e` type paths to `apps/*/tsconfig.json` and `next-env.d.ts` during the run; discard those changes. In CI set `PW_CHANNEL=` (empty) and run `npx playwright install chromium` to use Playwright's own browser.

## Platform rules built into M0

- **RBAC on every endpoint:** each route must declare `config.access` (`'public'`, `'authenticated'` or a list of roles). A route without one stops the API from starting.
- **State changes go through `runCommand`:**
  - An `Idempotency-Key` header is required, and a repeated key replays the first response.
  - The change, its `AuditEvent` and any outbox events commit in one transaction.
  - A command that writes no audit event is refused.
- **Domain events:** the outbox is published to BullMQ by the worker. Handlers register in `apps/api/src/outbox/handlers.ts`, and a receipt per event and handler ensures each runs once, with retries.

## Approved Task Dataset (M6)

- `ApprovedTaskRecord`, `RLReviewRecord`, `AuditEvent`, `SelectionDecision` and `TaskReview` are append-only in the database. A trigger rejects `UPDATE` and `DELETE`, `TRUNCATE` needs the session setting `praxis.allow_truncate = on` (test resets only), and `UPDATE`/`DELETE` are revoked from the application role. The app must connect as a non-superuser role in staging and production so the revoked grants apply (superusers bypass grants; the triggers still hold).
- Each record carries a SHA-256 `content_hash` chained to the previous record's hash in `seq` order. The worker verifies the chains nightly (`DATASET_VERIFY_CRON`, default 03:00 UTC) and logs `alert: true` on any break; Admins can run it on demand at `GET /api/v1/dataset/verification`.
- Read-only access for Admins and RL Gym (Bearer key from **API clients**): `GET /dataset/records`, `/dataset/records/{id}`, `/dataset/records/{id}/lineage`, `/dataset/export` (NDJSON). Corrections append a superseding record: `POST /dataset/records/{id}/corrections`.

## Deployment (M8)

Terraform for staging and production on Google Cloud, and the GitHub Actions pipeline, are in `infra/` and `.github/workflows/`. See [infra/README.md](infra/README.md). Container images: `apps/api/Dockerfile` (API, worker and jobs), `apps/web/Dockerfile` and `apps/candidate/Dockerfile`, built from the repository root.

