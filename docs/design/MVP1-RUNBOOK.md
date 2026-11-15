# MVP1 (ADI Forge): how to use

How a PM or Admin runs a project end to end in the MVP1 flow. The design is
`docs/design/PROJECT-SCREEN-DESIGN.md` (approved 15 Nov 2026); the decisions are in `docs/DECISIONS.md`,
"MVP1 step 1" to "MVP1 step 9". Internal names (Praxis, Anvil) appear here only because this is an internal doc;
users see ADI Forge and RL Gym.

## 1. Switch the new flow on (per client)

- **Admin → Candidate app sign-in** (`/admin/candidate-sign-in`). Admins change it; PMs see it read-only.
- **New flow: On** switches on, for this client only: direct assignment to tasks, the four-tab project page, the
  candidate task list (Home), Sourcing as the way people come in, and the shorter menu. **Off** keeps the earlier
  journey (opportunity, apply, selection, proposals) exactly as before. SMEs already in the earlier journey keep it
  while the flow is on.
- Stored in `Client.settings.forge` (`newFlow`, `candidateSignIn`); every change is audited
  (`forge.settings_updated`). API: `GET`/`PUT /admin/forge-settings`.

## 2. Choose the sign-in mode: Offline or Online

- **Offline** (QA and demos only): people sign in with their email and name, no password. Anyone who knows an
  uploaded email can sign in as that person, so the server refuses Offline when `APP_ENV=production`.
- **Online**: email (the Gmail address uploaded in Sourcing) and a password. Assigning a new person emails them a
  one-time set-your-password link (72 hours); Forgot password sends a reset link (1 hour). Passwords never travel in
  email. A PM or Admin can resend the link from the project's people.
- **Changing the mode signs everyone out of the candidate app** (all SMEs and Reviewers of the client), audited
  `candidate.sessions_ended` with the count only. Switching the new flow on or off alone signs nobody out.

## 3. Publish the Terms first

- **Admin → Terms** (`/terms`): a current version of every contributor terms document (contributor, confidentiality
  and IP, data use) must be published **before any SME or Reviewer signs in**. Their first sign-in shows Before you
  start: they accept the current versions and confirm synthetic data only (recorded and audited). A newer version
  must be accepted again. Placeholder terms are refused where onboarding refuses them (production builds other than
  demo).

## 4. The order a PM or Admin follows

1. **Project.** Projects → New: choose the template (for example KYC), the review route (Author → PM/Admin, or
   Author → Reviewer → PM/Admin; read-only once tasks exist), dates and Required workers. Submit. The project's tasks
   are made then, **one row per slot** (a case-selector template such as KYC v6 makes one task per state; v7 one per
   application type). The project opens on Dashboard, Resource assignments, Tasks and Policies.
2. **Policies.** Upload the policy documents, extract or write the rules, review them and publish the rule set. Tasks
   cite the published rules by key and version.
3. **Sourcing.** Resource assignments → Export to Recruiter gives the recruiter pack (PDF with the Excel sheet inside,
   or Excel only). Recruiters return the sheet; **Sourcing → New** uploads one person (SME or Reviewer, for one
   project) or the whole sheet. The email is the person's sign-in.
4. **Assign.** Resource assignments → Assign: each sourced person whose skills match, with a task to choose.
   Assign as SME (until the SME places, Required workers, are full) or, on the Reviewer route, Assign as Reviewer
   (never the task's own author; one role per person per project). On the Tasks tab, an Open task offers
   "Assign SME…" from the project's SMEs; the task page offers "Assign reviewer…" and **Change author** (only before
   the author starts; shown disabled with the reason for In progress and Rework tasks).
5. **Authoring.** The SME signs in to the candidate app, accepts the terms, and Home lists their tasks (New, In
   progress, In review, Rework, Accepted, Rejected). Tutorial and Help (scoped to the task) are on the task page.
6. **Review.** On the Reviewer route the Reviewer sees **Tasks to review** on Home, comments per section and passes
   the task or sends it back. The PM or Admin decides on the Tasks tab's task page: Approve (checklist on Author →
   PM/Admin), Rework or Reject (both need a comment for the author). Only a person decides; only the PM or Admin
   approval adds the task to the approved dataset.
7. **Export.** Tasks tab → Export: **Export to RL Gym** opens only when **every** task of the project is approved
   ("Export opens when all 5 tasks are approved (4 of 5 now)"). Validate checks one approved task at any time; tasks
   that need fixing link to their task page.

## 5. QA smoke test for the new flow

The QA smoke job (`docs/ops/QA-ENV-SETUP.md`, section 7) also walks this flow when the client's new flow is on:

```
gcloud run jobs execute praxis-qa-smoke --region <region> --wait
```

Locally, against a running API (never production), with the API's `.env` loaded (the job reads its config):

```
API_URL=http://localhost:4000 DEMO_ADMIN_PASSWORD=... DEMO_PM_PASSWORD=... QA_SEED_REVIEWER_PASSWORD=... \
  QA_SMOKE_NEW_FLOW=on pnpm --filter @praxis/api exec tsx src/jobs/run.ts qa-smoke
```

- `QA_SMOKE_NEW_FLOW=auto` (default) runs the new-flow pass only when the flow is on; `on` fails when it is off;
  `off` skips it. `QA_SMOKE_FORGE_ROUTE=SME_PM` uses Author → PM/Admin (default Author → Reviewer → PM/Admin).
- It needs Offline sign-in and published Terms, and never changes the client's settings. It creates its own
  `SYNTHETIC QA smoke (new flow) — <time>` project and synthetic people (`smoke-forge-*@praxis.test`, first name
  SYNTHETIC), reads export eligibility but never exports, signs its candidates out and cancels the project unless it
  completed. The result is the `forge` part of the `report: "qa-smoke"` JSON line.
- Tests (mocks only): `apps/api/test/qa-smoke-forge.test.ts`.
