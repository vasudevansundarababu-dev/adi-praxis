# Authoring v2.1: validation receipts

Each entry records commands actually run, on which commit, and their results. Nothing here is a deployment or a
live-model result unless it says so.

## Wave 0: baseline (10 Nov 2026)

Branch `feat/authoring-v21` from `feat/authoring-v2-ui` at `a5c9a32`. Local macOS, Node 24.21.0, pnpm 10.34.5,
PostgreSQL (pgvector pg16) and Redis 7 from `docker compose`. All model, email and payment providers mocked.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, all 6 packages | `pnpm -r typecheck` | pass |
| API integration tests | `pnpm --filter @praxis/api test` | 54 files; 725 passed, 5 skipped |
| Shared unit tests | `pnpm --filter @praxis/shared test` | 15 files; 192 passed |
| Candidate tests | `pnpm --filter @praxis/candidate test` | 2 files; 23 passed |
| Web tests | `pnpm --filter @praxis/web test` | 7 files; 55 passed |
| Candidate production build | `pnpm --filter @praxis/candidate build` | pass |
| Web production build | `pnpm --filter @praxis/web build` | pass |

No fixes were needed: the baseline built cleanly on a fresh checkout. Gate passed.

## Wave 1: platform core and five templates (10–11 Nov 2026, local)

Branch `feat/authoring-v21` after merging `wave1-policy-manifest` and `wave1-template-profiles`. Same local stack;
all model, email and payment providers mocked. Not deployed; no live model call.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, all 6 packages | `pnpm -r typecheck` | pass |
| API integration tests | `pnpm --filter @praxis/api test` | 57 files; 755 passed, 5 skipped |
| Shared unit tests | `pnpm --filter @praxis/shared test` | 313 passed |
| Candidate tests | `pnpm --filter @praxis/candidate test` | 37 passed |
| Web tests | `pnpm --filter @praxis/web test` | 58 passed |
| Browser journeys, 5 templates | `npx playwright test -c e2e authoring-wave1` | **not yet run to completion**: first run failed on the staffing gate (fixed by an in-test backend for gated calls); rerun blocked by leftover local test servers on ports 4300/3300 |

Not yet shown: the owner's live Vertex QA session and Anvil import (both required for Wave 1 sign-off).
