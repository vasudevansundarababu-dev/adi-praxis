# Tester email: logins, Tutorials and the user guide (build test-1.1-20261002)

To: the India test team (GitHub: DhruvnStore, Shriya-ss10, hvenkat396-oss). Send from the product owner.
Passwords are **not** in this email; send them separately through the team password manager.

---

**Subject:** ADI Praxis – new test build: Tutorials videos, user guide, and every login you need

Hi team,

A new test build is live: **`test-1.1-20261002`** (you will see it in the yellow banner at the top of every page). It
keeps all your data and adds three things that should make testing easier:

1. **Tutorials in every app.** Short captioned videos (no sound) for each role, and the user guide.
2. **A user guide.** It shows how every role uses every screen, quoting the exact labels you see.
3. **A fix for file uploads.** Uploading guidelines, evidence, task files and licences failed with "Something went
   wrong" on 1 Oct. If you reported this, please re-test it and close the issue with `/verified`.

**WHERE TO SIGN IN**

| App | Who uses it | Address |
| --- | --- | --- |
| Console | Admin, PM, Validator, Finance | https://praxis-web-742785092638.us-central1.run.app |
| Partner portal | Staffing partner | https://praxis-web-742785092638.us-central1.run.app/partner/login |
| Candidate app | Experts (SMEs) | https://praxis-candidate-742785092638.us-central1.run.app |

**LOGINS FOR EVERY ROLE**

| Role | User ID | Where | What this role does |
| --- | --- | --- | --- |
| Admin | `admin@praxis.demo` | Console | Templates, guidelines, courses and tests, partners, users, terms, API keys |
| Program Manager (PM) | `pm@praxis.demo` | Console | Projects, opportunity pages, staffing, requisitions, confirming pay runs |
| Validator | `reviewer@praxis.demo` | Console | Selects candidates, accepts or returns tasks, RL reviews, certification reviews |
| Finance | `finance@praxis.demo` | Console | Rate cards, earnings and holds, approving and submitting pay runs, statements |
| Staffing partner | `partner@praxis.demo` | Partner portal | Puts candidates forward, tracks them, reads statements |
| Expert (SME) | any new email, e.g. `sme.<your initials>.<case>@example.test` | Candidate app | Applies, verifies identity, certifies, writes KYC tasks |

- **Passwords:** I will send these separately through the password manager. Never put them in GitHub, chat or email.
- **Experts:** Google sign-in is simulated. Type an email and a name, and tick "I confirm I am 18 or over" the first
  time. Use a new email for each new expert.
- **Several roles at once:** one browser keeps one console sign-in. Use a separate Chrome profile or a private window
  for each role.

**HOW TO WATCH THE TUTORIALS**

| App | Where to click | What you get |
| --- | --- | --- |
| Console | **Tutorials** (top menu, far right) | Videos for your role first, then the other roles (7 videos, 1–9 minutes each), and **Open the guide** for the full user guide (PDF) |
| Partner portal | **Tutorials** (portal menu) | The staffing partner video and the partner guide (PDF) |
| Candidate app | **Tutorials** (top navigation, also when signed out) | The expert video and the expert guide (PDF) |

Suggested order: watch **Getting started** (1½ minutes), then the video for the role you are testing, then keep the
guide open while you run the cases. The videos follow one story: Ravi is put forward by a staffing partner and takes
the certification; Asha applies directly and writes a KYC task with the AI interview.

Note: the videos were recorded on a copy of the test environment, so the banner in them says "Demo environment". The
screens are the same as yours.

**THE USER GUIDE AND TEST CASES IN GITHUB**

In https://github.com/vasudevansundarababu-dev/adi-praxis-testing:

- `docs/user-guide/README.md`: the user guide, one chapter per role. `ADI-Praxis-User-Guide.pdf` in the same folder
  is the whole guide as one PDF.
- `docs/user-guide/ROLES-AND-ADMIN.md`: who can open what, every Admin function, and the demo user IDs.
- `docs/testing/TEST-CASES.md`: now **271 cases** (39 new, several corrected). `docs/testing/COVERAGE.md` maps every
  screen to its cases. Download `test-cases.csv` again to track your runs.

New cases worth running first: **TC-ADM-037**, **TC-PTR-017**, **TC-SME-081** and **TC-SEC-029** (Tutorials), then
**TC-E2E-009** (guidelines to a live course), which the upload fix unblocks.

**REPORTING**

Nothing changes: report in the testers' repository with the Defect, UX issue or Enhancement form. Include the build
(`test-1.1-20261002`), the user ID you used (never the password), the steps and a screenshot.

Thank you,
<your name>
