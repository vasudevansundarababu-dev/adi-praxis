# Praxis modules and distinctive features

Praxis converts domain expertise into versioned, synthetic tasks with a human acceptance
record. Anvil separately qualifies and executes exported tasks. “Distinctive” here means
concrete product behavior, not a claim of competitive uniqueness.

The [Admin workflow policy](ADMIN-WORKFLOW.md) is current. Older specifications may
require separate PM/Reviewer/Finance sign-offs; those requirements are superseded for
Admin operation while historical assignments and decisions remain intact.

| Module | Definition and user outcome | Distinctive implemented features | Boundary |
| --- | --- | --- | --- |
| Home | Role-aware work queue for operating the platform. | Action counts and direct links to applications, tasks, staffing, certification and payments. | Operational counts are not a measure of task quality. |
| Projects | Organizes a client workflow, coverage target and delivery process. | Version-bound workflow templates; opportunity preparation; staffing, task and coverage views; explicit pause/resume/cancel commands. | Legacy non-Admin ownership restrictions remain; projects do not grant Anvil access. |
| Templates and taxonomy | Defines reusable domain workflows and diversity attributes. | Draft/publish/version/retire lifecycle; projects retain their bound template version; structured task definitions and shared validation. | A template is a task-authoring contract, not an executable environment. |
| Sourcing and staffing | Finds and assigns eligible experts to project work. | Opportunity pages, matching filters, invitations, capacity-aware proposals, acceptance/decline/expiry, auditable staffing state. | AI recommendations do not make final selection decisions. Supply screens require their feature configuration. |
| Expert/candidate application | Contributor entry point for opportunities, profiles, onboarding, certification and tasks. | Separate candidate audience; profile assistance; eligibility checklist; proposal acceptance; task workbench handoff. | The hosted demo labels candidate sign-in and identity verification as simulated. Do not enter real customer or identity data. |
| Task authoring | Captures an objective, synthetic evidence, constraints, deliverables and rubric. | Autosave, revision/conflict checks, source declarations, duplicate/data checks, submitted snapshots and rework history; supported executable single/staged contracts. | Authoring a task is not acceptance, rights clearance or model-performance evidence. |
| Reviews | Makes explicit decisions on applications, tasks, RL results, identity exceptions and conflicts. | Recorded decision maker; checklists/reasons; rework/rejection paths; version-bound review history; Admin can operate without separate internal sign-offs. | Conflicts, authorization, validation and append-only evidence are preserved; no fabricated human acceptance. |
| Approved exports / dataset | Publishes accepted task records for downstream consumers. | Append-only, hash-chained records; successor corrections; lineage; NDJSON export; exact-byte Praxis task JSON and optional SHA-256/lineage envelope. | Current executable exporter supports v1/v2. Anvil v3 goldens do not establish Praxis v3 authoring. Draft downloads are explicitly separate from accepted records. |
| Guidelines and certification | Turns versioned guidance into courses, assessments and reviewed qualifications. | Knowledge maps, blueprints, item families, sample checks, buffered forms, course progression, retakes and explicit Admin grade/decision. | AI generation remains advisory. Certified-expert update modules and live provider qualification have documented gaps. |
| Partners | Manages expert-supply relationships and partner operations. | Requisitions, submissions, duplicate/ownership rules, candidate tracking, scoped partner API, webhooks and a separate partner portal. | Feature-gated; portal/API access does not grant internal console or candidate access. |
| Payments | Tracks earnings, holds and bounded payout workflows. | Versioned rate cards; append-only earnings/fees; pay runs, payee checks, release and separate submission; provider idempotency and reconciliation exceptions. | An Admin release sends no money. A recipient cannot release their own run. Mock payout tests do not establish live Trolley compatibility. |
| Admin | Maintains users and platform policy/configuration. | Temporary-password/first-change flow, disable/reset behavior, taxonomy, contributor terms, failure codes and scoped API clients. | Admin policy does not silently promote historical users or bypass tenant/audience isolation. |
| Tutorials and contextual help | Helps each audience learn its workflows. | Role-aware videos/guides; separate partner and expert materials; contextual screen help. | Some help uses a live configured AI adapter; local/mock behavior and hosted configuration must be distinguished. |

## Shared foundations

The Fastify API validates shared Zod contracts. State-changing commands require an
idempotency key and commit domain changes, audit and outbox events in one PostgreSQL
transaction. Redis/BullMQ handles background work with per-handler receipts. Append-only
dataset and decision evidence is enforced at the database boundary, not merely by the UI.

Task content is synthetic only. Identity images and government ID numbers are not stored
in Praxis. External identity, AI, storage, email and payout adapters have separate test/demo
and live behavior. The hosted test environment is not the private Terraform production target.

## Inspect implementation and evidence

- [Architecture](ARCHITECTURE.md), [Admin policy](ADMIN-WORKFLOW.md), [Praxis → Anvil contract](integrations/PRAXIS-ANVIL.md).
- [Console navigation](../apps/web/lib/nav.ts), [candidate app](../apps/candidate/), [API](../apps/api/src/).
- [Task/dataset tests](../apps/api/test/tasks.test.ts), [task-flow tests](../apps/api/test/taskflow.test.ts), [access-control tests](../apps/api/test/rbac.test.ts).
- [Shared executable-contract tests](../packages/shared/test/praxis-contract.test.ts), [browser journeys](../e2e/), [dated review evidence](YC-REVIEW.md).

The [coverage map](testing/COVERAGE.md) maps manual cases to screens; it is separate
from automated results and does not establish a code-coverage percentage.
