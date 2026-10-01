# ADI Praxis tester guide (start here)

Welcome. This guide has everything you need to test ADI Praxis end to end: the environment, your accounts, the test
cases, the sample files, and how to report problems so they get fixed overnight. Read it once fully before your first
session; keep it open while you test.

**What is in this folder**

| File | What it is |
| --- | --- |
| `README.md` | This guide |
| [WHATS-NEW-1.1.md](WHATS-NEW-1.1.md) | Briefing for the Release 1.1 test build: what changed, menu paths, a 60-minute guided walkthrough |
| [TEST-CASES.md](TEST-CASES.md) | All test cases, by persona, with steps and expected results |
| [test-cases.csv](test-cases.csv) | The same cases as a spreadsheet to record your runs (open in Excel or import into Google Sheets) |
| [DECISION-REGISTER.md](DECISION-REGISTER.md) | Every product decision, written as "what you should see". Test these too |
| [API-QUICK-REFERENCE.md](API-QUICK-REFERENCE.md) | Every API endpoint and who may call it |
| [PENTEST.md](PENTEST.md) | Rules for security and penetration testing (read before any security test) |
| [TRIAGE.md](TRIAGE.md) | How reports are triaged, fixed by the nightly agent and verified |
| `samples/` | Files to upload in the tests |

## What's new in this build (Release 1.1 test build)

The **Release 1.1 test build** was deployed on **30 Sep 2026** (banner: `test-1.1-20260930`; nightly builds after that
show `nightly-…`). It **replaces release 1.0** in the same test environment: same URLs (section 3), same accounts, and
all your 1.0 data is still there. Testing starts **Thursday 1 Oct, 09:30 IST**. Read [WHATS-NEW-1.1.md](WHATS-NEW-1.1.md)
once before you start; it has menu paths and a 60-minute guided walkthrough.

**New features, in plain words**

| Feature | What it means for you |
| --- | --- |
| **Staffing partners** | Staffing companies ("partners") put candidates forward for open roles, in their own **partner portal** or through the **Partner API**. They follow each candidate's progress and see monthly fee statements. They never decide anything for the candidate |
| **Requisitions** | A PM opens a *requisition* on a project: a role for a tier (Expert, Reviewer, Annotator) with headcount, requirements, allowed partners, a careers page, who pays the SMEs, guidelines and a rate card |
| **Careers page** | Anyone can apply directly for a requisition at a public link. After applying, the normal 1.0 journey follows (identity, profile chat, a Validator selects) |
| **Guidelines → course and certification** | An Admin uploads guidelines; Claude writes a course and a certification test per tier; an Admin checks and approves everything before candidates see it. Candidates take the course module by module, pass a selfie check, then a timed test. Every candidate gets different but equivalent questions. People confirm any written-answer grades |
| **Payments** | Each accepted task earns the SME a fixed amount from a rate card. Every week a pay run is built, a PM confirms it, Finance approves and submits it to the payout provider. Partners earn a fee for each certified candidate |
| **Required fields marked** | Every form in all three apps shows a red **\*** on required fields and the line "Fields marked * are required." |
| **Two-level menu** | The console menu is grouped: the top row has groups (Home, Projects, Reviews, Certification, Partners, Payments, Admin); the second row shows the pages of the current group. You only see the groups your role may use |
| **Support Bot** | A **Help** button (bottom right) on every console and partner-portal page. Ask what a screen needs or how the process works. It explains; it never changes anything. Not in the candidate app |
| **"Validator"** | The internal Reviewer role is now called **Validator** on every screen. "Reviewer" on a screen now means the SME *tier* |

**New personas and accounts** (passwords come from the lead tester, from Secret Manager; never put them in GitHub,
chat or email)

