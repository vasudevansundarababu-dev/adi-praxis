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
| API integration tests | `pnpm --filter @praxis/api test` | 57 files; 764 passed, 5 skipped (after the demo-setup, Sonnet 5.5, Gemini, QA policy and KYC catalog changes) |
| Shared unit tests | `pnpm --filter @praxis/shared test` | 313 passed |
| Candidate tests | `pnpm --filter @praxis/candidate test` | 37 passed |
| Web tests | `pnpm --filter @praxis/web test` | 58 passed |
| Browser journeys, 5 templates | `npx playwright test -c e2e authoring-wave1` | 5 passed (KYC, KYB, AML, Omnichannel, phone launch): start from the template workflow, edit a node, save, same graph in Chatbot, list view and no sideways scroll at 736/390/320 px. Gated calls served by an in-test backend; run on alternate local ports |

Not yet shown: the owner's live Vertex QA session and Anvil import (both required for Wave 1 sign-off).

## Wave 2: review route, workflow building, planner and three templates (11 Nov 2026, local)

Branch `feat/authoring-wave2` from `main` at `58dcd84b`, after merging `wave2-template-profiles` and `wave2-expert-pm`
and the credentials hotfix. Same local stack; all providers mocked. Not pushed, not deployed, no live model call.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, all packages | `pnpm -r typecheck` | pass |
| API integration tests | `pnpm --filter @praxis/api test` | 58 files; 784 passed, 5 skipped, 1 failed: `conversation-browser.test.ts` timed out at 300 s under full-suite load; it passes alone (60 s) and now has a 60 s step timeout so a stall names its step |
| Shared unit tests | `pnpm --filter @praxis/shared test` | 352 passed |
| Candidate tests | `pnpm --filter @praxis/candidate test` | 37 passed |
| Web tests | `pnpm --filter @praxis/web test` | 65 passed |
| Browser journeys | `npx playwright test -c e2e authoring-wave` | 9 passed: the eight templates (graph below both editors) and Wave 2 workflow building (decision, person step, parallel step with join, correction loop) |

Not yet shown: the owner's live session and Anvil import for the three new templates; Expert → PM in the browser.

## Wave 3: policy proposals, policy sources, open model and three templates (12 Nov 2026, local)

Branch `feat/authoring-wave3` from the tip of `feat/authoring-wave2` (owner: build Wave 3 while Wave 2 waits for QA).
Same local stack; all providers mocked. Not pushed, not deployed, no live model call.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, all packages | `pnpm -r typecheck` | pass |
| API integration tests | `pnpm --filter @praxis/api test` | 60 files; 817 passed, 5 skipped, 0 failed (browser chatbot test included) |
| Shared unit tests | `pnpm --filter @praxis/shared test` | 375 passed |
| Candidate tests | `pnpm --filter @praxis/candidate test` | 39 passed (accessibility checks on the new proposal panel) |
| Web tests | `pnpm --filter @praxis/web test` | 69 passed (accessibility checks on the proposal review and policy sources panels) |
| Browser journeys | `npx playwright test -c e2e authoring-wave` | 12 passed: all eleven templates (graph below both editors) and Wave 2 workflow building |

New tests: `apps/api/test/policy-proposals.test.ts` (proposal intake, flags, access, accept through the document
service, database guard, retrieval filters, review policy sources), `apps/api/test/maas-assistant.test.ts` (open-model
contract against mocks), Wave 3 cases in `template-profiles.test.ts`, shared profile and graph tests, and the web and
candidate component tests. Not yet shown: the owner's live QA session (Waves 2 and 3), the open-model comparison on a
real Model Garden model, and the Anvil import for the three new templates.

## Owner field-contract answers and help chatbot (12 Nov 2026, local)

Wave 2 answers committed on `feat/authoring-wave2` and merged into `feat/authoring-wave3`; Wave 3 answers and the help
chatbot on `feat/authoring-wave3`. All providers mocked; not pushed, not deployed, no live model call.

| Check | Result |
| --- | --- |
| `pnpm -r typecheck` | pass |
| API integration tests | 61 files; 824 passed, 5 skipped, 0 failed |
| Shared / web / candidate unit tests | 383 / 70 / 40 passed |
| Browser journeys (`authoring-wave1`, `authoring-wave2`) | 12 passed |

New tests: critical criteria exported as hard failures; Wave 2 and 3 person steps behind exact decisions; fraud lists,
hidden hand-off, per-exception severity; Q4 per-query fields, 20-query limit, generated criteria weights;
clustering F1 (`cluster-f1.test.ts`) and its RL review score end to end; help chatbot knowledge, template guides,
SME route, Gemini path and ranking (`support-authoring.test.ts`).
