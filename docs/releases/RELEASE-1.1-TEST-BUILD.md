# Release 1.1 test build: merge and tester deployment plan

> **Update 30 Sep 2026:** the merge moved to Wednesday 30 Sep (fast-forward of `main`, owner's choice) and the build
> label to `test-1.1-20260930`; testers start Thursday 1 Oct, 09:30 IST. Testers report in the private repository
> `adi-praxis-testing` (`infra/test/create-tester-repo.sh`). The tester email is `docs/releases/TESTER-EMAIL-1.1.md`.

| | |
| --- | --- |
| Date | Monday 28 September 2026 |
| Merge | 1:00 PM CDT (11:30 PM IST) — `m10-sme-supply` → `main`, by pull request, merged by the product owner |
| Deploy | 1:30 PM CDT (12:00 AM IST) — `main` to the tester environment `adi-praxis-test-0928` (same URLs as today) |
| Testers start | Tuesday 29 September, 9:30 AM IST (Monday 11:00 PM CDT) |
| Owner | Vasudevan Sundarababu (product owner, merge and go/no-go) |
| Decision | The build replaces release 1.0 in the tester environment (owner, 28 Sep 2026). Testers test 1.0 regression and the new features on one build. |

## 1. What is in the build

`main` today is 1.0 (`d5326ae`) plus 10 commits from `m10-sme-supply` (a fast-forward; `main` has no other changes):

| Area | What testers get | Spec |
| --- | --- | --- |
| M10a Partners and requisitions | Partners, partner portal (`/partner`), Partner API v1, requisitions, candidate submissions, duplicate ownership, invites, careers page | `docs/SME-SUPPLY.md` §3–5 |
| M10b Guidelines → certification | Upload guidelines; generated knowledge map, course, blueprint and question families per tier (real Claude); Admin approval and publish; course, timed test with selfie check, retakes, human review of written answers | §6–7 |
| M10c Payments | Rate cards, earnings ledger (append-only), weekly pay runs with PM confirm and Finance approve, simulated payout provider, reconciliation exceptions, partner fee statements; new **Finance** role | §8 |
| M10d Screens | Console, partner portal and candidate screens for all of the above | §12 |
| UI usability | Red-asterisk required-field markers on every screen of all three apps; two-level console menu; **Support Bot** (Help button) in the console and partner portal | `docs/SUPPORT-BOT.md` |
| Label change | The internal REVIEWER role is shown as **Validator** everywhere | `docs/DECISIONS.md` M10a |
| Test-env aids | Invite link shown to partners in the test environment only; invite links are single-person (fix); issue forms with Partner and Finance personas and new labels | `docs/DECISIONS.md` "Release 1.1" |

Tester material: `docs/testing/WHATS-NEW-1.1.md`, the updated `docs/testing/README.md` and test cases (`TEST-CASES.md`,
`test-cases.csv`), and the email in section 7.

## 2. Timeline (Monday 28 September)

| CDT | IST | Step | Who | Done when |
| --- | --- | --- | --- | --- |
| 9:00–12:00 | 7:30 PM–10:30 PM | Prepare: tester pack, demo data, deploy switch, release notes (this document) | Claude | Committed on `m10-sme-supply` |
| 12:00 | 10:30 PM | **Code freeze** on `m10-sme-supply`; final local checks (section 3) | Claude | All checks green |
| 12:30 | 11:00 PM | **Go / no-go** (section 4) | Owner | Decision recorded in the PR |
| 1:00 | 11:30 PM | **Merge**: open PR `m10-sme-supply` → `main`; CI green; owner merges | Owner | `main` = merge commit, CI green on `main` |
| 1:05 | 11:35 PM | Tag `test-1.1-20260928` on the merge commit | Claude (on request) | Tag pushed |
| 1:30 | 12:00 AM | **Deploy** to the tester environment (section 5) | Owner runs, or Claude with approval | Script prints "Ready" |
| 2:15 | 12:45 AM | Smoke checks (section 6) | Claude / owner | All pass |
| 2:30 | 1:00 AM | **Send the tester email** (section 7); send passwords separately | Owner | Email sent |
| 3:30 | 2:00 AM | Scheduled nightly build redeploys `main` (same code, flag on) | GitHub Actions | Banner shows the nightly label |
| 11:00 PM | 9:30 AM Tue | Testers start with the day-1 order in `WHATS-NEW-1.1.md` | Test lead | — |

## 3. Pre-merge checks (by 12:00 CDT)

- [ ] `pnpm typecheck` (all workspaces) green.
- [ ] API tests: `apps/api` Vitest suite green. The last full local runs passed 432–433 of 434 because the local Docker
      Postgres stalls for ~15 minutes at random (see `docs/M10-STATUS.md`); each timed-out test passed on re-run.
      **CI on the pull request is the gate** — it runs on a clean database.
- [ ] Browser tests: `pnpm test:e2e` — 7 passed, 1 skipped (deployed-only) on 28 Sep.
- [ ] Tester pack regenerated: `node docs/testing/build.mjs`.
- [ ] `docs/RELEASES.md` updated for the decision (tester environment runs `main`).
- [ ] Nothing secret in the diff (`.env` values, keys); `google-cloud-sdk/` and `tester-email/` not committed.

## 4. Go / no-go (12:30 CDT)

Go if all are true:

1. Section 3 is green (CI on the pull request included).
2. The owner accepts the known limitations in section 8.
3. Someone can run the deploy between 1:30 and 2:30 PM CDT and do the smoke checks.

No-go: postpone the merge to the next day at 1 PM CDT; testers continue on 1.0 unchanged.

## 5. Deploy steps (1:30 PM CDT)

Run from a clean checkout of `main` at the merge commit, with `gcloud` signed in as an owner of `adi-praxis-test-0928`
(`gcloud` is at `<repo>/google-cloud-sdk/bin`).

```bash
git checkout main && git pull
export PATH="$PWD/google-cloud-sdk/bin:$PATH"
PRAXIS_VERTEX=1 PRAXIS_SME_SUPPLY=1 PRAXIS_ENV_LABEL="Test environment" \
PRAXIS_BUILD=test-1.1-20260928 \
  infra/demo/deploy-demo.sh adi-praxis-test-0928 <test-project-billing-account-id>
```

- This first deploy must be a **full run** (no `DEPLOY_ONLY`): it creates the two new passwords in Secret Manager
  (`demo-finance-password`, `demo-partner-password`). Existing resources are reused.
- It builds the images, runs the database migrations (M10a–c add tables only; nothing is dropped), deploys the API,
  worker, console and candidate app with `SME_SUPPLY_ENABLED=true`, and adds the test data: `finance@praxis.demo`,
  partner "Demo Staffing Partner" with portal login `partner@praxis.demo`, rate card "KYC authoring (USD)" and the open
  requisition "KYC authors — India (Annotator)" on the "KYC authoring demo" project.
- The script prints all logins at the end. Share passwords through the password manager only, never by email.
- From tonight, the nightly build (`.github/workflows/nightly-build.yml`) deploys `main` with the same switch.

## 6. Smoke checks after deploy (2:15 PM CDT)

| # | Check | Pass when |
| --- | --- | --- |
| 1 | `GET <api>/api/v1/version` | Build `test-1.1-20260928`, `ai: vertex` |
| 2 | Console sign-in as Admin | Two-level menu: Home, Projects, Reviews, Certification, Partners, Payments, Admin; yellow banner with the build |
| 3 | Admin → Partners | "Demo Staffing Partner" listed |
| 4 | Sign in as `finance@praxis.demo` | Menu: Home and Payments only; Pay runs page opens |
| 5 | `<console>/partner/login` as `partner@praxis.demo` | Partner portal home; requisition "KYC authors — India (Annotator)" listed |
| 5a | Partner submits a synthetic candidate on that requisition | Confirmation shows the yellow "Test environment: invite link" box; the link opens the candidate app |
| 6 | Help button on any console page → "What do I need to fill in on this screen?" | An answer within ~10 s, or the "not available right now" message (see risk R1) |
| 7 | Admin → Certification → Guidelines → upload `docs/testing/samples/kyc-procedure-notes.pdf` | A generation run starts; SUCCEEDED within ~10 minutes, or FAILED with a quota error (risk R1) |
| 8 | Candidate app → sign in with the mock → header | "Certifications" and "Payments" links present |
| 9 | Any form (e.g. Projects → New project) | Red asterisks and "Fields marked * are required." |
| 10 | Existing 1.0 journey: TC-E2E-001 first three steps | Unchanged behaviour |

If checks 1–5 or 10 fail: roll back (section 9). Checks 6–7 failing on quota only: go ahead and tell testers (R1).

## 7. Tester email

Prepared as `tester-email/ADI Praxis - Release 1.1 test build.eml` with the updated tester pack attached (open it in
Mail or Outlook, add the recipients, check, send). Passwords are **not** in the email.

## 8. Known limitations and risks

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | Claude quota on Vertex in `adi-praxis-test-0928` returned 429 earlier | Course/test generation fails; Support Bot says "not available right now" | Raise the Claude quota before the deploy; testers report it once, labelled `environment` |
| R2 | Payouts use the simulated provider; the Trolley adapter is untested against a real account | Real payouts cannot be tested | Out of scope for this build (sandbox check before production) |
| R3 | Selfie check, identity, Google sign-in and email are simulated | Invites are not emailed | Testers use the partner portal response or the careers page (guide explains) |
| R4 | Some screens show short SME ids instead of names; no CV upload; partners cannot manage their own users | UX findings expected | Listed in the tester briefing as known; raise only if blocking |
| R5 | Testers see a different menu and the "Validator" label | Retraining | `WHATS-NEW-1.1.md` explains; day-1 order starts with navigation |
| R6 | 1.0 defects found this week | Fix policy changes | `docs/RELEASES.md` updated: fixes go to `main` and the next nightly build |

## 9. Rollback

The M10 migrations only add tables, columns and enum values, so the 1.0 code runs on the migrated database.

```bash
git worktree add ../praxis-1.0 release/1.0 && cd ../praxis-1.0
PRAXIS_VERTEX=1 PRAXIS_ENV_LABEL="Test environment" PRAXIS_BUILD=rollback-1.0-$(date +%Y%m%d) DEPLOY_ONLY=1 \
  infra/demo/deploy-demo.sh adi-praxis-test-0928 unused
```

Then pause the nightly build (disable the workflow in GitHub) so it does not redeploy `main`, and tell the testers.

## 10. After the release

- Record the go/no-go and merge commit in this file.
- Update `docs/M10-STATUS.md`: M10 merged to `main` and deployed to testers.
- Daily: triage the new issues (`docs/testing/TRIAGE.md`); the nightly agent opens fix PRs against `main`.
