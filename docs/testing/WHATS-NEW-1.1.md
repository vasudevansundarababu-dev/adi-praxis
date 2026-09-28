# What's new: Release 1.1 test build (tester briefing)

| | |
| --- | --- |
| Build | `test-1.1-20260928` in the yellow banner (later nightly builds show `nightly-YYYYMMDD-…`) |
| Deployed | Monday 28 Sep 2026 (after the 1 PM CDT / 11:30 PM IST merge of the SME supply work) |
| Testing starts | Tuesday 29 Sep 2026, 09:30 IST |
| Environment | The same test environment and URLs as release 1.0 ([README](README.md) section 3). 1.1 **replaces** 1.0 there; your 1.0 data is kept |

Read this once, then keep [README.md](README.md) and [TEST-CASES.md](TEST-CASES.md) open while you test.

## 1. What changed

1. **Partners supply candidates.** Staffing partners sign in to a new **partner portal**, read open roles
   ("requisitions"), put candidates forward, follow their progress and read monthly fee statements. Systems can do the
   same through the **Partner API v1**. Partners never decide anything for a candidate.
2. **Requisitions and a careers page.** A PM opens a requisition on a project (tier, headcount, requirements, allowed
   partners, who pays). People can also apply directly on the requisition's public careers page.
3. **Guidelines → course → certification.** An Admin uploads guidelines; Claude writes a knowledge map, a course and a
   test per tier (Expert, Reviewer, Annotator); an Admin approves everything and publishes. Candidates take the course
   module by module, pass a selfie check, then a timed test. People confirm any written-answer grades; nobody is
   refused by a model.
4. **Payments.** Each accepted task earns a fixed amount from a rate card. A weekly pay run is built, confirmed by a
   PM, approved and submitted by the new **Finance** role. Partners earn a fee per certified candidate.
5. **Usability for everyone.** Red **\*** on required fields in all three apps; a **two-level console menu**; a
   **Support Bot** (Help button) in the console and partner portal; the internal Reviewer role is now called
   **Validator**. "Reviewer" on a screen now means the SME tier.

1.0 behaviour is unchanged for projects without a requisition. Check that (TC-E2E-011).

## 2. Where to find things

| Role | New menu (top row → second row) | New in this build |
| --- | --- | --- |
| Admin | Home · Projects · Reviews · Certification · Partners · Payments · Admin | **Partners** (add partner, portal users, fee terms, suspend) · **Certification → Guidelines** (upload, generation run, knowledge map, course, blueprint, question families, publish) · everything below |
| PM | Home · Projects (Projects, Templates, **Requisitions**) · **Payments** (Pay runs, Rate cards) | **Projects → Requisitions → New requisition** · requisition page: state, guidelines, rate card · **Payments → Pay runs → Confirm pay run** |
| Validator | Home · Projects (Requisitions) · Reviews (Applications, Task reviews, RL reviews, Identity reviews, Conflicts) · **Certification** (Guidelines, **Certification reviews**) | Requisition → **Submissions** (confirm "not met") · **Certification reviews** (written grades, decisions, licences) |
| Finance | Home · **Payments** (Pay runs, Rate cards, Earnings and holds, Payout exceptions, Partner statements) | Everything under Payments |
| Partner | Partner portal, one row: Home · Requisitions · Candidates · Statements · API & webhooks | All of it (at `<console URL>/partner/login`) |
| SME | Candidate app header: Opportunities · **Certifications** · **Payments** | **Careers page** (`<candidate URL>/careers/requisitions/<id>`) · Certifications (course, selfie check, test, result) · Payments (set-up, earnings) · two automatic items on the onboarding checklist |

The **Help** button is at the bottom right of every signed-in console and partner-portal page. It is not in the
candidate app (by decision D-UI-04).

## 3. Accounts

Passwords come from the lead tester (Secret Manager, shared through the team password manager). Never write them in
GitHub, chat or email.

- **New:** `finance@praxis.demo` (Finance) and `partner@praxis.demo` (partner portal user of "Demo Staffing Partner",
  sign in at `<console URL>/partner/login`).
- **As before:** `admin@praxis.demo`, `pm@praxis.demo` (owns the "KYC authoring demo" project), `reviewer@praxis.demo`
  (shown as Validator), and your own named accounts.
- **Candidates:** the mock sign-in, with `sme.<your initials>.<case number>@example.test`.
- **Demo data:** rate card "KYC authoring (USD)" (Authoring USD 40, Annotation USD 8); open requisition "KYC authors —
  India (Annotator)" on "KYC authoring demo", direct pay, careers page on; Demo Staffing Partner's fee is USD 150 per
  certified candidate. **No guidelines are uploaded:** you upload `samples/kyc-procedure-notes.pdf` (or `.txt`).

## 4. A 60-minute guided walkthrough of the supply journey

Do this once, alone or in a pair, before your assigned cases. Use one browser profile per role (README section 5).
It is a tour, not a full test: you will not finish a certification in an hour.

