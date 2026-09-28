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
| M10b Guidelines to courses and certifications | not started |
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
