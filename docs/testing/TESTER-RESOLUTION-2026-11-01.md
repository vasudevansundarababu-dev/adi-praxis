# Praxis tester backlog — 1 November 2026

## Active request and checkpoint

User authorized analysis/fixes for all issues in `vasudevansundarababu-dev/adi-praxis-testing`,
a reviewed Praxis PR, and deployment to the existing GCP test environment. They also
requested ongoing monitoring and authorized input-request emails to admin@adi-labs.ai.
No routine emails or SMS; SMS is unavailable. Continue independent work while input waits.

- Inventory:161 reports,159 open,2 closed; issue#161 was latest at initial retrieval.
- Fix branch: `codex/praxis-tester-fixes`, based on verified release32a97f9d.
- Runtime baseline: ddc8446b /yc-ddc8446b-20261101, existing four Cloud Run services in
  `adi-praxis-test-0928/us-central1`. Do not replace targets, users, databases or credentials.
- Raw issue bodies/comments are private local research artifacts at
  `/private/tmp/praxis-tester-review/issues.json`, backed up in ignored Anvil
  `.local/praxis-tester-monitor/initial-issues.json`. Fetch all pages if these are absent.
- Current code review confirms generic Fastify errors/no custom404 envelope, permissive
  dataset bigint coercion, and missing operation-level OpenAPI security metadata. No fix
  is claimed yet. Login threshold report#151 explicitly says QA could not reproduce it.
- Source/working tree initially clean except pre-existing untracked SDK directory/archive;
  preserve these and never commit/upload them. Do not alter Anvil for Praxis bug fixes.
- PR not created, no tester issues closed, no defect changes deployed at this checkpoint.

## Work order and evidence rules

1. Inventory all reports/comments; group shared causes and compare current code/deployment.
2. API/security: error envelopes, bounded cursors, unknown fields, request-size handling,
   OpenAPI audience declarations and idempotency. Never weaken authorization for a test.
3. Candidate privacy/profile: redaction, explicit clearing, required answers, identity,
   completion state, evidence validation/filenames/upload progress and resubmission.
4. Workbench: draft/version state, validation locations, read-only/access boundaries,
   autosave/navigation, task counts, evidence lists and source-data detection.
5. Console/finance/partner: scoped access, decision forms, dates, reconciliation/idempotency,
   pay-run transitions, matching/assignment explanations and partner lifecycle feedback.
6. Shared UI: navigation, contrast, timezone/hydration, empty/error/loading/success states.
7. Run meaningful shared/API/browser regressions. Create PR with exact issue mapping,
   review diff, snapshot database, deploy only verified changes with SKIP_DEMO_SETUP=1,
   then verify actual deployed version/readiness and issue-specific behavior.

Mark each issue Fixed only with a concrete change and passing meaningful regression.
Distinguish already resolved, not reproduced, duplicate, product question and external
blocker. Old screenshots/test builds do not establish current failure. Do not close issues
or tell testers they are fixed without evidence. Never make paid AI/payout/email calls
for regression tests; controlled providers are software checks, not model quality.
No main merge or default-branch mutation is authorized. Push only the reviewed codex branch.
Night implementation window22:00–06:00 America/Chicago; daytime monitor/triage only unless
separately requested. Resume here after interruption; do not repeat completed YC rollout.

## Issue matrix

### Fifth batch — 2 November, 04:25 America/Chicago

Implemented #113: NEEDS_INFORMATION resubmission returns 409 PROFILE_UNCHANGED until
answers change. A separate deterministic answer projection excludes provenance-only
changes, generated episode/claim IDs and ordering. The existing immutable profileHash
is unchanged and still covers full provenance. Regression covers direct resubmission
without an amendment, unchanged-value editing, transaction rollback/no extra version or
assessment, successful changed-answer resubmission, and exact preservation of the frozen
original profile/decision history.

Implemented #123: phone workbench uses a subscribed viewport state, native disabled
controls and an autosave update guard; draft actions obey the same read-only state.
Hydration starts read-only. A guarded local UI fixture verifies keyboard attempts cannot
change values or issue saves on phone, desktop editing invokes autosave, and resizing
back restores read-only behavior. Browser saves are intercepted for this UI-only fixture;
staffing/identity/permission gates in the running app are not bypassed or changed.

Passed: targeted selection suite 34 tests; all-package typecheck; full API 478/478 in
29 files; full browser 17 passed / one deployment-only skip, clean exit after slow shutdown
(5.7 minutes); production build. Initial test helper incorrectly expected the success-only
submit helper to return a response; corrected to the real request helper. The initial
workbench query omitted the accessible required suffix; corrected to the actual label.
An optional bounded diagnostic run was stopped when the original full run completed;
it is not counted as a passing test. No paid calls, production identity decisions,
issue closures or main merge. This batch is not deployed at this checkpoint. Continue
with successful backup verification, clean release checkout and actual rollout checks.
No new tester changes or reply to the pending scope email were found.

### Fourth batch deployed — 2 November 2026

Clean release commit `d1eaa89d`, build `tester-d1eaa89d-20261102`, image tag
`d1eaa89d-1793611641`; source checkout `/private/tmp/praxis-tester-release-d1eaa89d`.
Backup `1793610984231`, Cloud Build `e2a4a49d-f837-49ca-86db-edb9dd16dad5` and
migration `praxis-migrate-wj8kv` all succeeded. Ready/100% traffic revisions:
API `praxis-api-00012-znt`, worker `praxis-worker-00012-6mb`, console
`praxis-web-00012-zrm`, candidate `praxis-candidate-00012-bln`.
Private before/after snapshots confirm existing environment values preserved except
build/commit metadata. DEPLOY_ONLY=1 / SKIP_DEMO_SETUP=1; no reseeding or paid calls.

