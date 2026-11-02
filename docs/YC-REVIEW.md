# YC repository review — 1 November 2026

Application source reviewed at `960555fe`, branch `codex/praxis-anvil-harbor`.
This documentation check-in does not change runtime code, deploy or publish a repository.
The authoritative application Git root is `adi-praxis/adi-praxis`; outer-folder archives,
`praxis-deploy` and `praxis-fix-gcs` are not dependencies or authoritative source copies.

## Verification in this review

| Command | Result |
| --- | --- |
| `pnpm --filter @praxis/shared test` | 121 passed in 10 files, including 20 Praxis contract tests |
| `pnpm typecheck` | Passed across all five workspace packages/apps |
| `pnpm --filter @praxis/mcp-replay test` | 2 passed |
| `pnpm --filter @praxis/api test -- test/taskflow.test.ts test/dataset.test.ts test/rbac.test.ts` | 452 passed in 27 files, 93.80s; this invocation ran the full API suite rather than filtering files |
| `pnpm test:e2e` | 13 assertions passed, 1 deployed-only check skipped; shutdown stalled and the owned runner was interrupted after 3.3m, exit 130. Overall command incomplete |
| Local Markdown target check; `git diff --check` | Passed for the three documentation files |

The browser run logged a null-user `roles` access at
`apps/web/app/(console)/review/applications/page.tsx:20` during the session-reset
journey. The redirect assertion passed, but this logged defect and the shutdown hang
remain unresolved; neither is hidden by the passing assertions. Only the owned test
runner was interrupted. Generated Next.js E2E configuration changes were restored to
their clean starting contents; no application source change was made.

The historical
[M10 status](M10-STATUS.md) records earlier results and intermittent local database
stalls; those counts must not be represented as fresh passes at this revision.
The [Release 1.1 coverage map](testing/COVERAGE.md) is manual case mapping, not automated
coverage or proof of a current passing full suite. No code-coverage percentage is claimed.

## Reviewer paths

- [Shared executable-contract tests](../packages/shared/test/praxis-contract.test.ts)
  cover validation and single/staged fixture boundaries.
- [Task flow](../apps/api/test/taskflow.test.ts), [task/dataset workflow](../apps/api/test/tasks.test.ts)
  and [access controls](../apps/api/test/rbac.test.ts) cover durable human decisions,
  exports and authorization. Tests use a dedicated test database.
- [Browser smoke](../e2e/smoke.spec.ts) and [M10 journeys](../e2e/m10.spec.ts) exercise UI flows.
- [Synthetic export fixtures](../contracts/praxis/) contain no customer cases.
- [Architecture](ARCHITECTURE.md) describes the implemented components and export boundary.

## Publication preparation

Existing remote: `https://github.com/vasudevansundarababu-dev/adi-praxis.git`.
The user subsequently authorized public publication and an existing-target GCP release
on1 November2026. The earlier documentation-only restriction is superseded for this
release. Preserve existing release branches and unrelated work; publish only explicitly
reviewed Git branches, never local Codex checkpoint refs or untracked SDK artifacts.

The tracked-file scan checked 607 baseline paths for private-key blocks, common provider-token
formats, service-account JSON and credential-bearing URLs. No private key, provider-token
or service-account match was found. The ten URL matches are loopback-only development/test
defaults or Terraform interpolation expressions, not discovered live credentials. This
is a scoped working-tree scan, not a guarantee
about Git history or all possible secrets/private data. Office document XML was also
scanned (11 parts, no provider-token/private-key matches). Tutorial PDFs/video contents
were inventoried but not visually reviewed; this is not a public-media clearance.

Local `.env`, build outputs and test results remain ignored. Two pre-existing untracked
Google Cloud SDK artifacts must stay outside the checkpoint. No local credentials or
raw logs belong in reviewer docs. A fresh dependency install, production build, live-provider test and remote CI were not
rerun in this documentation task. Live payout qualification, broad intake field mapping,
Praxis v3 authoring and current GCP sign-in verification remain outside these results.

The existing GCP target is `adi-praxis-test-0928/us-central1`, with console at
https://praxis-web-yu2jtyqhea-uc.a.run.app. It is a test/demo configuration with real
Vertex AI and simulated candidate identity/sign-in/email. Cloud SQL currently has
public IPv4 and automated backups disabled; a successful on-demand pre-release backup
is required before migrations. This differs from the private Terraform target.
The pending release must record the newly verified version and smoke results here.
Share credentials privately; never add passwords,
keys, session cookies or sign-in tokens to this repository.
