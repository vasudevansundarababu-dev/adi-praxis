# Releases, branches and defect fixes

Decided 28 Sep 2026. Applies from release 1.0 onward.

## Branches

| Branch | Purpose | Who merges |
| --- | --- | --- |
| `release/1.0` | Frozen 1.0 code under test by the India test team. Defect fixes only; no features, no refactors. | Product owner, by pull request |
| `main` | Next release. New work (starting with M9, the SME supply module) is built here. | Product owner, by pull request |
| `mN-*`, `feat/*` | Feature branches cut from `main`, merged back by pull request. | |
| `fix/issue-<n>`, `agent/issue-<n>` | One defect each, cut from `release/1.0`. | |

`release/1.0` was cut from `main` at `9ef51ef` (docs(testing): vertical issue-lifecycle diagram).

## Rule: every tester defect is fixed in both branches

1. Branch `fix/issue-<n>` (or the agent's `agent/issue-<n>`) from `release/1.0`. Write the failing test first, then the smallest fix.
2. Open the pull request with base `release/1.0`. CI must be green. Merge with squash, keeping `Issue: #<n>` in the message.
3. Forward-merge `release/1.0` into `main` through a pull request titled `Merge release/1.0 into main`. Use a merge, not a cherry-pick, so no fix can be skipped. Resolve conflicts on the `main` side only.
4. The issue gets `fixed:release-1.0` after step 2 and `fixed:main` after step 3. Testers verify on the 1.0 test build. The issue closes as `status:verified` only when both labels are present.
5. A defect in code that exists only on `main` (new M9 work) is fixed on `main` only and labelled `fixed:main`.
6. Never merge `main` into `release/1.0`.

## Tags and deployment

- `release.yml` deploys any `v*` tag to production as a 10% canary. Tag `v1.0.0` on `release/1.0` only after the test team signs off. Later fixes are `v1.0.1`, `v1.0.2`, and so on.
- The nightly test build deploys `release/1.0` while 1.0 is under test (see the workflow changes below).
- `deploy-staging.yml` keeps deploying `main` to staging, so staging shows the next release.

## Workflow changes needed (not yet applied; need product owner approval)

1. `nightly-build.yml`: add a `ref` input defaulting to `release/1.0`; check out and deploy that ref; compare against the last `nightly-*` tag on that branch.
2. `nightly-agent.yml`: create `agent/issue-<n>` from `release/1.0` and open the pull request with `--base release/1.0`.
3. New `forward-merge.yml`: on every push to `release/**`, open or update a pull request from that branch into `main`, labelled `forward-merge`.
4. `labels.yml`: add `fixed:release-1.0`, `fixed:main` and `forward-merge`.
5. `issue-commands.yml`: `/verified` closes an issue only when both `fixed:*` labels are present.
6. GitHub branch protection on `release/1.0`: pull request required, CI required, no force pushes, no deletion.
