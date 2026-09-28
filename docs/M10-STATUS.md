# M10 build status

Branch `m10-sme-supply`. Spec: `docs/SME-SUPPLY.md`. Runbook: `docs/M10-BUILD.md`. Decisions: `docs/DECISIONS.md` → "M10".

## Baseline (28 Sep 2026)

- `pnpm install`, services up, `pnpm typecheck` and `pnpm test` green before any change: shared 101, mcp-replay 2,
  api 394 tests.
- `pnpm db:migrate` (`prisma migrate dev`) asks to reset the local development database because an earlier migration's
  checksum differs locally (local-only drift, not in the repository). Used `prisma migrate deploy` instead; nothing
  pending. Owner: no action needed; a fresh local database migrates cleanly.

## Slices

| Slice | Status |
| --- | --- |
| M10a Foundations, partners and requisitions | done (API); portal and candidate pages come with M10d |
| M10b Guidelines to courses and certifications | done (API); Admin and candidate screens come with M10d |
| M10c Payments | not started |
| M10d Screens | not started |

## M10a — done

- Flag `SME_SUPPLY_ENABLED` and per-project switch; models and migrations `20260928010000_m10a_partners_requisitions`,
  `…011000_m10a_client_ids`, `…012000_m10a_append_only_grants`.
- Partners (Admin), partner portal API (`/api/v1/partner-portal/*`, cookie `praxis_partner`), Partner API v1
  (`/partner/v1/*`: OAuth client credentials, scopes, idempotency, per-token rate limits, sandbox simulation), signed
  webhooks with retries and replay, requisitions, submissions with duplicate detection (12-month ownership, 90-day
  cool-off), requirement screen with human confirmation, invite into FLOW 2, direct careers application, invite
  reminder and expiry, FLOW 2 → partner events (identity verified, selected, not selected).
- "Validator" label for the internal REVIEWER role across the console, the candidate app and API messages.
- Tests: `apps/api/test/supply-a.test.ts` (19). Suite: api 413, shared 101, mcp-replay 2 — all green; typecheck green.
- Owner: set `M10_ENCRYPTION_KEY` (32 random bytes, base64) wherever M10 is switched on outside local development.

## M10b — done

- Models and migration `20260928020000_m10b_certification`: guidelines packages and versions, generation runs,
  knowledge items, courses and modules, blueprints, item families and instances (pgvector embeddings), test forms,
  certifications, test attempts, append-only `SmeStanding`.
- Generation pipeline (`apps/api/src/cert/`): Claude on Vertex (`ClaudeVertexCurriculumGenerator`) or the deterministic
  mock; rule-derived keys, four checks plus near-copy, flagging; buffered single-use forms; course player; selfie
  re-check (Stripe Identity or mock); scoring; people confirm written grades; retakes and human review; licence check;
  C07 checklist item; partner webhooks and history; Partner API guidelines summary and course outline.
- Routes: Admin/Validator `apps/api/src/routes/cert-admin.ts`; candidate `apps/api/src/routes/cert-candidate.ts`
  (including certified Experts confirming authoring grades and reviewing Expert-tier families). Worker jobs
  `cert-forms` (5 min) and `cert-sweep` (10 min).
- Tests: `apps/api/test/supply-b.test.ts` (12). Suite: api 425 — all green; workspace typecheck green.
- Not built yet (documented, not blocking the acceptance criteria): the update module and quiz for SMEs already
  certified when a *major* guidelines version is published (section 4); regeneration of a single course module.
- Owner:
  - `CERT_BULK_MODEL` is blank, so instance wording and solving also use `CERT_MODEL` (`claude-opus-5`). Set a cheaper
    model when the Vertex quota allows.
  - With real Stripe keys each attempt starts a new Stripe Identity session with a matching selfie (a billed
    verification per attempt).
  - Vertex quota in the test project still returns 429 for Claude; generation there falls back to FAILED runs until it
    is raised.
