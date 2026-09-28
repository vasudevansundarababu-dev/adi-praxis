# M10 overnight build — runbook for Claude Code

Owner: pre-approved on 28 Sep 2026 to build **all four M10 slices without stopping to ask**. This overrides
CLAUDE.md "How to work" rules 1 and 2 for M10 only. Everything else in CLAUDE.md still applies.

## Before you start

1. `git switch m10-sme-supply` (never commit to `main` or `release/1.0`).
2. `pnpm install`, `pnpm services:up`, `pnpm db:migrate`, then `pnpm test`. The existing suite must be green
   before any change. If it is not, record it in `docs/M10-STATUS.md` and continue.
3. Read `docs/SME-SUPPLY.md` (the spec, including section 0 "Owner decisions"), `docs/SPEC.md`, `docs/FLOW2-SME.md`
   and `docs/DECISIONS.md`.

## Rules for the run

- Do not stop to ask. Where the spec is silent, pick the option you would recommend, then add it to
  `docs/DECISIONS.md` under "M10" marked **(chosen by Claude)**.
- Follow existing patterns: route plugins with `config.access`, `runCommand` with audit and outbox, `ClaudeVertex*`
  adapter + deterministic mock, provider adapter + mock (production refuses mocks), Prisma migrations named
  `<timestamp>_m10<slice>_<name>`, append-only tables enforced by trigger as in the M6 migration.
- Never edit existing migrations, workflows, infrastructure or secrets. Never call live services from tests.
- Tests for every acceptance criterion in `docs/SME-SUPPLY.md` section 13. A slice is done only when
  `pnpm typecheck` and `pnpm test` are green.
- Commit in small steps; finish each slice with a commit `feat(m10x): ...`. Do not push.
- If a slice cannot be made green after a genuine effort, commit what works, write exactly what fails and why in
  `docs/M10-STATUS.md`, and move to the next slice if it does not depend on the broken part.
- Keep `docs/M10-STATUS.md` updated after each slice: done, tests added, decisions made, anything the owner must do.

## Slices, in order

**M10a — Foundations, partners and requisitions**
- `SME_SUPPLY_ENABLED` config flag (default off) plus per-project switch; with the flag off nothing M10 is reachable.
- Prisma models and migration for section 9; state dimensions from section 6.
- Partner accounts inside `apps/web` (email + password, argon2id, cookie `praxis_partner`, partner-only nav) and
  Partner API v1 (OAuth2 client credentials, scopes, idempotency, rate limits, signed webhooks with retries and replay,
  sandbox). Endpoints and events: section 5.
- Requisitions, candidate submission, duplicate detection with a 12-month ownership window and 90-day cool-off,
  invite into FLOW 2.
- Display label "Validator" for the internal REVIEWER role across the console, emails and docs (enum unchanged).
  SME tiers use enum `EXPERT`, `REVIEWER_SME`, `ANNOTATOR` and labels Expert, Reviewer, Annotator.

**M10b — Guidelines to courses and certifications (section 7)**
- Guidelines upload and versioning; generation pipeline as outbox `run` handlers; knowledge map, courses,
  blueprints and item families per tier, all with citations.
- `CurriculumGenerator` interface with `ClaudeVertexCurriculumGenerator` and `MockCurriculumGenerator`.
  Model config: `CERT_MODEL` (default the existing Opus constant) for extraction, courses, blueprints, families and
  grading; `CERT_BULK_MODEL` for per-candidate instances and the solver check. If `CERT_BULK_MODEL` is unset, use
  `CERT_MODEL` and note it in M10-STATUS for the owner to set.
- Admin approval of every item family (with samples) before publish; Expert tier reviewed with an Expert, or with
  Admin + Validator until the domain has two certified Experts.
- Dynamic forms: buffered, single-use, validated (four checks), no instance served twice, no repeats on retake.
- Scoring, retakes (48 h, max 2), human review, LLM-graded written answers as recommendations needing confirmation.
- Selfie re-check through Stripe Identity on every attempt (mock in dev/tests).
- Healthcare licence check for requisitions marked "licence required": licence number, issuing body and certificate
  upload, confirmed by a Validator before Expert certification.

**M10c — Payments (section 8)**
- Rate cards per requisition in USD or INR; append-only `EarningEntry` from `task.approved`,
  `rl_review.accepted`, `hours.approved`; reversals only.
- `PayoutProvider` with `TrolleyAdapter` and `MockPayoutAdapter`; payee onboarding link; signed webhook
  `POST /integrations/trolley/webhook`; daily reconciliation job.
- Weekly pay run every Monday for the previous Monday–Sunday; minimum USD 10 / INR 500 carried forward; PM confirm,
  Finance approve; single-approver actions flagged in the audit log until a second approver exists; holds.
- Partner certified-candidate fee entries on `candidate.certified`; monthly statements.
- New role `FINANCE` (label Finance).

**M10d — Screens**
- Console, partner portal and candidate app screens from section 12, using only the existing Praxis layouts,
  tokens and component classes. Reference: the clickable prototype
  https://claude.ai/artifact/N34WCAhdvc6FaQYtLWKc9o (look and flow only; the existing design wins).
- Admin screens for guidelines, generation review and publish (section 7.6).
- Playwright smoke tests for the partner submit flow, candidate course → test → result, and pay-run approval.

## Prompt to paste into Claude Code

```text
Read docs/M10-BUILD.md and follow it exactly. You are pre-approved to build all four M10 slices
(M10a to M10d) tonight without asking me anything. Work on branch m10-sme-supply only, keep
typecheck and tests green per slice, commit per slice, never push, log every choice the spec
leaves open in docs/DECISIONS.md as "(chosen by Claude)", and keep docs/M10-STATUS.md current.
Start with M10a.
```