| Minutes | Role | Do this | You should see |
| --- | --- | --- | --- |
| 0–5 | Each role | Sign in; read the banner and the menu | Build `test-1.1-…`; only your role's groups; the Help button |
| 5–15 | Admin | Certification → Guidelines → **New guidelines package** (banking, "<initials> KYC onboarding") → upload `kyc-procedure-notes.pdf` as a **Major** version | "Version 1 uploaded (N sections). Generation has started." A run you can follow by refreshing |
| 15–25 | Partner | Requisitions → "KYC authors — India (Annotator)": read it → **Submit a candidate** (`sme.<initials>.tour@example.test`) → **copy the link** in the box "Test environment: invite link" → Candidates → open it | Requirement screen result; the invite link box (test only, email is simulated); "You own this candidate until …"; "Invite: Not accepted yet" |
| 25–30 | Partner | Submit the same email again | Refused as already put forward, without naming anyone |
| 30–40 | SME | In the SME browser profile paste the invite link → sign in with the mock using the **same email** the partner submitted (`sme.<initials>.tour@example.test`) → verify (simulated) → answer two profile questions. Partner: reload the candidate | Asterisks and "Fields marked * are required."; the invitation opens the 1.0 profile chat for the requisition; the partner sees "Invite: Accepted" |
| 40–48 | Admin | Back on the guidelines version (generation should be done): read the knowledge map; open the Annotator course, the blueprint and one question family with its four checks | Every item cites a section (S1 …); "Derived key" and four passed checks on samples; Publish blocked with a "Still to approve" list |
| 48–55 | Finance, then PM | Finance: Payments → Rate cards (read) → Pay runs → **Build pay run** for an old week, Monday **14 Sep 2026** (not the current week, see below). PM: open it → **Confirm pay run**. Finance: **Approve pay run**, then cancel it with the reason "Walkthrough only" | "Waiting for a PM to confirm." → "Waiting for Finance to approve." → "Single approver" flag → cancelled. Never submit a walkthrough run |
| 55–60 | Any console role and Partner | Press **Help** on a form: "What do I need to fill in on this screen?", then "Approve this for me" | Correct list of required fields; the bot refuses to act and says who does |

Then continue with your day 1 cases. The whole journey (a candidate certified, a task earning, a paid run and a
partner statement) is **TC-E2E-008**; it takes a team of five about half a day.

**Pay runs are shared:** there is one pay run per week for the whole test environment. Only the Finance tester named
by the lead builds, approves and submits the current week (Monday 28 Sep 2026) for TC-E2E-008 and TC-FIN-005.
Everyone else uses earlier Mondays (7, 14 or 21 Sep) and cancels approved runs afterwards; a submitted run cannot be
cancelled.

**Reaching a partner's candidate in test:** email is simulated, so after "Submit candidate" the partner sees a
yellow-bordered box **"Test environment: invite link"** with the full link (`<candidate URL>/partner-invite/<token>`;
the Partner API returns it as `inviteLinkForTesting`). Copy it, open it in the candidate's browser profile, and sign in
with the mock using the **same email the partner submitted**. The link belongs to that one person (TC-PTR-015).
Production never shows the link (D-M10-42).

**Careers page (separate test):** anyone can also apply directly at `<candidate URL>/careers/requisitions/<id>`
(TC-SME-060, TC-SME-061). If a partner already owns the person, the direct application is credited to that partner.

## 5. What "good" looks like

- **Nobody is decided by a machine.** The requirement screen, test scoring and model grades only recommend; a
  Validator, Admin or Finance user decides, and the screen says so.
- **Partners see only their own** candidates, statements and keys; never another partner, never test questions or
  answers, never internal ids.
- **Candidates never see answers or keys**, and two candidates never get the same question instance.
- **Money is exact and happens once:** one earning per accepted task at the rate-card price; double clicks and retries
  never pay twice; nothing is edited, only reversed; held amounts carry forward.
- **No bank, tax, ID number or photo** is stored or shown anywhere.
- **Every form** marks exactly the required fields; **every page** tells you what to do next; **the Help bot** is
  accurate about the screen and never acts.
- **1.0 still works** as before.

## 6. Known issues in this build (do not report as defects)

- Payouts use a **simulated payout provider**; the real Trolley connection is not live.
- The **selfie check** is simulated.
- **Claude quota risk:** generation runs may end FAILED and the Support Bot may say "not available right now". Report
  it **once** as a Defect titled `[Environment] Claude unavailable …` with the time (IST) and build; then continue.
- Some screens show **short ids instead of names** (pay-run lines, statements, certification reviews); no SME search.
- **No CV upload** for partner submissions; **partners cannot manage their own portal users** (an Admin does).
- Invite emails are not sent (email is simulated); the partner copies the test-only invite link instead (above).
- Earnings do not show task titles; graders do not yet see integrity events.

Raise an Enhancement if one of these matters to users.

## 7. How to report

Use GitHub **Issues → New issue** with the forms described in [README](README.md) section 10 and
[TRIAGE.md](TRIAGE.md): **Defect**, **UX issue** or **Enhancement request**. Security problems go to a **private
advisory**, never an issue.

- **Build:** copy it exactly from the yellow banner (e.g. `test-1.1-20260928`, or the nightly label after the first
  night). Reports without a build cannot be verified.
- **Test case id:** e.g. TC-PTR-005, or "exploratory". Quote the decision id if the report concerns one (e.g.
  D-M10-07, D-UI-03).
- **Persona:** start the title with `[Partner]` or `[Finance]`, and choose Partner / Finance in the persona list when
  available (until the forms are updated, choose "Several / not role-specific").
- **Environment problems** (Claude unavailable, "SME supply is not switched on", demo data missing): one issue titled
  `[Environment] …`, not one per screen.
- One problem per issue; numbered steps; expected vs actual; a screenshot; the time in IST; browser and device. Never
  paste passwords, client secrets, webhook secrets or session cookies.

## 8. Day 1

Follow the "Day 1" table in [README.md](README.md) ("What's new in this build"). In short: everyone checks menus and
banners (09:30); the Admin and PM testers run **TC-E2E-009** first because every certification case depends on it;
Partner, SME and Finance testers start their P1 cases; after lunch a team starts **TC-E2E-008** and a pair runs the
**TC-E2E-011** regression.
