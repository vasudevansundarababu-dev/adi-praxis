# Roles, user IDs and admin functions

This page lists every kind of user in ADI Praxis, the demo user IDs in the test and demo environments, what each role
may see and do, and every Admin function. It is checked against the code (release 1.1, build `test-1.1-20260930`).

**Passwords are never written in this guide, GitHub, chat or email.** The demo passwords are generated at deploy time
and kept in the environment's Google Secret Manager as `demo-<role>-password`. Ask the lead tester or the platform
owner for them.

## 1. Who uses ADI Praxis

| Role | Shown on screen as | App | Signs in at | What they do in one line |
| --- | --- | --- | --- | --- |
| `ADMIN` | Admin | Console | `<console>/login` | Sets up the platform: templates, users, terms, partners, guidelines and courses, API keys |
| `PM` | PM (Home says "Program Manager") | Console | `<console>/login` | Runs projects: creates them, staffs them, opens requisitions, confirms pay runs |
| `REVIEWER` | **Validator** | Console | `<console>/login` | Human decision-maker: selects candidates, accepts or returns tasks, judges RL results, confirms grades |
| `FINANCE` | Finance | Console | `<console>/login` | Rate cards, earnings and holds, approves and submits pay runs, payout exceptions, partner statements |
| Partner user | Partner | Partner portal | `<console>/partner/login` | Puts candidates forward for open requisitions, follows them, reads fee statements |
| Candidate / SME | (the person's name) | Candidate app | `<candidate>/sign-in` | Applies, verifies identity, certifies, onboards and authors tasks; gets paid per accepted task |
| Partner API client | – | Machine | `POST /partner/v1/oauth/token` | A staffing partner's system submitting candidates with OAuth2 client credentials |
| RL Gym / client API key | – | Machine | `Authorization: Bearer <key>` | RL Gym reads the approved dataset and sends RL results; a client system sends task inputs |

One console user can hold several roles (for example PM and Validator). A Finance user cannot approve a pay run that
pays themselves.

**Two words that are easy to confuse**

- **Validator** is the internal console role (`REVIEWER` in the code) that makes human decisions.
- **Reviewer** on a screen now means an SME *tier* (Expert, Reviewer, Annotator), not the console role.

## 2. Demo and test user IDs

| User ID | Role | Name in the data | Environment | Password |
| --- | --- | --- | --- | --- |
| `admin@praxis.demo` | ADMIN | Platform Admin | Demo and test | Secret Manager `demo-admin-password` |
| `pm@praxis.demo` | PM | Pat Morgan | Demo and test | `demo-pm-password` |
| `reviewer@praxis.demo` | REVIEWER (Validator) | Riley Chen | Demo and test | `demo-reviewer-password` |
| `finance@praxis.demo` | FINANCE | Farah Iqbal | Demo and test (SME supply on) | `demo-finance-password` |
| `partner@praxis.demo` | Partner user of "Demo Staffing Partner" | Meera Nair | Demo and test (SME supply on) | `demo-partner-password` |
| Any email you type in the mock Google form | Candidate / SME | The name you type | Demo and test (mock sign-in) | none: the mock asks for email and name only |
| `admin@praxis.local` (from `SEED_ADMIN_EMAIL`) | ADMIN | Platform Admin | Local development | `SEED_ADMIN_PASSWORD` in your `.env` |
| `admin@`, `pm@`, `finance@`, `validator@e2e.local` | ADMIN, PM, FINANCE, REVIEWER | – | Automated end-to-end tests only | fixed in `apps/api/scripts/e2e-prepare.ts` |

**Environments**

| Environment | Console | Candidate app |
| --- | --- | --- |
| Test (testers, real Claude) | https://praxis-web-742785092638.us-central1.run.app | https://praxis-candidate-742785092638.us-central1.run.app |
| Demo | https://praxis-web-744400601364.us-central1.run.app | https://praxis-candidate-744400601364.us-central1.run.app |
| Local | http://localhost:3100 | http://localhost:3101 |

**Demo data that is already there**

- Template "KYC onboarding and refresh" (published), job description "KYC Analyst (task author)" (GBP 40 per task).
- Project **"KYC authoring demo"**, owned by `pm@praxis.demo`, with `reviewer@praxis.demo` assigned as Validator.
- Partner **"Demo Staffing Partner"** (banking, all tiers, fee USD 150 per certified candidate).
- Rate card **"KYC authoring (USD)"**: Authoring USD 40, Annotation USD 8.
- Requisition **"KYC authors — India (Annotator)"**, direct pay, careers page on.
- No guidelines and no candidates: testers create those.

**Naming your own test data.** Start names with your initials (for example `VS – KYC project`) so other testers can
tell data apart. Data made by the demo videos starts with `[Demo video]`.

## 3. What each role can open (console menu)

The console menu has two rows: the top row shows groups, the second row shows the pages of the selected group. You
only see groups your role may use. Groups marked † appear only when SME supply is switched on (it is on in test).

| Menu group → page | Admin | PM | Validator | Finance |
| --- | :-: | :-: | :-: | :-: |
| Home | ✓ | ✓ | ✓ | ✓ |
| Projects → Projects (and inside a project: staffing, opportunity page, progress, tasks and invites) | ✓ (all projects) | ✓ (own projects; only a PM can create one) | – | – |
| Projects → Templates | ✓ (create, publish, retire) | read only | – | – |
| Projects → Requisitions † | ✓ | ✓ | read, decide "not met" | – |
| Reviews → Applications, Task reviews, RL reviews, Identity reviews, Conflicts | ✓ (all projects) | – | ✓ (assigned projects) | – |
| Certification → Guidelines † | ✓ (upload, approve, publish) | – | read, approve item families | – |
| Certification → Certification reviews † | ✓ | – | ✓ (grades, decisions, licences) | – |
| Partners → Partners † | ✓ | – | – | – |
| Payments → Pay runs † | build, confirm, cancel | build, confirm | – | build, **approve, submit**, cancel |
| Payments → Rate cards † | ✓ | read | – | ✓ |
| Payments → Earnings and holds, Payout exceptions, Partner statements † | ✓ | – | – | ✓ |
| Admin → Users, Taxonomy, Terms, Failure codes, API clients | ✓ | – | – | – |
| Help (Support Bot, every page) | ✓ | ✓ | ✓ | ✓ |

If you open a page your role may not use, you see **"No access — This page is for …"** with a button back to your home
page. One browser holds one sign-in: use a separate browser profile or a private window for each role.

**Rules the platform enforces, whatever the screen shows**

- A PM sees and edits only projects they own. Only a **PM** can create a project; an Admin cannot.
- A Validator only sees review queues of projects they are assigned to.
- Only **Finance** can approve and submit a pay run, and never one that pays themselves. Admin and PM can confirm.
- An Admin cannot remove their own Admin role or disable their own account.
- Only an Admin can reject a certification item family.
- AI never makes a final selection, rejection, grade or task-acceptance decision. A Validator does.
- Every change is recorded in the audit log, with who did it and when.

## 4. Admin functions

| Function | Where in the console | API | Notes |
| --- | --- | --- | --- |
| List console users | Admin → Users | `GET /api/v1/users` | Roles, status, last sign-in, temporary-password flag |
| Create a console user (email, name, roles) | Admin → Users → Add a user | `POST /api/v1/users` | Praxis shows a temporary password once; the user must choose their own at first sign-in |
| Change a user's roles | Admin → Users → Edit roles | `PATCH /api/v1/users/:id/roles` | Cannot remove your own Admin role |
| Disable or re-enable a user | Admin → Users → Disable / Enable | `PATCH /api/v1/users/:id/status` | Disabling signs the user out everywhere; not allowed on yourself |
| Reset a user's password | Admin → Users → Reset password | `POST /api/v1/users/:id/password-reset` | New temporary password shown once; the user is signed out everywhere and must choose a new one; not on yourself |
| Domains and templates: create, edit draft, new version, publish, retire, history | Projects → Templates | `/api/v1/domains`, `/api/v1/templates…` | PMs read only. A project can only use a published template |
| Demographic taxonomy (diversity attributes) | Admin → Taxonomy | `POST /api/v1/demographic-attributes` | |
| Contributor terms (versions candidates accept) | Admin → Terms | `GET/POST /api/v1/terms` | |
| RL failure reason codes: add, deactivate | Admin → Failure codes | `POST/PATCH /api/v1/failure-reason-codes` | |
| Machine API keys (RL Gym, client API): create, revoke | Admin → API clients | `/api/v1/api-clients` | The key is shown once only; it is stored as a hash |
| Partners: onboard, edit, suspend | Partners → Partners | `POST /api/v1/partners`, `PATCH /api/v1/partners/:id` | Suspending revokes the partner's API tokens |
| Partner portal users: add, reset password, disable or enable | Partners → a partner → Portal users | `POST /api/v1/partners/:id/users`, `POST …/users/:userId/password-reset`, `PATCH …/users/:userId/status` | Temporary password shown once; changed at first sign-in |
| Partner fee terms | Partners → a partner | `PUT /api/v1/partners/:id/fee-terms` | |
| Guidelines: create package, upload version, view source, regenerate, edit knowledge items | Certification → Guidelines | `/api/v1/guidelines…` | Claude drafts; the Admin approves everything |
| Course: edit modules, approve or reject | Guidelines → a version → Course | `/api/v1/courses…` | |
| Test blueprint and item families: edit, generate samples, approve, reject | Guidelines → a version → Blueprint | `/api/v1/blueprints…`, `/api/v1/item-families…` | Expert-tier families also need a Validator (or Expert) approval |
| Publish a tier's course and test | Guidelines → a version | `POST …/tiers/:tier/publish` | Candidates see nothing until published |
| Change an SME's standing or tier (probation, active, retraining, suspended, offboarded) | **No screen yet** | `POST /api/v1/sme/:id/standing` | The partner is told on suspend, offboard or tier change |
| Approved Task Dataset: browse, export, correction records, verify the hash chain | **No screen yet** | `/api/v1/dataset…` | Records are append-only; a correction is a new record. A nightly job also verifies the chain |
| Audit log | **No screen or API yet** | – | Every change is written; it can be read in the database only |
| Everything a PM and a Validator can do | as above | | Except: creating projects (PM only) and approving or submitting pay runs (Finance only) |

**Switches the Admin can use to stop something quickly**

| To stop… | Do this |
| --- | --- |
| A person signing in to the console | Admin → Users → Disable |
| A staffing partner | Suspend the partner (also revokes its API tokens) |
| A machine client (RL Gym, client API) | Revoke its API key |
| A project or campaign | Pause or cancel it (PM or Admin) |
| A template being used for new projects | Retire it |
| An RL failure reason | Deactivate the code |
| The whole SME supply area | Set `SME_SUPPLY_ENABLED=false` and redeploy (environment setting, not a screen) |

## 5. How to sign in

| Who | How |
| --- | --- |
| Admin, PM, Validator, Finance | Open the console, enter email and password, **Sign in**. With a temporary password from an Admin you are taken to **Choose your own password** first. Sessions last 12 hours. Sign-in attempts are rate-limited (10 a minute by default) |
| Partner user | Open `<console>/partner/login`, enter email and password. Refused if the user or the partner is suspended |
| Candidate (test and demo) | Open the candidate app, **Sign in**. The mock Google form asks for an email and a name and, the first time, to confirm you are 18 or older. Use a new email for each new candidate |
| Candidate (production) | Real Google sign-in. Accounts are matched by Google account, never merged by email |
| Partner system | `POST /partner/v1/oauth/token` with client id and secret, then send the token as `Bearer` |
| RL Gym / client system | Send the API key from Admin → API clients as `Authorization: Bearer <key>` |

## 6. Known gaps (release 1.1)

These are real limits of the current build, not mistakes in this guide. If one matters to you, raise an Enhancement.

- No screen for the audit log, the Approved Task Dataset, or SME standing.
- The Partner API lives under `/partner/v1`, not `/api/v1`.
