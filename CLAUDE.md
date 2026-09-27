# ADI Praxis — instructions for Claude Code

ADI Praxis (by ADI-Labs) is a platform where experts author diverse, verified tasks
from domain workflow templates (e.g. Banking / KYC), feeding an append-only dataset
used by a separate RL Gym platform.

## Read first
- `docs/SPEC.md` — main spec: personas, flows 1–4, diversity and coverage, Approved
  Task Dataset, data model, API, stack, branding, GCP deployment, build plan (M0–M8).
- `docs/FLOW2-SME.md` — SME candidate flow (sign-in, identity, profile, selection,
  onboarding). Wins over SPEC.md on anything candidate-facing.
- `docs/TASK-KYC.md` — what a KYC authoring task contains, author workbench, review.
- `docs/brand/` — logo. Colours and rules are in the Branding section of SPEC.md.

## How to work
1. Build ONE milestone at a time, in order (M0, M1, ...). Do not start the next one
   until I say so.
2. Before writing code for a milestone, list your assumptions and open questions,
   and wait for my answer.
3. Write tests for every acceptance criterion in the milestone. All tests must pass
   before you say the milestone is done.
4. Anything the spec marks as a separate spec or external system (RL Gym, LinkedIn
   Apply Connect, other workflows' task definitions) gets a clearly named interface
   and a stub or mock. Do not invent its behaviour.
5. Use mocks for Stripe, Google sign-in, Vertex AI and email/SMS in local dev and
   tests. Never call live services from tests.
6. Commit in small, logical steps with clear messages. Never commit secrets; use
   `.env.example` for configuration names.
7. Keep `docs/` as the source of truth. If the code must differ from the spec, stop
   and ask rather than silently changing behaviour.

## Non-negotiables
- `ApprovedTaskRecord` and `RLReviewRecord` are append-only, enforced in the database.
- AI output never makes a final selection, rejection or task-acceptance decision;
  a human Reviewer does.
- Identity images and ID numbers are never stored in this platform.
- Task content is synthetic only; no real customer or employer data.
- Every state change is authorised, idempotent and written to the audit log.

## Stack (see SPEC.md for detail)
TypeScript monorepo (pnpm workspaces): `apps/web`, `apps/candidate`, `apps/api`,
`packages/shared`. Next.js + Tailwind, Node API with Zod + OpenAPI, PostgreSQL +
Prisma + pgvector, Redis + BullMQ, Vitest + Playwright, docker-compose for local dev,
Terraform + GitHub Actions for GCP (M8).