Passed deployed checks: exact commit/build, DB/Redis readiness, both sign-in pages,
existing PM sign-in and consistent product 404s on API and both proxies. Local tests
establish #50 age restrictions, #52 truthful progress, #57 draft/withdrawn wording and
read-only saved destination, #60 explicit UTC submission date. Full API 477 passed;
full browser 16 passed / one deployment-only skip; final focused browser 1 passed;
all-package typecheck/build passed. No real identity decisions were made for smoke tests.

No issues closed or main merge; PR #5 remains draft while backlog work continues.
The existing Admin credential limitation remains unchanged. Next milestone is #113:
reject unchanged NEEDS_INFORMATION resubmission without changing immutable profile hashes
or prior versions. Compare substantive answers separately from provenance so simply
reconfirming the same value cannot bypass the check. Then continue workbench/finance.
Scope clarification email still has no reply. Preserve generated Next config edits,
SDK artifacts and all unrelated work; continue using clean release checkouts.

### Fourth batch — 2 November, 03:25 America/Chicago

Implemented #50: confirmed under-18 candidates cannot start/resume an opportunity
application or submit a profile. Opportunity/home/review screens explain the restriction
instead of inviting an impossible verification step. Direct and partner-invite entry
paths use the same application check. Pending/restarted checks cannot mask the most
recent authoritative age result. A later valid adult verification restores access;
existing approved alternative verification remains honored. Test-only results are
ignored by the restriction query when live verification is required. No DOB is stored.

Implemented #52/#57: status progress uses actual identity eligibility and submittedAt;
unsubmitted drafts are not marked completed. Draft/withdrawn links describe saved drafts,
and a withdrawn never-submitted draft opens as read-only saved content, not a false
submission confirmation. Implemented #60: submitted-profile dates use explicit en-GB
month names and UTC on server/client, removing numeric-date ambiguity.

Passed: targeted API suites 70 tests; full API suite 477/477 in 29 files; full browser
suite 16 passed / one deployment-only skip with clean exit; final focused browser flow
1/1 after the withdrawn destination correction; final all-package typecheck/build.
Initial full-browser assertions passed but cleanup stalled (runner terminated, exit 143);
all manually owned API clients/pages now close, and the clean full rerun passed. An
earlier local fixture missed the worker's REVIEW_PENDING transition; the guarded e2e-only
selection fixture now accepts that precondition. Production review gates are unchanged.

No paid calls, real identity decisions, issue closures or main merge. Backup
1793610984231 succeeded. No tester issue/comment changes were found. This batch is not
yet deployed at this checkpoint; create a clean isolated release checkout and verify
the existing target after rollout. Next unfinished groups remain #113 and workbench.

### Third batch deployed — 2 November 2026

Release `94dc7963` / `tester-94dc7963-20261102`, image tag `94dc7963-1793607676`,
built from clean detached checkout `/private/tmp/praxis-tester-release-94dc7963`.
Backup `1793607314505` succeeded before rollout. Clean Cloud Build
`2542564e-f34b-4300-801e-329d2e2db774` and migration `praxis-migrate-bn69s` succeeded.
All services Ready/100% traffic: API `praxis-api-00011-gpp`, worker
`praxis-worker-00011-qhc`, console `praxis-web-00011-2dj`, candidate
`praxis-candidate-00011-z2n`. Existing runtime environment values are unchanged except
release metadata. DEPLOY_ONLY=1 / SKIP_DEMO_SETUP=1; users/data preserved.

Passed post-deployment: exact commit/build, DB/Redis readiness, both sign-in pages,
existing PM sign-in and product 404 envelopes on API and both app proxies. No paid calls
or real identity decisions. Local suite: 476 API tests, expanded browser journey,
all-package typecheck/build passed. Additional verified reports: #49, #101, #114, #115.
No issues closed. Existing Admin credential limitation remains; not reset or retried.

Release packaging correction: working-folder uploads included ignored output and tester
email artifacts, plus generated config changes. Initial third build
`75c1fc4e-43f6-4234-b432-35276931c6a7` was cancelled before migrations/rollout. The clean
replacement uploaded only 616 files / 49.5 MiB instead of 734 / 607.4 MiB. No local files
were discarded. `.gcloudignore` now includes `.gitignore` and excludes tester-email*,
.local and desktop metadata; filename audit finds zero output/email/log artifacts.
Prior source archives were not deleted; their bucket has uniform access controls and
no public IAM binding. No IAM policy changes were made for this packaging correction.