| Account | Role | Where |
| --- | --- | --- |
| `finance@praxis.demo` (new) | **Finance**: rate cards, earnings and holds, pay runs, payout exceptions, partner statements | Console |
| `partner@praxis.demo` (new) | **Partner** user of "Demo Staffing Partner" | Partner portal: `<console URL>/partner/login` |
| `admin@praxis.demo`, `pm@praxis.demo`, `reviewer@praxis.demo` | Admin, PM, Validator (as before) | Console |

Your own named accounts keep working; ask the lead for a Finance role on yours if you test payments. New demo data:
the rate card **"KYC authoring (USD)"** (Authoring USD 40, Annotation USD 8), and the open requisition **"KYC authors —
India (Annotator)"** on the **"KYC authoring demo"** project, with direct pay and the careers page on. Demo Staffing
Partner has fee terms USD 150 per certified candidate. **No guidelines are uploaded**: you upload
`samples/kyc-procedure-notes.pdf` (or `.txt`) yourselves (TC-E2E-009).

**What is simulated in this build** (in addition to Google sign-in and the identity check)

| Simulated | What you do instead |
| --- | --- |
| Email | Invites to partner-submitted candidates are **not emailed**. Instead, after "Submit candidate" the partner sees a yellow-bordered box **"Test environment: invite link"** with the full link (the Partner API returns it as `inviteLinkForTesting`). Copy it, open it in the candidate's browser profile, sign in with the mock using the **same email the partner submitted**, and the invitation opens the application (TC-PTR-015, TC-E2E-008). Production never shows this link |
| Selfie check before each test attempt | A simulated page where you choose the outcome, like the identity check |
| Payout provider (Trolley) | "Payment set-up" opens a **Simulated payout provider** page with a **Finish** button. Submitted payouts are marked paid (or failed) by the simulation; no money moves |

**Real AI:** Claude on Vertex writes the courses, tests and Support Bot answers. **Known risk:** the Claude quota in the
test project may still be too low. Then guideline generation runs end **FAILED** and the Support Bot says "The Support
Bot is not available right now". Report this **once** as a Defect titled `[Environment] Claude unavailable …` (with the
time and build), not once per screen, and continue with other cases.

**Known limitations of this build** (do not report as defects; raise an Enhancement if one matters to users)

- The payout provider is simulated; the real Trolley connection is not live and cannot be tested.
- The selfie check is simulated.
- Claude quota may run out (above).
- Some screens show a short SME or partner **id instead of a name** (pay-run lines, statements, the certification
  review queue), and there is no SME search; holds are placed by SME id.
- Partners cannot upload a **CV** with a submission.
- Partners **cannot manage their own portal users**; an Admin adds them (Partners → a partner → Portal users).
- No screens for console **user management** (add, change roles, disable), the **audit log**, the **Approved Task
  Dataset** or **SME standing**: these are API only (TC-ADM-001 to 003, TC-ADM-034, TC-ADM-035). Partner **portal users
  cannot be disabled**; suspend the partner instead (TC-ADM-030).
- Earnings lines do not show the task title; integrity events (paste, leaving the page) are not shown to graders yet.
- Experts can approve but not reject a question family in the candidate app.
- Some success messages disappear when the page refreshes into the next state.
- Some minimum lengths and formats are still checked only when you submit, not on the field.
- For Partner and Finance reports, choose Partner / Finance in the persona list of the issue form and start the title
  with `[Partner]` or `[Finance]`.

**Day 1 (Thursday 1 Oct): run in this order**

