# ADI Praxis

ADI Praxis, by ADI-Labs, turns domain expertise into versioned tasks: author an
objective, evidence, constraints and rubric; submit it for an explicit human decision;
export the accepted record with its provenance. It includes expert onboarding,
staffing, task authoring and review, plus certification and payment workflows.

Praxis supplies tasks. **ADI Anvil** independently validates imports, qualifies Harbor
packages, executes evaluations and retains diagnostic results. An export is not an
Anvil rights approval or permission to spend money.

## Review the implementation

| Start here | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Components, trust boundaries, durable data and execution flow |
| [Praxis → Anvil contract](docs/integrations/PRAXIS-ANVIL.md) | Supported v1/v2 authoring, exact export bytes, hashes and lineage |
| [Admin workflow](docs/ADMIN-WORKFLOW.md) | Current decision policy; supersedes older multi-role sign-offs |
| [Product specification](docs/SPEC.md), [candidate flow](docs/FLOW2-SME.md), [KYC tasks](docs/TASK-KYC.md) | Product requirements; these are not test results |
| [Test guide](docs/testing/README.md), [test cases](docs/testing/TEST-CASES.md), [coverage map](docs/testing/COVERAGE.md) | Manual review instructions and requirement mapping |
| [Release 1.2](docs/releases/RELEASE-1.2-PRAXIS-HARBOR.md), [M10 status](docs/M10-STATUS.md) | Delivered increments and recorded limitations |
| [YC review evidence](docs/YC-REVIEW.md) | Checked revision, verification results and publication boundary |

## Architecture and repository map

`Console / candidate app → Fastify API → PostgreSQL + transactional outbox → BullMQ worker`

| Path | Responsibility |
| --- | --- |
| [apps/web](apps/web/) | Next.js console and partner portal; local port 3100 |
| [apps/candidate](apps/candidate/) | Next.js expert onboarding and authoring; local port 3101 |
| [apps/api](apps/api/) | Fastify/Zod API, Prisma migrations, audited commands and worker |
| [packages/shared](packages/shared/) | Shared validation, task contracts, theme and brand |
| [contracts/praxis](contracts/praxis/) | v1/v2 schemas, synthetic single/staged task fixtures and negative output |
| [infra](infra/README.md) | Local service initialization, Terraform and deployment configuration |
| [.github/workflows](.github/workflows/) | Test and release automation; files alone do not prove CI success |

PostgreSQL owns task revisions, human decisions and the append-only, hash-chained
approved dataset. Redis/BullMQ handles background work. External identity, storage,
AI and payout integrations have explicit adapters; local tests use mocks.

## Run locally

Requires Node ≥22, pnpm **10.34.5** and Docker. Use this repository's lockfile.
On a fresh checkout, create `.env` from `.env.example` and set local seed credentials;
preserve an existing `.env`. Never commit credentials.

```sh
pnpm install --frozen-lockfile
pnpm services:up
pnpm --filter @praxis/api db:deploy
pnpm db:seed
pnpm dev
```

In another terminal, run `pnpm worker`. Open the console at
http://localhost:3100 and sign in with your locally configured seed Admin account.
The candidate app is http://localhost:3101; API docs are http://localhost:4000/docs.
Optional `pnpm db:seed:candidates` adds 200 explicitly synthetic local candidates.
Mailpit is http://localhost:8035. Service ports are PostgreSQL 5442 and Redis 6389.
Use `pnpm services:down` to stop services while preserving volumes.

Blank Google/Stripe configuration selects labeled development mocks. Keep model,
payment and external-send integrations in mock mode for a local review. Production
requirements and deployment configuration are documented in [infra/README.md](infra/README.md).

## Reproduce the task handoff

1. As Admin, prepare a synthetic project and create its synthetic draft. The draft
   download is a software fixture, not an accepted dataset record.
2. Author a supported single/staged structured task, submit it and record the actual
   Admin acceptance. Existing authoring, checks and append-only evidence remain in use.
3. In **Projects → Approved exports**, download the task, preferably with the
   `praxis.anvil.export.v1` envelope. It preserves exact `payload_json`, SHA-256 and lineage.
4. Import it into Anvil. Anvil applies its own project authorization, rights and
   executable qualification before a run. See the [integration guide](docs/integrations/PRAXIS-ANVIL.md).

Praxis currently exports `praxis.anvil.task.v1` and `v2`. Anvil's newer marketing,
KYC/AML and fraud **v3 golden set** is an Anvil conformance fixture; it does not establish
v3 authoring/export support in this Praxis revision. No live synchronization is claimed.

## Tests and evidence

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
```

API integration tests are in [apps/api/test](apps/api/test/); shared contract tests are
in [packages/shared/test](packages/shared/test/); browser journeys are in [e2e](e2e/).
The API suite requires real local PostgreSQL/Redis and enforces a separate `praxis_test`
database. Browser tests use `praxis_e2e` and ports 4300/3300/3301. External services are
mocked. Run database suites sequentially. See [review evidence](docs/YC-REVIEW.md)
for exactly what was rerun and what remains historical or unverified.

The Release 1.1 coverage map lists **274 manual cases across 85 screens**; this is
requirement mapping, not 274 automated passes or a current code-coverage percentage.
Earlier M10 records include intermittent database stalls and an incomplete final full
rerun. Live payout compatibility and the full original intake field mapping remain
unverified. Synthetic examples and scripted results are not model-performance evidence.

## Hosted demo

- [Praxis console](https://praxis-web-yu2jtyqhea-uc.a.run.app)
- [Candidate application](https://praxis-candidate-yu2jtyqhea-uc.a.run.app)

Use an assigned account; passwords are never published. This existing GCP deployment is
a **test/demo environment**: Vertex AI is real, while candidate identity/sign-in and
email are simulated. It uses Cloud Run, Cloud SQL and Redis in `us-central1`; it differs
from the private-network Terraform production target. See [release evidence](docs/YC-REVIEW.md)
for the verified version and checks. Existing-host deployments set `DEPLOY_ONLY=1` and
`SKIP_DEMO_SETUP=1` to preserve users and avoid reseeding. Back up the database first.