For future releases, build from a clean isolated checkout of the reviewed commit, not
the working folder. Preserve the original checkout's unrelated/generated edits and SDK.
Next work: candidate eligibility (#50), status/journey clarity (#52/#57/#60), unchanged
resubmission (#113), then workbench and finance/partner matrix. Scope question email is
still awaiting reply; latest inventory/comment refresh found no changes and REST comment
counts confirm all comments were fetched for all 161 reports. Content hashes are stored
only in ignored monitor state to distinguish substantive edits from timestamp noise.

### Third batch — 2 November, 02:20 America/Chicago

Implemented #49: browser rejects evidence larger than 10 MiB before dispatch; file input
resets after success/failure so the same file can be chosen again. Exactly 10 MiB remains
allowed. API boundary test accepts a valid-signature 10 MiB fixture and refuses 10 MiB+1
and 12 MiB with product 413 errors; only the accepted artifact is persisted. The proxy
and API error-envelope repairs from the first batch remain part of this behavior.

Implemented #101/#114/#115: onboarding rejects duplicate languages, undefined proficiency
levels and unknown time zones, using the same CEFR/IANA choices as the screen. Known
time-zone aliases are canonicalized. Invalid preferences create no acknowledgement and
leave the checklist incomplete. The language selector disables already selected options
and adds an unused language. Existing stored records are not rewritten.

Passed: all-package typecheck and production build; targeted API suites 66 tests; latest
full API suite 476/476 in 29 files; expanded real-browser flow 1/1 for privacy, clearing,
oversized rejection with zero requests, same-file retry and unique-language onboarding.
Initial new browser assertions used an exact wrapping-label query and an unsupported
disabled-option matcher; corrected to the actual accessible combobox and native disabled
attribute. Product behavior was unchanged by those test corrections. No paid calls.
This batch is not yet deployed at this checkpoint. No tester updates or email reply to
the existing app-scope question were found. Continue backed-up rollout and release checks.

### Second batch deployed — 2 November 2026

Verified release `bb8d7952` / `tester-bb8d7952-20261102`, image tag
`bb8d7952-1793603675`. Backup `1793603592772` succeeded before rollout; Cloud Build
`7acf8cac-ef36-4701-9e98-c949b9054ca2` and migration execution
`praxis-migrate-9bf79` succeeded. DEPLOY_ONLY=1 / SKIP_DEMO_SETUP=1; no reseeding,
paid calls, issue closures or main merge. All four services Ready, 100% traffic:
API `praxis-api-00010-zhw`, worker `praxis-worker-00010-xwb`, console
`praxis-web-00010-d56`, candidate `praxis-candidate-00010-drf`.

Post-deployment: exact commit/build, database/Redis readiness, both sign-in pages,
existing PM sign-in, API and both proxy unknown-route envelopes passed. Private service
snapshots confirm all environment settings unchanged except release metadata. Existing
Admin credential limitation from batch one remains; it was not retried or reset.
Local meaningful regressions: 475 API tests, one expanded browser flow, all-package
typecheck and production build passed. No real identity decisions were made for a smoke test.

Verified additional fixes: #59 (reversed role dates), #62 (separate evidence-upload activity),
#69 (identity-review project scope). #160 is additionally verified against the live exact
reported endpoint with an existing PM session: 2 MiB and 10 MiB POST /projects return
413 REQUEST_TOO_LARGE with request IDs; this behavior came from batch one's proxy fix.

Scope question emailed to admin@adi-labs.ai for #44, #81 and #130, whose reports explicitly
point to the different ADI Interview staging application. Leave them unverified until the
user/testers clarify the intended app. Other Praxis work is independent and can continue.
Resume remaining candidate UX/validation, then workbench/finance/partner matrix groups;
do not redeploy these unchanged batches. PR #5 remains draft while the backlog continues.

### Second batch — 2 November, 01:15 America/Chicago

Implemented #69: project-scoped identity queue and decision authorization; Admins retain
tenant-scoped pre-enrollment handling. Regression covers unassigned denial, assigned
access, revoked assignment denial without state change, reassignment, cross-tenant denial
and successful authorized decision. Implemented #59: reversed role dates are rejected on
add/edit without replacing saved state; equal start/end month remains valid.
Implemented #62: upload activity has separate state, an indeterminate progress indicator
and failure recovery; submission keeps its label and is disabled while uploading.

Checks passed: all-package `pnpm typecheck`; full API suite **475/475 in 29 files**;
focused real-form browser regression **1/1**, including held upload, unchanged submit label,
controlled failure and enabled retry; all-package `pnpm build`. Earlier targeted API run
67/67 passed before the final role-date case was added; full run includes the final case.
No paid calls. This batch is not deployed at this checkpoint; first batch remains live.
The hourly issue/comment refresh found no changes. Preserve generated Next config files
and unrelated SDK artifacts. Continue with backed-up rollout and exact release checks.

### Deployed batch — 2 November 2026

First tested batch deployed successfully to the existing four GCP services. Release
commit `bddecadc`, build `tester-bddecadc-20261102`, image tag `bddecadc-1793599892`.
Cloud Build `b43d68bd-c8c1-42b7-a6f0-60671380ff31` succeeded; migration execution
`praxis-migrate-5brkw` completed successfully. Backup `1793599794285` was SUCCESSFUL
before rollout. DEPLOY_ONLY=1 and SKIP_DEMO_SETUP=1 preserved existing users/data;
private before/after snapshots confirm runtime environment values unchanged except
release build/commit metadata.

Ready revisions: API `praxis-api-00009-6t9`, worker `praxis-worker-00009-679`, console
`praxis-web-00009-b8f`, candidate `praxis-candidate-00009-s5x`, each serving 100% traffic.
Deployed checks passed: exact version/build, database/Redis readiness, both sign-in pages,
existing PM sign-in/session cookie, unknown-route product envelopes on API and both apps,
unknown write fields (400) and oversized JSON (413) through both apps, OpenAPI operation
authentication and mock-only entries. No paid calls, reseeding or issue closures.

Limitations: the saved demo Admin password returned 401; it was not reset or substituted.
Authenticated deployed dataset checks were therefore not run; local real-database cursor
regressions passed. First Python smoke attempt failed on its local CA bundle; rerun with
the system CA bundle passed TLS verification. No TLS checks were disabled.

Verified fixes in this batch: #47, #66, #67, #76, #78, #117, #158, #159, #161.
#51 has corrected readiness guidance; #77 remains a mitigation awaiting intermittent
retest; #155 has verified authentication documentation but its separate partner-token
observation remains unverified. No claim that all reports are resolved. PR #5 remains
draft as the backlog continues. Next group: identity-review project access (#69),
evidence upload state/progress (#62), role date validation (#59), then remaining matrix.

### Follow-up checkpoint — 2 November, 00:15 America/Chicago

Hourly inventory refresh: no new/reopened reports or changed comment cursors.
Dedicated local browser regression `tester-profile-form.spec.ts`: **1 passed**. It
uses the actual candidate form to save sensitive identifiers, checks redacted values
replace typed input, edits to a generic answer, clears it, navigates to review, verifies
submission is disabled, reopens the form and checks the persisted answer is absent.
This supplies browser evidence for #47, #76 and #78; #77 remains an intermittent retest.
Initial fixture used the wrong opportunity response field and failed before reaching the
form; corrected to the documented opportunityId and passed without product changes.
Production source/build is unchanged from the previously verified batch.
GCP login is valid; pre-rollout service snapshots are stored privately. On-demand database
backup is in progress. No rollout or new issue closure is claimed at this checkpoint.

Current published checkpoint: implementation commit `6d1d7078`, draft
[PR #5](https://github.com/vasudevansundarababu-dev/adi-praxis/pull/5), based on the
existing release branch. Main is unchanged. No tester issue is closed and no new rollout
has occurred. Final API-contract rerun: 15 passed, including authenticated candidate
empty-JSON handling (the first attempt correctly rejected an internal audience with 401;
the test fixture was corrected rather than weakening authentication).

Resume with dedicated form-browser clearing/privacy checks, final batch review and a
backed-up deployment to existing targets; then continue the remaining root-cause groups.
Unstaged Next-generated tsconfig changes and unrelated SDK artifacts remain untouched.

### Night checkpoint — 1 November, 23:30 America/Chicago

First batch is implemented locally; not yet pushed or deployed. It covers product API
error envelopes (#67, #161), signed-bigint dataset cursor validation (#158, #159),
unknown write fields (#117), API audience documentation and demo-only reference entries
(#66, documentation portion of #155), and bounded same-origin request handling.
Manual profile corrections now redact sensitive identifiers before persistence (#47).
Form clearing sends CLEAR rather than silently ignoring empty edits (#76, #78); saved
server values replace typed values and the router cache is refreshed (#77 mitigation).
Review copy now reflects the real submission blockers (#51).

Evidence so far:

- `pnpm typecheck`: all five packages passed after both implementation groups.
- `pnpm --filter @praxis/shared test`: 126 passed, including five proxy tests.
- `pnpm --filter @praxis/api test`: 467 passed before the profile changes.
- `pnpm --filter @praxis/api exec vitest run test/tester-profile-corrections.test.ts`:
  five passed after repairing missing request metadata in the initial test fixture.
- `pnpm --filter @praxis/api exec vitest run test/sme-profile.test.ts`: 31 passed,
  including real endpoint/database privacy verification with a controlled assistant.
- First browser run: eight passed, two failed, one skipped, three not run. A configuration
  cleanup triggered Next dev restarts during that run; rerun started with stable files.
  Do not count either failure as resolved until the rerun exits successfully.
- No paid model calls, production data edits, issue closures or deployment in this batch.

Follow-up: browser suite now exits successfully: **15 passed, one deployment-only check
skipped**. Explicit API-context disposal fixes the prior teardown stall. Both same-origin
proxies passed 2 MiB and 10 MiB request checks and unknown-route envelope checks.
`pnpm build` passed for all production packages. No paid providers were invoked.

Remaining verification: browser
regression for form clearing and request-size handling, final diff review, exact matrix
updates, PR and backed-up deployment. #155's untested partner-token observation remains
unverified. Encoded-NUL API checks do not establish that retired candidate `/jobs` routes
in #44/#130 are fixed. Historical already-saved sensitive data has not been bulk scrubbed.

| Issue | Report | Current status | Change / test evidence |
| --- | --- | --- | --- |
| [#1](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/1) | Testing | Closed in tester repository; not claimed as new fix | — |
| [#2](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/2) | [BUG-001] Login fails with valid credentials when email contains uppercase letters | Closed in tester repository; not claimed as new fix | — |
| [#3](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/3) | Adi Labs/ [DEF-001] Navigation menu layout is inconsistent across pages | Pending detailed reproduction | — |
| [#4](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/4) | Adi Labs/ [DEF-003] Emoji renders as replacement character in candidate avatar | Pending detailed reproduction | — |
| [#5](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/5) | Adi Labs/ [DEF-005] Verification failure is not clearly communicated | Pending detailed reproduction | — |
| [#6](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/6) | Adi Labs/ [DEF-006] File-type validation not enforced for evidence uploads | Pending detailed reproduction | — |
| [#7](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/7) | Adi Labs/ [DEF-007] Professional profile save confirmation disappears too quickly | Pending detailed reproduction | — |
| [#8](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/8) | Adi Labs/ [DEF-009] Withdrawn application remains listed in My applications | Pending detailed reproduction | — |
| [#9](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/9) | Adi Labs/ [DEF-010] No option to reapply to a previously submitted or withdrawn job | Pending detailed reproduction | — |
| [#10](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/10) | Adi Labs/ [DEF-011] Staff-only interview controls visible to candidate | Pending detailed reproduction | — |
| [#11](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/11) | Adi Labs/ [DEF-012] Staff-only refresh control visible to candidate | Pending detailed reproduction | — |
| [#12](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/12) | Adi Labs/ [DEF-013] No clear confirmation or status after proposing an application update request | Pending detailed reproduction | — |
| [#13](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/13) | Adi Labs/ [DEF-014] Saving profile details unexpectedly redirects to a specific application | Pending detailed reproduction | — |
| [#14](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/14) | Adi Labs/ [DEF-015] Profile fields accept invalid special-character and numeric-only input | Pending detailed reproduction | — |
| [#15](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/15) | Adi Labs/ [DEF-016] Resume drag-and-drop upload does not work | Pending detailed reproduction | — |
| [#16](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/16) | Adi Labs/ [DEF-017] No link to Candidate Journey from login page | Pending detailed reproduction | — |
| [#17](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/17) | Adi Labs/ [DEF-018] Login links redirect to an unrelated job application | Pending detailed reproduction | — |
| [#18](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/18) | Adi Labs/ [DEF-019] Home page does not provide navigation to candidate workspace pages | Pending detailed reproduction | — |
| [#19](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/19) | Adi Labs/ [DEF-020] Professional profile loading indicator is barely noticeable | Pending detailed reproduction | — |
| [#20](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/20) | Adi Labs/ [DEF-021] Resume terminology is inconsistent across the application | Pending detailed reproduction | — |
| [#21](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/21) | Adi Labs/ [DEF-022] Login guidance message briefly flashes and disappears | Pending detailed reproduction | — |
| [#22](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/22) | Adi Labs/ [DEF-024] Loading sign-in message briefly appears after login page is rendered | Pending detailed reproduction | — |
| [#23](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/23) | Adi Labs/ [DEF-025] Internal synthetic/staging information is exposed to candidates | Pending detailed reproduction | — |
| [#24](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/24) | Adi Labs/ [DEF-026] Application navigation displays multiple intermediate loading screens | Pending detailed reproduction | — |
| [#25](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/25) | Adi Labs/ [DEF-027] Apply button remains enabled for an already applied job | Pending detailed reproduction | — |
| [#26](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/26) | Adi Labs/ [DEF-028] Empty submitted profile fields are displayed without an indication of their values | Pending detailed reproduction | — |
| [#27](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/27) | Adi Labs/ [DEF-029] Evidence is labelled unavailable without explaining that only inspection failed | Pending detailed reproduction | — |
| [#28](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/28) | Adi Labs/ [DEF-030] Evidence details are displayed as raw structured data | Pending detailed reproduction | — |
| [#29](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/29) | Adi Labs/ [DEF-031] Withdrawn applications are shown as “Closed” without indicating withdrawal | Pending detailed reproduction | — |
| [#30](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/30) | Adi Labs/ [DEF-032] Refresh capture status button provides no visible feedback | Pending detailed reproduction | — |
| [#31](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/31) | Adi Labs/ [DEF-033] Application logo is inconsistent across candidate workspace pages | Pending detailed reproduction | — |
| [#32](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/32) | Adi Labs/ [DEF-035] Protected pages briefly display loading state before redirecting unauthenticated users | Pending detailed reproduction | — |
| [#33](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/33) | Adi Labs/ [DEF-036] Candidate workspace links redirect to Profile before staging workspace opt-in | Pending detailed reproduction | — |
| [#34](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/34) | Adi Labs/ [DEF-037] Withdraw application is final and has no confirmation step | Pending detailed reproduction | — |
| [#35](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/35) | Adi Labs/ [DEF-038] Staff pages and full staff menu open for a candidate account | Pending detailed reproduction | — |
| [#36](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/36) | Adi Labs/ [DEF-039] Raw server validation text is shown, together with an unrelated 'version conflict' message | Pending detailed reproduction | — |
| [#37](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/37) | Adi Labs/ [DEF-040] Evidence form accepts more than five 'Relevant paths' | Pending detailed reproduction | — |
| [#38](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/38) | Adi Labs/ [DEF-041] Evidence 'Relevant paths' accepts parent-directory traversal such as ../../etc/passwd | Pending detailed reproduction | — |
| [#39](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/39) | Adi Labs/ [DEF-042] Evidence URL, branch and commit fields accept malformed values | Pending detailed reproduction | — |
| [#40](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/40) | Adi Labs/ [DEF-043] Required fields on the Add evidence form are not marked as required | Pending detailed reproduction | — |
| [#41](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/41) | Adi Labs/ [DEF-044] Every Save draft adds a new revision and timeline entry, even when nothing has changed | Pending detailed reproduction | — |
| [#42](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/42) | Adi Labs/ [DEF-046] Added evidence cannot be removed or archived | Pending detailed reproduction | — |
| [#43](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/43) | Adi Labs/ [DEF-047] Not-found pages show an unrelated 'version conflict' message | Pending detailed reproduction | — |
| [#44](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/44) | Adi Labs/ [DEF-048] Job URL containing an encoded null character causes a server error | Scope clarification emailed; unverified | Report points to ADI Interview staging; absent current Praxis route. |
| [#45](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/45) | Adi Labs/ [DEF-049] Non-Latin resume file names are replaced with underscores | Pending detailed reproduction | — |
| [#46](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/46) | Adi Labs/ [DEF-050] Valid PDF with a very long file name is rejected with a misleading message | Pending detailed reproduction | — |
| [#47](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/47) | Praxis / SME / Profile form saves bank account, IBAN, PAN and Aadhaar numbers without redaction | Implemented; persistence test passed; browser retest pending | Manual correction redaction; sme-profile.test.ts, 31 passed. |
| [#48](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/48) | Praxis / SME / AI profile chat fails on every answer with "I couldn't process that answer just now" | Pending detailed reproduction | — |
| [#49](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/49) | Praxis / SME / Evidence upload of 10 MB or more fails with a server error and only "Upload failed" | Fixed; tested and deployed | 10 MiB accepted; larger files rejected before browser dispatch; API boundary and same-file retry tests; 94dc7963. |
| [#50](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/50) | Praxis / SME / Under-18 candidate can still start an application and is told to "finish identity verification" | Fixed; tested and deployed | Start/resume/submit age checks; pending rechecks and later adult result regression; UI notice; d1eaa89d. |
| [#51](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/51) | Praxis / SME / Review page says "You can still submit" but Confirm and submit stays disabled when questions are skipped | Pending detailed reproduction | — |
| [#52](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/52) | Praxis / SME / Application status page shows "Verify identity" and "Build profile" as done when they are not | Fixed; tested and deployed | Status progress derives from identity eligibility and actual submittedAt; draft browser checks; d1eaa89d. |
| [#53](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/53) | Praxis / SME / Payments page says "The partner who put you forward pays you" to an SME who applied directly | Pending detailed reproduction | — |
| [#54](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/54) | Praxis / SME / Contributor terms and privacy notice are placeholders although sign-in says the SME agrees to them | Pending detailed reproduction | — |
| [#55](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/55) | Praxis / SME / Sign-in name accepts numbers only, emoji and HTML markup | Pending detailed reproduction | — |
| [#56](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/56) | Praxis / SME / Apply button stays active after applying or withdrawing and silently reopens the old application | Pending detailed reproduction | — |
| [#57](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/57) | Praxis / SME / Draft and withdrawn applications show "View the profile you submitted" | Fixed; tested and deployed | Draft/withdrawn labels and read-only never-submitted destination; browser regression; d1eaa89d. |
| [#58](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/58) | Praxis / SME / Sign-in shows raw validation messages such as "body/name String must contain at least 1 character(s)" | Pending detailed reproduction | — |
| [#59](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/59) | Praxis / SME / A role whose end month is before its start month is saved as "Confirmed by you" | Fixed; tested and deployed | ADD/EDIT reversed date rejection; persistence regression; release bb8d7952. |
| [#60](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/60) | Praxis / SME / Submission date is ambiguous and changes format ("9/10/2026" then "10/9/2026") | Fixed; tested and deployed | Explicit en-GB month name and UTC in submitted confirmation; real submission browser check; d1eaa89d. |
| [#61](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/61) | Praxis / SME / Chat greeting shows "Hi S.." for names that start with an initial | Pending detailed reproduction | — |
| [#62](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/62) | Praxis / SME / "Confirm and submit" changes to "Submitting..." while an evidence file uploads | Fixed; tested and deployed | Separate upload state and indeterminate progress; held-upload/failure browser regression; bb8d7952. |
| [#63](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/63) | Praxis / SME / Home and the status page describe the same application differently | Pending detailed reproduction | — |
| [#64](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/64) | Praxis / SME / Unknown pages show a plain white 404 with no way back | Pending detailed reproduction | — |
| [#65](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/65) | Praxis / SME / Missing 18+ tick is only checked by the server and logs a console error | Pending detailed reproduction | — |
| [#66](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/66) | Praxis / SME / Mock sign-in and identity simulator endpoints are missing from the API reference | Implemented; API regression passed | Mock-only reference entries tested. |
| [#67](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/67) | Praxis / SME / API error reveals the server framework (FST_ERR_CTP_EMPTY_JSON_BODY) | Implemented; API regression passed | Safe framework error envelope; exact empty-JSON case pending. |
| [#68](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/68) | Praxis / Validator / Validator can open Projects and Templates pages, which show misleading empty states | Pending detailed reproduction | — |
| [#69](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/69) | Praxis / Validator / Identity reviews lists candidates from all projects to a Validator assigned to none | Fixed; tested and deployed | Queue/decision project scope; unassigned, revoked and cross-tenant regression; bb8d7952. |
| [#70](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/70) | Praxis / Validator / Identity reviews page throws a React error and shows ambiguous dates | Pending detailed reproduction | — |
| [#71](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/71) | Praxis / Validator / Opening an application that is not available shows a bare 404 page with no way back | Pending detailed reproduction | — |
| [#72](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/72) | Praxis / Validator / Validator with no project assignment gets no hint why the queue is empty | Pending detailed reproduction | — |
| [#73](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/73) | Praxis / Validator / Console sign-in and change-password pages do not show the test-environment banner | Pending detailed reproduction | — |
| [#74](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/74) | Praxis / SME / Credential fields accept meaningless values such as "555tw" and "235234" for every credential type | Pending detailed reproduction | — |
| [#75](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/75) | Praxis / SME / A role with no dates is accepted as "? to now" and can only be removed, not edited | Pending detailed reproduction | — |
| [#76](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/76) | Praxis / SME / Clearing answers in the profile form is silently ignored and the old answers stay "Confirmed by you" | Implemented; browser retest pending | Blank edits send CLEAR; controlled server values. |
| [#77](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/77) | Praxis / SME / Conversation page can show no answered questions right after the form is saved (Intermittent) | Mitigation; intermittent retest pending | Router cache refreshed after save. |
| [#78](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/78) | Praxis / SME / Profile can be submitted after the SME cleared mandatory answers; the cleared answers are submitted | Implemented; browser retest pending | Clearing root cause shared with #76; submission gating retained. |
| [#79](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/79) | Adi Labs/ [DEF-051] Links inside text on the Journey page are distinguishable only by colour | Pending detailed reproduction | — |
| [#80](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/80) | Adi Labs/ [DEF-052] Small text on the login page is below the minimum colour contrast | Pending detailed reproduction | — |
| [#81](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/81) | Adi Labs/ [DEF-053] Pages send no basic security headers (CSP, frame protection, nosniff, Referrer-Policy) | Scope clarification emailed; unverified | Report points to ADI Interview staging; do not claim current Praxis headers fix another app. |
| [#82](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/82) | Adi Labs/ [DEF-054] No Strict-Transport-Security (HSTS) header on pages or API | Pending detailed reproduction | — |
| [#83](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/83) | Adi Labs/ [DEF-055] Pages reveal the server framework in the X-Powered-By header | Pending detailed reproduction | — |
| [#84](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/84) | Adi Labs/ [DEF-056] 'Continue to Profile' on the Identity Verified page opens a job application instead of the profile | Pending detailed reproduction | — |
| [#85](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/85) | Praxis / Validator / Support Bot does not answer any message or preset question | Pending detailed reproduction | — |
| [#86](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/86) | Praxis / Validator / Failed guideline generation shows the raw provider error, quota name and model | Pending detailed reproduction | — |
| [#87](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/87) | Praxis / SME / "Why we ask" explanation is not visually distinct when expanded | Pending detailed reproduction | — |
| [#88](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/88) | Praxis / SME / "Retry my last answer" after an accepted "I don't know" shows a misleading processing error | Pending detailed reproduction | — |
| [#89](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/89) | Praxis / SME / Evidence file names in Hindi or Chinese are shown as underscores after upload | Pending detailed reproduction | — |
| [#90](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/90) | Praxis / SME / Profile can be submitted with no roles after "I don't know" / "I can't say" in the chat | Pending detailed reproduction | — |
| [#91](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/91) | Adi Labs/ [DEF-057] 'Unsaved changes' stays after the change is undone on a draft application | Pending detailed reproduction | — |
| [#92](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/92) | Adi Labs/ [DEF-058] Clicking empty space at the end of an evidence checkbox row ticks or unticks the checkbox | Pending detailed reproduction | — |
| [#93](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/93) | Adi Labs/ [DEF-059] Busy/loading cursor on 'Save & submit application' while one or both confirmations are unticked | Pending detailed reproduction | — |
| [#94](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/94) | Adi Labs/ [DEF-060] Evidence title accepts HTML/script code and shows it as the title | Pending detailed reproduction | — |
| [#95](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/95) | Adi Labs/ [DEF-061] 'Edit' on an evidence item gives no feedback: the form changes off-screen and the button does not react | Pending detailed reproduction | — |
| [#96](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/96) | Adi Labs/ [DEF-062] Evidence list has no paging or scroll area: every item is stacked one below another | Pending detailed reproduction | — |
| [#97](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/97) | Praxis / Validator / Guideline section preview is cut off mid-word with no ellipsis | Pending detailed reproduction | — |
| [#98](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/98) | Praxis / SME / Evidence upload control looks the same when disabled and enabled, with no button styling | Pending detailed reproduction | — |
| [#99](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/99) | Praxis / Finance / Cancelled pay run's week range changes after creating another draft for the same week | Pending detailed reproduction | — |
| [#100](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/100) | Praxis / Validator / Retry assessment provides no clear progress or completion feedback | Pending detailed reproduction | — |
| [#101](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/101) | Praxis / SME / Duplicate language entries are accepted | Fixed; tested and deployed | Unique-language UI and API validation; checklist unchanged on invalid data; 94dc7963. |
| [#102](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/102) | Praxis / SME / Completed onboarding incorrectly prompts user to start onboarding again | Pending detailed reproduction | — |
| [#103](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/103) | Praxis / SME / Home page incorrectly shows onboarding as pending after completion | Pending detailed reproduction | — |
| [#104](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/104) | Praxis / PM / Completed and selected SME is not available for assignment | Pending detailed reproduction | — |
| [#105](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/105) | Praxis / SME / Expired session is not clearly communicated to the user | Pending detailed reproduction | — |
| [#106](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/106) | Praxis / SME / Step numbering is not updated after deleting preceding steps | Pending detailed reproduction | — |
| [#107](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/107) | Praxis / SME / W06 displays a generic error when the user profile is signed out | Pending detailed reproduction | — |
| [#108](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/108) | Praxis / SME / Clicking “Not specialty work” displays raw required-field validation errors | Pending detailed reproduction | — |
| [#109](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/109) | Praxis / Validator / No confirmation message is displayed after accepting a task review | Pending detailed reproduction | — |
| [#110](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/110) | Praxis / SME / Accepted task is marked read-only without explaining why | Pending detailed reproduction | — |
| [#111](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/111) | Praxis / SME / Required text fields accept special characters and numbers as input without meaningful validation | Pending detailed reproduction | — |
| [#112](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/112) | Praxis / SME / Validation message points to W06 instead of identifying the W03 evidence issue | Pending detailed reproduction | — |
| [#113](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/113) | Praxis / SME / After "More information requested" the SME can resubmit without updating the profile | Pending detailed reproduction | — |
| [#114](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/114) | Praxis / SME / Work preferences accepts a time zone that does not exist | Fixed; tested and deployed | IANA choice validation with known-alias canonicalization; invalid timezone creates no acknowledgement; 94dc7963. |
| [#115](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/115) | Praxis / SME / Work preferences accepts a language level that does not exist | Fixed; tested and deployed | CEFR choice validation; invalid proficiency creates no acknowledgement; 94dc7963. |
| [#116](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/116) | Praxis / PM / Project accepts a demographic filter on an attribute that does not exist | Pending detailed reproduction | — |
| [#117](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/117) | Praxis / PM / Write endpoints accept unknown extra fields although the API document forbids them | Implemented; API regression passed | Strict write objects; unknown fields rejected. |
| [#118](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/118) | Praxis / Finance / A pay run can be built for a week in 1999 while a week in 2035 is refused | Pending detailed reproduction | — |
| [#119](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/119) | Praxis / Finance / A COMPLETED pay run can be submitted again (200 instead of 409) | Pending detailed reproduction | — |
| [#120](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/120) | Praxis / Validator / Decision form pre-selects "Select for this pool": typing a reason and message alone selects the candidate | Pending detailed reproduction | — |
| [#121](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/121) | Praxis / SME / Workbench edit is lost without warning when leaving with the "←" link within ~2.5 s of typing | Pending detailed reproduction | — |
| [#122](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/122) | Praxis / SME / W06 "Possible real data" check never flags a passport number in party identifiers (PAN is flagged) | Pending detailed reproduction | — |
| [#123](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/123) | Praxis / SME / Workbench says "On a phone it is read-only" but its fields can still be edited and saved with keyboard focus | Pending detailed reproduction | — |
| [#124](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/124) | Praxis / PM / Candidate row numbering is not updated after rejecting a candidate | Pending detailed reproduction | — |
| [#125](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/125) | Praxis / PM / Rejection confirmation message uses success styling | Pending detailed reproduction | — |
| [#126](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/126) | Praxis / SME / Required repeatable fields are not marked as mandatory before clicking Add | Pending detailed reproduction | — |
| [#127](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/127) | Praxis / SME / Numerical inputs do not allow the default zero to be fully erased | Pending detailed reproduction | — |
| [#128](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/128) | Praxis / SME / Submission status message remains unchanged after validator review | Pending detailed reproduction | — |
| [#129](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/129) | Praxis / SME / Task counts remain inconsistent after a not-accepted task is replaced | Pending detailed reproduction | — |
| [#130](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/130) | Adi Labs/ [AL-DEF-064] Application id containing an encoded null character (%00) causes a server error (500) | Scope clarification emailed; unverified | Report points to ADI Interview staging; absent current Praxis route. |
| [#131](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/131) | Praxis / Finance / Payout reconciliation runs for a future date instead of refusing it | Pending detailed reproduction | — |
| [#132](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/132) | Praxis / Finance / Partner statements can be built for a future month | Pending detailed reproduction | — |
| [#133](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/133) | Praxis / PM / New-project wizard shows raw server validation text for invalid numbers | Pending detailed reproduction | — |
| [#134](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/134) | Praxis / Finance / POST /payout-reconciliation is accepted without an Idempotency-Key | Pending detailed reproduction | — |
| [#135](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/135) | Praxis / SME / POST /me/payee/refresh is accepted without an Idempotency-Key | Pending detailed reproduction | — |
| [#136](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/136) | Praxis / PM / Staffing offers "Assign" for SMEs not selected for the pool; the error shows a raw id and is easy to miss | Pending detailed reproduction | — |
| [#137](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/137) | Praxis / SME / Duplicate and apparently invalid tasks appear in closest existing tasks results | Pending detailed reproduction | — |
| [#138](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/138) | Praxis / Finance / No earnings generated for accepted SME tasks; payment run completes with zero payments | Pending detailed reproduction | — |
| [#139](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/139) | Praxis / All roles / Website responds with a delay after a period of inactivity | Pending detailed reproduction | — |
| [#140](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/140) | Praxis / SME / Numerical input accepts alphabetic characters during editing | Pending detailed reproduction | — |
| [#141](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/141) | Praxis / PM / A candidate question the PM removes comes back when the opportunity is published, with no explanation | Pending detailed reproduction | — |
| [#142](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/142) | Praxis / PM / The dark theme reverts to light after a reload on the Resource assignment page | Pending detailed reproduction | — |
| [#143](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/143) | Praxis / Finance / Finance can open the Projects page, which shows "No projects yet." instead of a "No access" page | Pending detailed reproduction | — |
| [#144](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/144) | Praxis / PM / PM can open the Partners and Guidelines pages although they are not in the PM menu | Pending detailed reproduction | — |
| [#145](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/145) | Praxis / PM and Finance / Opening /users shows a bare 404 instead of the "No access" page | Pending detailed reproduction | — |
| [#146](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/146) | Praxis / All roles / Muted text in the dark theme has a contrast of 4.48:1, just under the 4.5:1 WCAG AA minimum | Pending detailed reproduction | — |
| [#147](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/147) | Praxis / Finance / A pay-run week cannot be rebuilt after it has been cancelled twice ("A record with these values already exists") | Pending detailed reproduction | — |
| [#148](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/148) | Praxis / PM / Job description import shows no progress and its result message appears at the very bottom of the page | Pending detailed reproduction | — |
| [#149](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/149) | Praxis / PM / An empty Resource assignment board does not say why a selected, onboarded expert is missing | Pending detailed reproduction | — |
| [#150](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/150) | Praxis / PM / Identical job descriptions can be created twice and both show in the "Use an existing job description" list | Pending detailed reproduction | — |
| [#151](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/151) | Praxis / All roles / Login rate limiting is reported to start only after the 20th failed attempt, not after 10 as specified | Not reproduced; regression passed | Eleventh login attempt returns 429. |
| [#152](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/152) | Praxis / SME / Opening a partner invite link gives no clear message that the invitation was accepted | Pending detailed reproduction | — |
| [#153](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/153) | Praxis / Partner / The Partner portal Support Bot answers every message and preset question with "not available right now" | Pending detailed reproduction | — |
| [#154](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/154) | Praxis / Partner / Resubmitting a withdrawn candidate says "already submitted" and does not mention the 90-day cool-off | Pending detailed reproduction | — |
| [#155](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/155) | Praxis / API / The API reference does not declare which authentication each endpoint needs (e.g. GET /partner-statements) | Documentation tested; token behavior unverified | Operation audiences and error responses documented; no token-auth change. |
| [#156](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/156) | Praxis / Admin / The Users list is cut off and the hidden part can only be reached with a two-finger horizontal scroll | Pending detailed reproduction | — |
| [#157](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/157) | Praxis / Admin / Clicking Admin while the Tutorial page is still loading changes the URL to /users but keeps showing the Tutorial content | Pending detailed reproduction | — |
| [#158](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/158) | Praxis / Admin / The dataset "after" parameter answers 500 "Something went wrong" for a very large number | Implemented; API regression passed | Bounded signed-bigint cursors. |
| [#159](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/159) | Praxis / Admin / The dataset "after" parameter accepts -1 and an empty value and returns the data instead of a 400 | Implemented; API regression passed | Empty and negative cursors rejected. |
| [#160](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/160) | Praxis / API / A 10 MB JSON body is answered with HTTP 500 and the plain text "Internal Server Error", with no request id | Fixed; live endpoint verified | Bounded proxy from first batch; live PM POST /projects 2/10 MiB both 413 with requestId. |
| [#161](https://github.com/vasudevansundarababu-dev/adi-praxis-testing/issues/161) | Praxis / API / An unknown API route returns the default framework error with no request id | Implemented; API regression passed | Custom NOT_FOUND envelope with request ID. |
