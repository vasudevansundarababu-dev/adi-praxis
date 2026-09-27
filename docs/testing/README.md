# ADI Praxis tester guide (start here)

Welcome. This guide has everything you need to test ADI Praxis end to end: the environment, your accounts, the test
cases, the sample files, and how to report problems so they get fixed overnight. Read it once fully before your first
session; keep it open while you test.

**What is in this folder**

| File | What it is |
| --- | --- |
| `README.md` | This guide |
| [TEST-CASES.md](TEST-CASES.md) | All test cases, by persona, with steps and expected results |
| [test-cases.csv](test-cases.csv) | The same cases as a spreadsheet to record your runs (open in Excel or import into Google Sheets) |
| [DECISION-REGISTER.md](DECISION-REGISTER.md) | Every product decision, written as "what you should see". Test these too |
| [API-QUICK-REFERENCE.md](API-QUICK-REFERENCE.md) | Every API endpoint and who may call it |
| [PENTEST.md](PENTEST.md) | Rules for security and penetration testing (read before any security test) |
| [TRIAGE.md](TRIAGE.md) | How reports are triaged, fixed by the nightly agent and verified |
| `samples/` | Files to upload in the tests |

## 1. What ADI Praxis is

ADI Praxis lets subject-matter experts (SMEs) — for example KYC analysts from banks — write realistic, fully
synthetic training tasks for AI agents. Four kinds of people use it:

| Persona | App | What they do |
| --- | --- | --- |
| **SME / candidate** | Candidate app | Signs in, verifies identity, builds a profile through a short chat, gets selected, onboards, then writes tasks in the workbench (by hand, or drafted by AI from a document or an interview) |
| **Project manager (PM)** | Console | Creates projects from workflow templates, publishes the opportunity, staffs the project with selected experts, watches progress |
| **Reviewer** | Console | Decides which applicants are selected, reviews submitted tasks (accept, rework, reject), judges RL Gym results |
| **Admin** | Console | Manages users, templates, terms, taxonomy, API keys; reads the Approved Task Dataset |
| **RL Gym** (a system) | API | Reads accepted tasks and sends AI-agent results back for human review |

The journey for an SME: **Sign in → Verify identity → Apply (profile chat) → Reviewer selects → Onboarding →
PM assigns → Accept → Write tasks → Reviewer accepts → Task enters the dataset.**

Non-negotiables you should actively try to break (report any breach as **S1**):

- Accepted tasks and reviews can never be edited or deleted (only corrected by a new record).
- AI never makes a final decision; a human Reviewer does.
- Identity images and ID numbers are never stored or shown.
- Task content is synthetic only: no real customer, colleague or employer data.
- Every change is authorised, happens once even if you click twice, and is in the audit log.

## 2. Your first day

1. Get from the lead tester: your console accounts (one per role), the GitHub repository invite, and a slot in the
   daily schedule.
2. Set up browser profiles (section 5) and bookmark the three URLs (section 3).
3. Sign in once with each role and check the yellow banner shows **Test environment** and a build number.
4. Read the glossary (section 13) and skim [DECISION-REGISTER.md](DECISION-REGISTER.md).
5. Run **TC-E2E-001** together with another tester (one plays SME, the other Reviewer and PM). It takes about an
   hour and shows you the whole product.