| When (IST) | Who | Cases |
| --- | --- | --- |
| 09:30–10:15 | Everyone | Sign in with each of your roles; check the banner and the menu: TC-ADM-021, TC-PM-013, TC-REV-030, TC-FIN-001, TC-PTR-001 |
| 10:15–11:30 | Admin + PM tester | **TC-E2E-009** (upload guidelines → publish the Annotator tier → link it to the demo requisition). Certification tests depend on it: tell the team when it is done |
| 10:15–11:30 | PM tester | TC-PM-014, TC-PM-016: your own requisition with the careers page, guidelines and rate card |
| 10:15–13:00 | Partner and SME testers | TC-PTR-002, TC-PTR-003, **TC-PTR-015** (invite link), TC-PTR-005, TC-SME-060, TC-SME-061, TC-SME-062 |
| 10:15–13:00 | Finance tester | TC-FIN-002, TC-FIN-003 on an earlier Monday (the week of 28 Sep is kept for TC-E2E-008; there is one pay run per week for everyone) |
| 14:00–17:30 | A team of five | **TC-E2E-008** (the full supply journey) up to certification; SME testers run TC-SME-063 to TC-SME-067 on their own candidates |
| 14:00–17:30 | One pair | **TC-E2E-011** (1.0 regression on the new build) |
| 14:00–17:30 | Security testers | TC-SEC-019, TC-SEC-020, TC-SEC-023, TC-SEC-024 |

## 1. What ADI Praxis is

ADI Praxis lets subject-matter experts (SMEs) — for example KYC analysts from banks — write realistic, fully
synthetic training tasks for AI agents. From Release 1.1, staffing partners also supply candidates, every candidate is
trained and certified on the project's guidelines, and SMEs are paid for accepted work. These people use it:

| Persona | App | What they do |
| --- | --- | --- |
| **SME / candidate** | Candidate app | Signs in, verifies identity, builds a profile through a short chat, gets selected, onboards, then writes tasks in the workbench (by hand, or drafted by AI from a document or an interview); from 1.1 may apply on a careers page, takes a course and certification test, sets up payments and sees earnings |
| **Project manager (PM)** | Console | Creates projects from workflow templates, publishes the opportunity, staffs the project with selected experts, watches progress; from 1.1 also opens requisitions, links guidelines and rate cards, and confirms pay runs |
| **Validator** (the internal Reviewer role; shown as "Validator" from 1.1) | Console | Decides which applicants are selected, reviews submitted tasks (accept, rework, reject), judges RL Gym results; from 1.1 also confirms "requirements not met", confirms written test grades and decides certifications after three fails |
| **Admin** | Console | Manages users, templates, terms, taxonomy, API keys; reads the Approved Task Dataset; from 1.1 also partners, fee terms, guidelines and the approval of generated courses and tests |
| **Finance** (new in 1.1) | Console | Rate cards, earnings and pay holds, approves and submits weekly pay runs, payout exceptions, partner statements |
| **Partner** (new in 1.1) | Partner portal | A staffing partner's user: reads requisitions, puts candidates forward, follows their progress, reads fee statements, manages its API keys and webhooks |
| **RL Gym** (a system) | API | Reads accepted tasks and sends AI-agent results back for human review |

The journey for an SME: **Sign in → Verify identity → Apply (profile chat) → Validator selects → Onboarding →
PM assigns → Accept → Write tasks → Validator accepts → Task enters the dataset.**

With a requisition (1.1): **Partner submits (or careers page) → the same journey up to selection → Onboarding with the
course and certification test and payment set-up → PM assigns → … → Validator accepts → an earning → weekly pay run.**

Non-negotiables you should actively try to break (report any breach as **S1**):

- Accepted tasks and reviews can never be edited or deleted (only corrected by a new record). The same applies to
  earnings, partner fees and the history partners see.
- AI never makes a final decision; a human (a Validator, Admin or Finance user) does. This includes certification:
  a model's grade is only a recommendation.
- Identity images and ID numbers are never stored or shown; selfie photos are never stored; bank and tax details are
  never stored (the payout provider holds them).
- Task content is synthetic only: no real customer, colleague or employer data.
- Every change is authorised, happens once even if you click twice, and is in the audit log.

## 2. Your first day

1. Get from the lead tester: your console accounts (one per role, including Finance if you test payments), the partner
   portal login if you test partners, the invite to the testers' GitHub repository (section 10), and a slot in the daily schedule.
