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

## Platform rules built into M0

- **RBAC on every endpoint:** each route must declare `config.access` (`'public'`, `'authenticated'` or a list of roles). A route without one stops the API from starting.
- **State changes go through `runCommand`:**
  - An `Idempotency-Key` header is required, and a repeated key replays the first response.
  - The change, its `AuditEvent` and any outbox events commit in one transaction.
  - A command that writes no audit event is refused.
- **Domain events:** the outbox is published to BullMQ by the worker. Handlers register in `apps/api/src/outbox/handlers.ts`, and a receipt per event and handler ensures each runs once, with retries.