6. Copy `test-cases.csv` into your own sheet (or the team's shared Google Sheet) and start on your assigned group.

## 3. The test environment

| What | Where |
| --- | --- |
| Console (Admin, PM, Reviewer) | `https://praxis-web-742785092638.us-central1.run.app` |
| Candidate app (SMEs) | `https://praxis-candidate-742785092638.us-central1.run.app` |
| API and interactive API docs | `https://praxis-api-742785092638.us-central1.run.app` · `https://praxis-api-742785092638.us-central1.run.app/docs` |
| Current build | the yellow banner on every page, or `https://praxis-api-742785092638.us-central1.run.app/api/v1/version` |

- **Real AI:** the profile chat, the suitability recommendation, the task drafter and the duplicate check use the real
  Claude and Google models. Answers vary from run to run: judge whether they are sensible, not whether they are
  identical.
- **Simulated:** Google sign-in (a form where you type any email), the identity check (a page where you choose the
  outcome), and email (no emails are sent; invites are not needed because tasks appear on the project page).
- **Shared and persistent:** all testers share one environment. Data is never reset. Prefix everything you create
  with your initials (projects, templates, users) so others can tell it apart.
- **Synthetic only:** never type real names of real customers, colleagues, employers, real phone numbers, Aadhaar, PAN,
  bank details or passwords you use elsewhere. Use the examples in this guide.
- **Nightly builds:** a new build is deployed at **02:00 IST** if anything was merged the day before. Work in progress
  is kept. Do not test between 01:45 and 02:30 IST.
- **Cold starts:** servers sleep when idle. The first click after a quiet period can take 5–10 seconds. That is
  expected; report it only if a page is slow when warm.

## 4. Accounts

**Console users** (Admin, PM, Reviewer): the lead tester creates named accounts for each tester in Admin → Users,
e.g. `pm.pk@praxis.test`, `reviewer.pk@praxis.test`. Passwords are at least 12 characters; share them only in the
team password manager, never in GitHub or chat. The built-in `admin@praxis.demo`, `pm@praxis.demo` and
`reviewer@praxis.demo` accounts are for the lead only.

A Reviewer only sees applications and tasks of projects they are assigned to. Ask the lead (or a PM) to add your
reviewer account to the project you are testing (Project → Reviewers).

**Candidates (SMEs):** on the candidate sign-in page type any email and name in the mock form. Use a new email for each
test case that needs a new candidate, following this pattern so everyone can tell whose they are:

```
sme.<your initials>.<case number>@example.test      e.g. sme.pk.012@example.test
```

Emails at `example.test` are reserved for testing. Never use your real email.

**RL Gym key:** for API tests, an Admin creates one in Admin → API clients (kind RL_GYM). It is shown once; keep it in
the password manager.

## 5. Several roles at once

The console keeps **one sign-in per browser**. If you sign in as PM in a tab where you were Reviewer, you become PM
everywhere in that browser. Use one **Chrome profile** per role:

1. Chrome → click your profile picture (top right) → **Add** → "Continue without an account" → name it "Praxis PM".
2. Repeat for "Praxis Reviewer", "Praxis Admin" and "Praxis SME". Give each a different colour.
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
| `kyc-procedure-notes.txt` / `.pdf` / `.docx` | Clean procedure notes to draft from (TC-E2E-002, TC-SME-045) |
| `interview.vtt`, `interview.srt` | Interview transcripts (captions) (TC-SME-045, TC-SME-049) |
| `notes-with-real-looking-ids.txt` | Public example IBAN, PAN, Aadhaar-format number, email, phone, card: must be flagged and never reach a draft (TC-SME-047, TC-SEC-014) |
| `prompt-injection.txt` | A document that tries to give the AI orders (TC-SME-048, TC-PEN-007) |
| `scanned-image-only.pdf` | A PDF with no text: must be refused (TC-SME-046) |
| `jd-kyc-analyst.pdf` | A job description for the PM's opportunity import (TC-PM-004) |
| `rl-review-request.json` | Body for an RL Gym review request (TC-E2E-005, TC-RLG-001) |

**A file over 10 MB** (for the size limit tests):

- Windows PowerShell: `"a" * 11000000 | Out-File -Encoding ascii big.txt`
- macOS / Linux: `head -c 11000000 /dev/zero | tr '\0' a > big.txt`

## 9. Using the API

Some tests call the API directly. Use Postman (desktop app) or `curl`.

- **As a signed-in user:** copy the session cookie from DevTools → Application → Cookies (`praxis_session` on the
  console, `praxis_candidate` on the candidate app) and send it as `Cookie: praxis_session=<value>` to
  `https://praxis-web-742785092638.us-central1.run.app/api/v1/...` (or the candidate URL). Never paste cookies into GitHub.
- **As RL Gym:** send `Authorization: Bearer <key>` to `https://praxis-api-742785092638.us-central1.run.app/api/v1/...`.
- **Every POST, PUT, PATCH and DELETE** needs a header `Idempotency-Key: <a new UUID>` (Postman: `{{$guid}}`).
- See [API-QUICK-REFERENCE.md](API-QUICK-REFERENCE.md) for every endpoint and who may call it, and `https://praxis-api-742785092638.us-central1.run.app/docs`
  for request and response shapes.

Example (RL Gym request, macOS/Linux):

```bash
curl -s -X POST "https://praxis-api-742785092638.us-central1.run.app/api/v1/integrations/rl-gym/review-requests" \
  -H "Authorization: Bearer $RL_KEY" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  --data @rl-review-request.json
```

## 10. Reporting problems

Report on GitHub: **Issues → New issue**, and pick a form:

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

## 11. What happens to your report

1. **Triage (daily, 18:00 IST):** the lead reproduces it, sets severity and labels. Code defects that are safe to fix
   automatically get the label `agent:ready`. Questions come back to you as comments with `status:needs-info`.
2. **Nightly agent (01:00 IST):** an AI developer (Claude) reads the issue, writes a test that shows the defect, fixes
   it, and opens a pull request. It comments on your issue. A human developer reviews and merges it during the day.
   If it thinks the behaviour is an agreed decision, it says so and asks the product owner (`status:decision-needed`).
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

## 13. Glossary

| Term | Meaning |
| --- | --- |
| SME | Subject-matter expert: the person writing tasks |
| Opportunity / pool | A project's public page that SMEs apply to |
| Enrollment / application | One SME's application to one opportunity |
| Selection | A Reviewer's decision to admit an SME to the pool (never automatic) |
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
| Build | The version deployed, shown in the banner, e.g. `nightly-20260928-1a2b3c4` |

## 14. Contacts

| Topic | Who |
| --- | --- |
| Accounts, access, schedule, triage | Lead tester (name in the team channel) |
| Product decisions and enhancements | Product owner: Vasudevan Sundarababu |
| Security findings | Private advisory only (SECURITY.md) |