2. Set up browser profiles (section 5) and bookmark the URLs (section 3), including the partner portal.
3. Sign in once with each role and check the yellow banner shows **Test environment** and a build number.
4. Read the glossary (section 13), [WHATS-NEW-1.1.md](WHATS-NEW-1.1.md) and skim
   [DECISION-REGISTER.md](DECISION-REGISTER.md) (the M10 and UI decisions are new).
5. Run **TC-E2E-001** together with another tester (one plays SME, the other Validator and PM). It takes about an
   hour and shows you the whole product. Then follow the **day 1 order** in "What's new" above.
6. Copy `test-cases.csv` into your own sheet (or the team's shared Google Sheet) and start on your assigned group.
   [COVERAGE.md](COVERAGE.md) shows which cases cover each screen, role and Admin function, and what is not covered yet.

## 3. The test environment

| What | Where |
| --- | --- |
| Console (Admin, PM, Validator, Finance) | `https://praxis-web-742785092638.us-central1.run.app` |
| Partner portal (new in 1.1) | `https://praxis-web-742785092638.us-central1.run.app/partner/login` |
| Candidate app (SMEs) | `https://praxis-candidate-742785092638.us-central1.run.app` |
| API and interactive API docs | `https://praxis-api-742785092638.us-central1.run.app` · `https://praxis-api-742785092638.us-central1.run.app/docs` |
| Partner API v1 (new in 1.1) | `https://praxis-api-742785092638.us-central1.run.app/partner/v1` |
| Careers page of a requisition (new in 1.1) | `https://praxis-candidate-742785092638.us-central1.run.app/careers/requisitions/<requisition id>` (the id is the last part of the requisition's URL in the console or partner portal) |
| Current build | the yellow banner on every page, or `https://praxis-api-742785092638.us-central1.run.app/api/v1/version` |

- **Real AI:** the profile chat, the suitability recommendation, the task drafter, the duplicate check, and (from 1.1)
  the course and test generation, the grading recommendation for written answers and the Support Bot use the real
  Claude and Google models. Answers vary from run to run: judge whether they are sensible, not whether they are
  identical.
- **Simulated:** Google sign-in (a form where you type any email), the identity check and the selfie check before
  each test attempt (pages where you choose the outcome), the payout provider (a "Simulated payout provider" page with a
  Finish button; payouts are marked by the simulation), and email (no emails are sent; tasks appear on the project page,
  and partner invites are not emailed: the partner copies the invite link from the "Test environment: invite link"
  box, see "What's new").
- **Shared and persistent:** all testers share one environment. Data is never reset. Prefix everything you create
  with your initials (projects, templates, users) so others can tell it apart.
- **Synthetic only:** never type real names of real customers, colleagues, employers, real phone numbers, Aadhaar, PAN,
  bank details or passwords you use elsewhere. Use the examples in this guide.
- **Nightly builds:** a new build is deployed at **02:00 IST** if anything was merged the day before. Work in progress
  is kept. Do not test between 01:45 and 02:30 IST.
- **Cold starts:** servers sleep when idle. The first click after a quiet period can take 5–10 seconds. That is
  expected; report it only if a page is slow when warm.

## 4. Accounts

**Console users** (Admin, PM, Validator, Finance): the lead tester creates named accounts for each tester with the
API, because Admin → Users is a read-only list in 1.1 (no Add, Edit or Disable screen): `POST /api/v1/users` with an
Admin session cookie, an `Idempotency-Key` and `{"email","name","roles","password"}` (roles `PM`, `REVIEWER` for
Validator, `FINANCE`, `ADMIN`), e.g. `pm.pk@praxis.test`, `validator.pk@praxis.test`, `finance.pk@praxis.test`. Roles
change with `PATCH /api/v1/users/<id>/roles` and accounts are disabled with `PATCH /api/v1/users/<id>/status` (see
TC-ADM-001 to TC-ADM-003 and [ROLES-AND-ADMIN.md](../user-guide/ROLES-AND-ADMIN.md#4-admin-functions)). Passwords are
at least 12 characters; share them only in the team password manager, never in GitHub or chat. The built-in accounts
`admin@praxis.demo`, `pm@praxis.demo`, `reviewer@praxis.demo` (Validator) and, new in 1.1, `finance@praxis.demo` are
shared: the lead gives out their passwords (from Secret Manager) when a case needs them, e.g. the PM who owns the
"KYC authoring demo" project is `pm@praxis.demo`.

A Validator only sees applications and tasks of projects they are assigned to. Ask the lead (or a PM) to add your
Validator account to the project you are testing (Project → Validators).

**Partner portal users** (new in 1.1): `partner@praxis.demo` for "Demo Staffing Partner" signs in at
`<console URL>/partner/login`. For isolation tests an Admin creates a second partner and a portal user for it
(Partners → a partner → Portal users), e.g. `ops.pk@partner.example.test`. Partners cannot create their own users.

**Candidates (SMEs):** on the candidate sign-in page type any email and name in the mock form. Use a new email for each
test case that needs a new candidate, following this pattern so everyone can tell whose they are:

```
sme.<your initials>.<case number>@example.test      e.g. sme.pk.012@example.test
```

Emails at `example.test` are reserved for testing. Never use your real email.

**RL Gym key:** for API tests, an Admin creates one in Admin → API clients (kind RL_GYM). It is shown once; keep it in
the password manager.

## 5. Several roles at once

The console keeps **one sign-in per browser**. If you sign in as PM in a tab where you were Validator, you become PM
everywhere in that browser. Use one **Chrome profile** per role:

1. Chrome → click your profile picture (top right) → **Add** → "Continue without an account" → name it "Praxis PM".
2. Repeat for "Praxis Validator", "Praxis Admin", "Praxis SME" and, for 1.1, "Praxis Finance" and "Praxis Partner".
   Give each a different colour. (The partner portal has its own sign-in, so the Partner profile can share a
   browser with a console role, but a separate profile is less confusing.)
3. Open each profile in its own window and sign in once. The windows stay signed in independently.

Alternative: one role in Chrome, one in Edge, one in a Firefox private window.

## 6. Browsers and devices

Test on what our experts and staff in India actually use:

| Priority | Browser and device |
| --- | --- |
| Must | Chrome (latest) on Windows 10/11 laptop · Chrome on a mid-range Android phone (e.g. 6 GB RAM, 360×800) |
| Should | Edge on Windows · Safari on iPhone · Safari on macOS |
| Could | Firefox on Windows · Samsung Internet on Android |

The task workbench is designed for laptops; on a phone it is read-only by design. Everything else must work on a phone.

For network tests use Chrome DevTools → Network → throttling ("Fast 4G", "Slow 4G"), and test at least once on a real
mobile data connection.

## 7. How to run the tests

**Order each cycle:** end-to-end journeys (TC-E2E-*) first, then P1 cases of your group, then P2, then P3, then
exploratory testing. Security (TC-SEC-*) is for everyone; penetration testing (TC-PEN-*) only for the named pen testers.

**Recording:** for every case you run, fill in the columns *Status* (Pass, Fail, Blocked, Not run), *Tester*,
*Date (IST)*, *Build* (from the banner) and, if it failed, *Issue link*. A case that passes but has a UX problem is
"Pass" with a separate UX issue.

**Each test case has:** the persona, priority, what to set up first, numbered steps, the expected results, and the
decisions it checks (links to the register). If what you see differs from "Expected", it is a defect. If "Expected"
itself seems wrong for users, raise an **Enhancement** naming the decision.

**Exploratory testing:** spend at least 30 % of your time outside the scripts. Good starting points: things a real KYC
analyst would do that the scripts do not; wrong orders of steps; leaving and coming back; two tabs; slow networks;
long and unusual input (Hindi and Tamil text, very long names, emoji, pasted Word text); and anything that felt
confusing.

**Daily rhythm (IST):**

| Time | What |
| --- | --- |
| 09:30 | Check the banner for a new build. Read your issues on GitHub: verify anything marked "ready to verify" first |
| 10:00–13:00 | Test (P1 first) |
| 13:00–14:00 | Lunch |
| 14:00–17:30 | Test; exploratory testing |
| 17:30–18:00 | File or finish issue reports; update the sheet |
| 18:00 | Lead: triage call (15 minutes) |
| 01:00 / 02:00 | Nightly agent / nightly build (automatic; do not test 01:45–02:30) |

## 8. Sample files

In `samples/` (download them from GitHub: open the file → "Download raw file"):

| File | Use in |
| --- | --- |
| `kyc-procedure-notes.txt` / `.pdf` / `.docx` | Clean procedure notes to draft from (TC-E2E-002, TC-SME-045); from 1.1 also the **guidelines** to upload for courses and tests (TC-E2E-009, TC-ADM-016) |
| `interview.vtt`, `interview.srt` | Interview transcripts (captions) (TC-SME-045, TC-SME-049) |
| `notes-with-real-looking-ids.txt` | Public example IBAN, PAN, Aadhaar-format number, email, phone, card: must be flagged and never reach a draft (TC-SME-047, TC-SEC-014) |
| `prompt-injection.txt` | A document that tries to give the AI orders (TC-SME-048, TC-PEN-007); from 1.1 also as guidelines and against the Support Bot (TC-ADM-017, TC-SEC-024, TC-PEN-020) |
| `scanned-image-only.pdf` | A PDF with no text: must be refused (TC-SME-046, TC-ADM-017) |
| `jd-kyc-analyst.pdf` | A job description for the PM's opportunity import (TC-PM-004) |
| `rl-review-request.json` | Body for an RL Gym review request (TC-E2E-005, TC-RLG-001) |

**A file over 10 MB** (for the size limit tests):

- Windows PowerShell: `"a" * 11000000 | Out-File -Encoding ascii big.txt`
- macOS / Linux: `head -c 11000000 /dev/zero | tr '\0' a > big.txt`

## 9. Using the API

Some tests call the API directly. Use Postman (desktop app) or `curl`.

- **As a signed-in user:** copy the session cookie from DevTools → Application → Cookies (`praxis_session` on the
  console, `praxis_candidate` on the candidate app, `praxis_partner` on the partner portal) and send it as
  `Cookie: praxis_session=<value>` to
  `https://praxis-web-742785092638.us-central1.run.app/api/v1/...` (or the candidate URL). Never paste cookies into GitHub.
- **As RL Gym:** send `Authorization: Bearer <key>` to `https://praxis-api-742785092638.us-central1.run.app/api/v1/...`.
- **As a partner system (1.1):** create a Sandbox API client in the partner portal (API & webhooks), get a token from
  `POST https://praxis-api-742785092638.us-central1.run.app/partner/v1/oauth/token` (grant_type=client_credentials),
  then send `Authorization: Bearer <token>` to `/partner/v1/...` (TC-PTR-011). Tokens last one hour.
- **Every POST, PUT, PATCH and DELETE** needs a header `Idempotency-Key: <a new UUID>` (Postman: `{{$guid}}`).
- See [API-QUICK-REFERENCE.md](API-QUICK-REFERENCE.md) for every endpoint and who may call it (the Partner API is listed
  under `/partner/v1`; everything else is under `/api/v1`), and `https://praxis-api-742785092638.us-central1.run.app/docs`
  for request and response shapes.

Example (RL Gym request, macOS/Linux):

```bash
curl -s -X POST "https://praxis-api-742785092638.us-central1.run.app/api/v1/integrations/rl-gym/review-requests" \
  -H "Authorization: Bearer $RL_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  --data @rl-review-request.json
```

## 10. Reporting problems

Report in the testers' GitHub repository **[adi-praxis-testing](https://github.com/vasudevansundarababu-dev/adi-praxis-testing)** (private; it holds this guide and the
test cases, not the application code). You need a free GitHub account and the invite from the lead: accept it at
https://github.com/vasudevansundarababu-dev/adi-praxis-testing/invitations, then **Issues → New issue**, and pick a form:

| Form | When |
| --- | --- |
| **Defect** | Something does not work as the test case, the decision register or common sense says it should |
| **UX issue** | It works, but it is confusing, slow, hard to read, inaccessible or takes too many steps |
| **Enhancement request** | Something new, or you think a documented decision is wrong for users |
| **Security vulnerability** | **Never an issue.** Use the private advisory link (see [SECURITY.md](../../SECURITY.md)) |

**A good report** has one problem, the test case id, the build, exact numbered steps, expected vs actual, a
screenshot or short screen recording (Windows: Win+Shift+S; Android: power + volume down; for recordings use the Xbox
Game Bar or the phone's screen recorder), the time in IST and your browser/device. Copy error messages exactly,
including the "request id" when one is shown: developers use it to find the exact server log.

**Severity** (the triage lead may change it):

| Severity | Meaning | Examples |
| --- | --- | --- |
| **S1 critical** | Blocks a whole journey, loses or leaks data, breaks a non-negotiable | Cannot submit any task; one candidate sees another's data; an accepted task can be edited; a real identifier reaches the dataset |
| **S2 major** | A feature is wrong or blocked with no reasonable workaround | Draft never finishes; reviewer cannot request rework; wrong match scores |
| **S3 minor** | Wrong but with a workaround, or a clear UX problem | Error message unhelpful; a list not sorted; slow but works |
| **S4 trivial** | Cosmetic | Spelling, alignment, colours |

Search open issues first; if it exists, add your details as a comment instead of a new issue.

**Release 1.1 notes:** start the title with `[Partner]` or `[Finance]` for those personas, and choose Partner /
Finance in the persona list. Problems of the environment itself (Claude
unavailable, generation FAILED on quota, a page saying SME supply is not switched on) go in **one** Defect titled
`[Environment] …`; do not file one per screen.

## 11. What happens to your report

1. **Triage (daily, 18:00 IST):** the lead reproduces it, sets severity and labels. Code defects that are safe to fix
   automatically get the label `agent:ready`. Questions come back to you as comments with `status:needs-info`.
2. **Fix:** a developer (or the nightly AI agent, 01:00 IST) writes a test that shows the defect, fixes it in the code
   repository and a human merges it. Pull requests are in the code repository, which testers cannot see; progress is
   posted as comments and labels on your issue. If the behaviour is an agreed decision, the product owner decides
   (`status:decision-needed`).
3. **Nightly build (02:00 IST):** merged fixes are deployed. Your issue gets a comment "The fix is in build …, please
   verify" and the label `status:ready-to-verify`.
4. **You verify** on the new build and comment **`/verified`** (the issue closes) or **`/failed`** plus what you saw
   (it reopens and goes back to triage).

Security reports never go to the agent; developers handle them privately.

## 12. Known limitations of the test environment

Do not report these as defects (you may raise an Enhancement if you think they matter for production):

- Sign-in, identity check and email are simulated (by design). In test, anyone can sign in as any candidate email.
- Malware scanning of uploads is a placeholder in v1 (every file is marked clean).
- Scanned (image-only) PDFs are refused; there is no OCR in v1.
- Blind solve (a second expert solving a task without the solution) is not built in v1.
- The staffing board does not yet explain why a selected expert is missing (usually a required filter).
- AI answers differ between runs.
- Cold starts of 5–10 s after idle.
- Release 1.1: see "Known limitations of this build" in "What's new" at the top (simulated payouts and selfie check,
  Claude quota risk, ids instead of names on some screens, no CV upload, partners cannot manage their own users).

## 13. Glossary

| Term | Meaning |
| --- | --- |
| SME | Subject-matter expert: the person writing tasks |
| Opportunity / pool | A project's public page that SMEs apply to |
| Enrollment / application | One SME's application to one opportunity |
| Selection | A Validator's decision to admit an SME to the pool (never automatic) |
| Validator | The internal staff role that selects applicants and reviews tasks (called "Reviewer" in 1.0 and in the code) |
| Onboarding | Seven steps after selection: scope, terms, conflicts, guidance, work preferences |
| Proposal / assignment | A PM offers a project to a selected SME; it counts only once the SME accepts |
| Template / workflow | A reusable definition of a kind of work, e.g. "Banking / KYC onboarding and refresh" |
| Slot | The specific case a task must cover, e.g. "corporate, high risk" or "Edge case: expired ID" |
| Edge case | An unusual situation the task must contain |
| Workbench W00–W06 | The task editor: W00 start (document/interview), W01 slot brief, W02 scenario and customer file, W03 evidence and tool responses, W04 reference trajectory (the correct solution), W05 rubric, W06 check and submit |
| Human gate | Decisions only a person may take (approve, reject, high-risk rating); the AI agent must escalate them |
| MCP / tools/call | Model Context Protocol: the standard way AI agents call tools. Each tool response in a task is recorded as an MCP call so the task can be replayed |
| Approved Task Dataset | The permanent, append-only store of accepted tasks used by RL Gym |
| RL Gym | The separate platform that trains and evaluates AI agents on accepted tasks |
| KYC / EDD / PEP / UBO | Know Your Customer / Enhanced Due Diligence / Politically Exposed Person / Ultimate Beneficial Owner |
| Build | The version deployed, shown in the banner, e.g. `test-1.1-20260930` or `nightly-20260929-1a2b3c4` |
| Partner | A staffing company that puts candidates forward. It "owns" a person it submits first for 12 months |
| Requisition | A role opened on a project for one tier and domain: headcount, requirements, allowed partners, careers page, pay route, guidelines and rate card. States: Draft, Open, Paused, Filled, Closed |
| Requirement screen | An automatic comparison of a submission with the requisition's minimum requirements. Only a recommendation: a Validator confirms "not met" |
| Tier | The SME's level in a domain: **Expert** (authors workflows and rubrics), **Reviewer** (reviews tasks; an SME tier, not the internal Validator role) or **Annotator** (labels and structured tasks). Each tier has its own course and test |
| Guidelines package / version | The client's written rules for a domain and task family, uploaded by an Admin. Each upload is a new version |
| Knowledge map | Rules, steps, thresholds, edge cases and failure modes drawn from the guidelines, each citing a section (S1, S2 …) |
| Certification | Passing a tier's test after its course. Valid 12 months. States include In training, Test ready, Passed, Retake available, Review required, Not certified |
| Blueprint | The plan of a tier's test: competencies and weights, number of questions, time limit and pass rules |
| Item family | A question template (e.g. "is this owner a beneficial owner?") with variable facts and a rule that derives the correct answer; each candidate gets a fresh instance |
| Selfie check | A quick face check before each test attempt (simulated in test); only the result is kept |
| Rate card | The price per accepted task by task type (Authoring, Annotation, RL review), in USD or INR. Versioned, never edited |
| Pay route | Who pays the SMEs of a requisition: Direct (ADI Praxis) or Via partner |
| Earning | One ledger line per accepted task at the rate-card price. Never edited; corrected by a reversal line |
| Pay run | One week's payouts (Monday to Monday): built, confirmed by a PM, approved and submitted by Finance |
| Pay hold | A block on an SME's payouts (dispute or fraud flag) until Finance releases it; held amounts carry forward |
| Payee | An SME's account with the payout provider. Praxis stores only its status and reference, never bank or tax details |
| Partner statement | A partner's monthly list of certified-candidate fees (paid outside Praxis) |
| Support Bot | The Help panel in the console and partner portal that explains the screen and the process; it never acts |

## 14. Contacts

| Topic | Who |
| --- | --- |
| Accounts, access, schedule, triage | Lead tester (name in the team channel) |
| Product decisions and enhancements | Product owner: Vasudevan Sundarababu |
| Security findings | Private advisory only (SECURITY.md) |
