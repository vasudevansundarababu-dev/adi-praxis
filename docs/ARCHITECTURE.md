# Praxis implementation architecture

This describes repository components, not a production-readiness certification.
The [product specification](SPEC.md) contains the broader target. Current
[Admin policy](ADMIN-WORKFLOW.md) supersedes historical internal sign-off requirements.

## Request and background paths

The Next.js [console](../apps/web/) and [candidate app](../apps/candidate/) call the
[Fastify API](../apps/api/src/). Shared Zod contracts live in
[packages/shared](../packages/shared/). The API validates authentication, audience,
role and tenant scope before domain commands. Route access declarations are mandatory.

State changes pass through the command layer: an idempotency key, the domain write,
audit event and outbox events commit in one PostgreSQL transaction. The worker sends
outbox work to Redis/BullMQ; per-handler receipts deduplicate delivery. See
[API source](../apps/api/src/) and [outbox tests](../apps/api/test/outbox.test.ts).

## Durable evidence

The [Prisma schema and migrations](../apps/api/prisma/) define canonical records.
Approved tasks, RL reviews and audit/decision evidence use append-only database
guards. Dataset hashes chain records in sequence; corrections append successors.
Application credentials must remain distinct from migration ownership. Integrity
verification and lineage exports retain the original decision and record hashes.

Task evidence is synthetic only. Identity images and ID numbers must not be stored
in Praxis. Authentication, candidate/partner audiences, tenant scope and audit rules
remain enforced under the simplified Admin workflow. External providers are adapters,
with mock implementations for local/test use. Passing mock tests does not qualify a
live provider, payment flow or production identity deployment.

## Export boundary

Accepted records expose a validated task contract through
`GET /api/v1/dataset/records/:id/praxis-contract`. The optional v1 envelope contains
exact canonical task bytes, their hash and immutable source lineage. Raw v1/v2 task
payloads remain available. Private uploaded files are not automatically joined into
the export. Draft synthetic downloads use a separate path and remain labeled drafts.

Anvil owns source admission, hidden-reference isolation, Harbor packaging,
qualification, execution and spending controls. Source project/reviewer IDs do not
grant destination access or rights. See [contract details](integrations/PRAXIS-ANVIL.md)
and [contract fixtures](../contracts/praxis/). Praxis v3 authoring is not implemented
by the current v1/v2 exporter.

## Operations and review

[Docker Compose](../docker-compose.yml) supplies PostgreSQL/pgvector, Redis, Mailpit
and fake GCS for local use. [Terraform and deployment workflows](../infra/README.md)
describe cloud topology and release mechanics; deployed revisions must be verified
separately. [Release policy](RELEASES.md) preserves the frozen release branch.

Use [testing instructions](testing/README.md), [API tests](../apps/api/test/),
[browser tests](../e2e/) and [review evidence](YC-REVIEW.md) to inspect implementation
claims. Specification coverage and automated test results are separate evidence.
