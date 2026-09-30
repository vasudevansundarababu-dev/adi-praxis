# Tester email: Release 1.1 test build

To: the India test team (GitHub: DhruvnStore, Shriya-ss10, hvenkat396-oss). Send from the product owner.
Passwords are **not** in this email; send them separately through the team password manager.

---

**Subject:** ADI Praxis – Release 1.1 test build: GitHub access and how to start testing (Thu 1 Oct, 09:30 IST)

Hi team,

Thank you for helping us test ADI Praxis before it goes to production. ADI Praxis lets subject-matter experts (for
example KYC analysts) write realistic, fully synthetic training tasks for AI agents, with human validators deciding what
is accepted. The Release 1.1 test build adds staffing partners, certification courses and tests, and payments. Your
job is to find defects, confusing screens and security gaps, and to tell us whether our product decisions are right for
real users.

Testing starts **Thursday 1 October, 09:30 IST**.

**STEP 1 – JOIN THE TESTERS' GITHUB REPOSITORY (10 minutes, do this first)**

All test material and all defect reports live in one private GitHub repository:
https://github.com/vasudevansundarababu-dev/adi-praxis-testing

1. If you do not have a GitHub account, create a free one at https://github.com/signup. Use your work email. Choose a
   username you are happy for the team to see.
2. Turn on two-factor authentication: profile picture → Settings → Password and authentication → Enable two-factor
   authentication (an authenticator app is easiest).
3. Reply to this email with your GitHub username if it is not one of: DhruvnStore, Shriya-ss10, hvenkat396-oss.
4. Accept the invitation. You will get an email from GitHub titled "invited you to
   vasudevansundarababu-dev/adi-praxis-testing". Click **View invitation → Accept invitation**, or open
   https://github.com/vasudevansundarababu-dev/adi-praxis-testing/invitations while signed in. The invitation expires
   after 7 days; ask me to resend it if it does.
5. Check you can see the repository and the **Issues** tab. Optional: click **Watch → Participating and @mentions** so
   you get an email when someone comments on your reports.

**STEP 2 – READ (about 1 hour)**

In the repository, open these in order:
1. `docs/testing/README.md` – the tester guide: environment, accounts, several roles at once, devices, daily schedule,
   how to report.
2. `docs/testing/WHATS-NEW-1.1.md` – what is new in this build, with a 60-minute guided walkthrough.
3. `docs/testing/TEST-CASES.md` – 232 test cases by persona (also `test-cases.csv` to track your runs in a spreadsheet).
4. `docs/testing/DECISION-REGISTER.md` – skim it. If the app does what a decision says, it is not a defect; if you
   think the decision is wrong for users, raise an Enhancement.
5. `docs/testing/PENTEST.md` – mandatory before any security or penetration test.

Sample files for uploads are in `docs/testing/samples` (open a file → "Download raw file").

**STEP 3 – SIGN IN TO THE TEST ENVIRONMENT**

- Console (Admin, PM, Validator, Finance): https://praxis-web-742785092638.us-central1.run.app
- Partner portal: https://praxis-web-742785092638.us-central1.run.app/partner/login
- Candidate app (experts): https://praxis-candidate-742785092638.us-central1.run.app
- API and interactive docs: https://praxis-api-742785092638.us-central1.run.app/docs

Every page shows a yellow "Test environment" banner with the build (`test-1.1-20260930`, later `nightly-…`). Put
the build in every report.

- Console and partner accounts: I will send your passwords separately through the password manager, never by email.
- Expert (candidate) accounts: the Google sign-in is simulated; type any email in this pattern:
  `sme.<your initials>.<case number>@example.test`, e.g. `sme.pk.012@example.test`.
- Use a separate Chrome profile per role (guide section 5): one browser keeps only one console sign-in.
- The AI features (profile chat, task drafting, courses and tests, Support Bot) use the real Claude model, so answers
  vary. Sign-in, the identity and selfie checks, payouts and email are simulated.
- Synthetic data only. Never enter real customer details, real names of colleagues, phone numbers, Aadhaar, PAN, bank
  details or passwords you use elsewhere. Prefix what you create with your initials.

**STEP 4 – START TESTING (Day 1, Thursday 1 Oct)**

Follow the "Day 1" table in the tester guide. In short:
- 09:30 – everyone signs in with each role and checks the banner and menus.
- 10:15 – Admin + PM tester run **TC-E2E-009** first (every certification case depends on it); Partner, SME and
  Finance testers start their P1 cases.
- 14:00 – a team of five runs **TC-E2E-008** (the full supply journey); one pair runs **TC-E2E-011** (1.0 regression).

**STEP 5 – REPORT A PROBLEM**

1. In the repository, click **Issues**, search whether it is already reported (if so, add a comment instead).
2. Click **New issue** and pick a form: **Defect**, **UX issue** or **Enhancement request**.
3. Fill in every required field: test case ID (or "exploratory"), build from the banner, numbered steps, expected vs
   actual, severity, persona, the time in IST, browser and device. Start the title with `[Partner]` or `[Finance]` for
   those personas.
4. Attach a screenshot or short recording by dragging it into the text box. Copy error messages and any "request id"
   exactly. Never paste passwords, secrets or session cookies.
5. One problem per issue. Environment problems (AI unavailable, "SME supply is not switched on") go in one issue titled
   `[Environment] …`.

Security vulnerabilities must never go in an issue. Report them privately:
https://github.com/vasudevansundarababu-dev/adi-praxis-testing/security/advisories/new
If that link does not work for you, email me directly with the subject "SECURITY".

**STEP 6 – VERIFY FIXES**

The lead triages new issues daily at 18:00 IST. Fixed issues get the label `status:ready-to-verify` and a comment with
the build that contains the fix. Retest on that build and comment **`/verified`** (the issue closes) or **`/failed`**
and what you saw (it goes back to triage).

**DAILY RHYTHM (IST)**
- 09:30 – check the banner for a new build; verify "ready to verify" issues first.
- 18:00 – 15-minute triage call with the lead.
- 01:45–02:30 – please do not test; the nightly build is deployed.

If anything blocks you completely, tell me straight away.

These documents and the environment are confidential to the ADI Praxis test team.

Thank you, and happy testing.

Vasudevan Sundarababu
Product owner, ADI Praxis
ADI-Labs
