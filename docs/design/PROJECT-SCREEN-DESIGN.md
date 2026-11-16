# Project screen redesign: MVP1 design, **approved by the owner on 15 Nov 2026**

Mockup: `docs/design/mockups/project-screen.html`, in the console's own style (`packages/shared/theme/theme.css`).
Approved for development (owner, 15 Nov 2026). The build follows "Rule for building this: no breakages" and its order.

## Public names: legal rule (owner, 15 Nov 2026)

The legal team says the product's public branding must not use **"ADI-Labs"**, **"Praxis"** or **"Anvil"**, for
copyright and trademark reasons. Internal use has no issue. So:

- **Nothing a user sees** may show those names: screens, browser titles, help and support text, emails, the
  recruiter PDF, reports and exports for people, image alt text, and API messages that reach the screen.
- **Product name:** **ADI Forge**, with the ADI-Forge logo. The ADI-Labs tagline ("Intelligence Beyond Boundaries")
  is removed.
- **Anvil on screen:** **RL Gym** (owner, 15 Nov). For example "Export to RL Gym", "Validate", "Validated by RL Gym".
- **Us on Anvil's side:** Anvil's product calls this platform **"Authoring"** (owner, 15 Nov), matching the logo's
  "ADI Forge Authoring". Each side shows the other only by these public names; the integration is unchanged.
- **Unchanged (internal):**
  - code and package names (`@praxis/shared`, `praxis-*` services), URLs and the repository;
  - API paths, the export schema (`praxis.authored-task-export.v1`) and payload identifiers;
  - the Anvil integration and contract, and internal docs.
  - Machine-to-machine names are not branding.
- **Scope in today's code** (about): 40 "ADI Praxis", 51 "Anvil", 3 "ADI-Labs" and 2 tagline uses in UI-facing code,
  plus API messages shown to users. The build adds a test that fails if any of these names appears in UI-facing
  strings, so they can't creep back.

## Typography (owner, 15 Nov 2026)

These apply to both apps (console and candidate) and to the recruiter PDF.

- **Headings, titles and primary buttons:** Geist, weights 500, 600 and 700, `letter-spacing: -0.02em`.
- **Body copy, form labels and dense tables:** Inter, weights 400, 500 and 600, with automatic optical sizing
  (`font-optical-sizing: auto`).
- **Numbers, badges, IDs and code or JSON:** Geist Mono, weights 400, 500 and 600, with
  `font-variant-numeric: tabular-nums`.
- **Build:** this replaces Plus Jakarta Sans. The change goes in the shared theme (`packages/shared/theme`) and each
  app's `next/font` setup, so both apps change together. All three fonts are on Google Fonts and load through
  `next/font`, with no external requests at run time. Colours stay as they are.

## Branding image: ADI Forge (owner, 15 Nov 2026)

**Image and name (owner, 15 Nov 2026):** the UI shows **"ADI Forge"** instead of "ADI Praxis". This includes the
navigation, sign-in, page titles, emails and the recruiter PDF. The mockups are updated.

- **In the apps:** a text-only change, about 77 places in `apps/` and `packages/`, plus email templates. Out of
  scope:
  - code and package names (`@praxis/shared`, `praxis-*` services, URLs, the repository);
  - the tagline;
  - "Praxis Demo Bank", the fictional bank in the synthetic policy files.
- **First step:** each place gets its product name from one shared constant, so a future rename is one line.

The earlier note, kept for history: "The image only changes; the words stay ADI Praxis for now." 

- **Source:** the owner's ADI-Forge image. Its background was made transparent, and the corner watermark was cropped
  out. The owner is to confirm usage rights before it goes into the apps.
- **Files:**
  - `docs/design/brand-forge/adi-forge-logo.png`: the full logo. "ADI" is white, so use it on dark backgrounds only.
  - `docs/design/brand-forge/adi-forge-mark-512.png`: the square mark.
- **In the apps, when approved:** replace the files in `packages/shared/brand` under the same names, so no code
  changes:
  - `praxis-logo-cropped.png` with the full logo;
  - `praxis-mark-512.png` with the mark;
  - `favicon.ico` and `apple-touch-icon.png`, made from the mark.

## Rule for building this: no breakages (owner, 15 Nov)

Nothing that works today may stop working while this is built.

- **Additive first.** New screens and APIs are added next to the old ones; old routes keep working until the new
  ones replace them and are tested.
- **Switch, don't delete.** The new flow (Sourcing, direct task assignment, the new candidate Home) sits behind a
  setting. The old flow (opportunity, apply, selection, proposals) keeps running until the owner switches over.
- **Hide only what has a replacement.**
  - The Reviews menu stays until the project Tasks tab can approve, rework and reject.
  - Opportunities, Certifications, Partners and Payments are hidden from menus only; their data and routes stay.
- **Data is never lost.** Migrations only add; append-only tables and their triggers are untouched.
- **Every step is proven.** Each change needs:
  - its own tests (mocks only);
  - the full API suite green;
  - the QA smoke test passing before and after deploy.
- **The old journey keeps working** for SMEs already in it, until they finish or the owner retires it.

**Critical path to a first end-to-end run, in order, each shippable alone:**
1. PM or Admin assigns a person to a specific task. The eligibility check treats that assignment as the selection.
2. Tasks tab: the review page (Approve, Rework, Reject), with per-section comments.
3. Candidate Home: the task list, with New and Rework.
4. Export rule "all tasks approved". The Anvil side must be switched on (external, owner and Keystone).

Then, in this order:
- Sourcing;
- Online sign-in with set-password links;
- the Reviewer route in the candidate app;
- the task-linked Tutorial and the task-scoped Help;
- the menu clean-up.

## Tabs

One project page with four tabs, in this order: **Dashboard**, **Resource assignments**, **Tasks**, **Policies**.
The header (back link, name, status, description, Pause, Cancel project) stays above the tabs.

## Dashboard

- Summary cards: experts accepted, tasks approved, rule set, rework rate.
- A "Next step" banner that points at whatever is blocking.
- **Coverage by state** (owner, 15 Nov: scenarios are not a requirement). One row per state slot: task, author,
  status. Single, joint, minor or custodian stays the author's choice inside the task.
- Project details: the current Overview table. It adds:
  - **Review route**, read-only;
  - **Reviewers**;
  - **Export to Anvil** status.

## Resource assignments (owner, 15 Nov: one screen, no steps)

- A table of the people assigned to the project, with these columns:
  - **First name, Last name, Email**;
  - **Role** (SME or Reviewer);
  - **Status** (Assigned);
  - **Task ID** and **Task status**, one line per task the person is on.
- **Assigning always includes choosing the task (owner, 15 Nov):**
  - as SME, an unassigned task to author;
  - as Reviewer, an authored task to review, never their own.
  - There is no assigning without a task. The Tasks tab and this table stay in step.
- **What the person sees (owner, 15 Nov):** when they sign in to the candidate app, **Your tasks** lists each task
  with its status and a link:
  - **Author task** for Assigned or In progress;
  - **Fix and resubmit** for Rework, with the reviewer's comment shown;
  - **View** for Submitted or Approved.
- No other steps or sub-tabs. Opportunity, Screening, Ready and Assigned are gone.
- **Export to Recruiter (owner, 15 Nov): one button and one PDF.** It replaces the two export buttons and the old
  Opportunity page. There is no Publish and no public page.
  - The button opens a preview of the pack, with **Download PDF** and **Download Excel only**.
  - The PDF is built from the project and contains:
    1. **The role:** work, location and language, pay and effort, people needed.
    2. **Requirements:** each one Required or Preferred, with the evidence to check.
    3. **The task they would author (SME cheat sheet):** sections S1 to S8 in plain words, with an example, so
       recruiters pick the right profiles.
    4. **What to send back for each candidate:**
       - first name, last name and email (the Gmail address, required; it becomes their sign-in);
       - an assessment against each requirement;
       - why they fit;
       - answers to the questions;
       - optionally LinkedIn and a CV.
  - **Attached inside the PDF:** `candidate-assessment-<project>.xlsx`, with one row per candidate. Columns:
    - First name\*, Last name\*, Email\*;
    - LinkedIn URL;
    - a Met?/Evidence pair per requirement;
    - Q1 to Q6;
    - Why they fit;
    - Recruiter name, Agency.
  - Some PDF viewers (Chrome, email previews) hide attachments, so **Download Excel only** gives the same sheet on its
    own.
  - The recruiter returns the filled sheet. In Sourcing, uploading it creates one profile per row, or it is attached
    to a single profile. Content is accepted in good faith; checking it comes later.
- **Assign** opens a **separate screen**. It lists the Sourcing profiles whose skills match the project's template,
  with the matching skills shown, and (D20, owner 16 Nov 2026) every available person in the platform pool who matches
  the project's criteria: location, domain experience and the template's required skills. Pool people show their match
  per criterion; people at their concurrent-project limit or already on this project are left out. Assigning a pool
  person creates their profile on this project. Each person gets buttons:
  - **Assign as SME**, always;
  - **Assign as Reviewer**, only when the project's route is Author → Reviewer → PM/Admin. A person is never both on
    one project.
  - On Author → PM/Admin there are no reviewers, so only **Assign as SME** shows.
- The PM or an Admin does all assigning. Assigning is the selection: there is no separate screening decision.
- SME places are capped at the project's **Required workers**; when they are full, Assign as SME is not offered and
  the screen says why. Required workers is never lower than the project's task count (D19, owner 16 Nov 2026), and the
  PM or an Admin can raise it on the Assign screen (audited).

## Tasks

- No "Invites" panel and no "Add task inputs" (annotation only). No way to add tasks.
- **Exactly one row per task the project defines.** Columns: Task ID, Task name, Authored by (blank if nobody yet),
  Status, Date (last status change).
- All seven statuses are kept: Open, Assigned, In progress, Submitted, Approved, Rework, Rejected.
- **Every task name opens the task page**, which shows the authored form (the template's sections):
  - Open or Assigned: the same page with empty fields.
  - In progress: the draft, read-only.
  - Submitted: the decision box.
  - Approved, Rework or Rejected: read-only, with the decision.
- **Decision box:** Approve, Rework, Reject. Rework and Reject need a comment for the author.
- **Review route is set at project creation and is read-only** (Author → PM/Admin, or Author → Reviewer → PM/Admin).
  - Only the person whose turn it is gets the buttons; others see "Waiting for …".
  - On the Reviewer route, the Reviewer passes the task to PM/Admin, and only the PM/Admin approval adds it to the dataset.
- **Reviewers (owner, 15 Nov):** the PM or an Admin can assign reviewers only when the project's route has the
  Reviewer step. On Author → PM/Admin, no reviewer can be assigned.
- **Who assigns people (owner, 15 Nov): always the PM or an Admin**, both SMEs (Resource assignments) and Reviewers.
  - Today Admins add Validators; whether a PM can is to be checked when coding.
- **Who gets which task (owner, 15 Nov): always the PM or an Admin**, from the people assigned in Resource assignments.
  - **Author:** in the Tasks table, an unassigned task shows "Assign SME…", listing the project's accepted experts.
    The author can be changed only before they start.
  - **Reviewer** (Reviewer route only): chosen per task on the task page, from the project's Reviewers, and never the
    task's own author.
  - **Change from today:** the system hands out tasks itself when an SME opens the workbench (slot allocation,
    capped by max tasks per expert). That automatic pull is replaced by the PM or Admin choosing. The per-expert cap
    still applies.
- **Export to Anvil (owner, 15 Nov):**
  - It is enabled only when **all** the project's tasks are Approved (5 of 5). It exports them as one batch, after
    validating every task with Anvil.
  - Today the code also allows export when the PM marks the project complete or the end date passes. Both are removed.
    The Praxis–Anvil contract text says the same as today's code, so tell Keystone.
- **Validate with Anvil**, on an approved task's page (PM or Admin):
  - It is available at any time, and checks one task against Anvil's export contract.
  - This exists today (`POST /projects/:id/validate`), and the contract allows it.
  - "Valid" is not approval or Anvil readiness.

## Main menu for MVP1 (owner, 15 Nov)

**Home, Projects, Sourcing, Admin, Tutorials.** Everything else is hidden for MVP1 and comes back, reworked, after it.

- **Reviews** is removed.
  - Task review now happens on the project's Tasks tab.
  - Candidate review moves into **Sourcing** after MVP1.
  - Its other pages are hidden with it: Applications, Task reviews, RL reviews, Identity reviews, Conflicts.
- **Certification** (Guidelines, Certification reviews) is hidden. SME training and certification is linked to the
  project and will be redesigned after MVP1.
- **Partners** and **Payments** are hidden.
- Hiding means removing the menu entries. Coding can do this the same way the M10 pages are already hidden behind the
  `SME_SUPPLY_ENABLED` flag; whether the hidden routes should also refuse direct visits is to be decided.

## Sourcing (its own menu item, owner 15 Nov)

Sourcing moves to the top menu bar (Home, Projects, **Sourcing**, Admin, Tutorials). It is not part of a
project's Resource assignments.

- Only recruitment agencies supply people; a PM or Admin uploads their profiles. There is no direct apply link,
  campaign or public page.
- **SMEs | Reviewers** tabs, a **Search** box, a **New** button, and a table with these columns:
  - First name, Last name, Email, **Role** (SME or Reviewer);
  - **Project**;
  - **Skills**, taken from the project's job description;
  - Submitted by, Date.
- **Search (owner, 15 Nov):** it matches name, email, role, skills or project as you type. It searches SMEs and
  Reviewers together; clearing the box or picking a tab returns to that tab's list.
- **New** opens a **separate screen** (it will grow beyond the MVP):
  - **Project**, a dropdown, required. It lists **only New or active projects, never completed or cancelled**. For
    Reviewers it lists only projects whose review route has a Reviewer step. The project's skills show under it.
  - First name, last name and email (**required**).
  - LinkedIn URL.
  - Profile PDF (up to 10 MB).
  - The recruiter's answers file (Excel or PDF), accepted in good faith. Checking it comes later.
  - A link also accepts the recruiter's Excel sheet for several people at once.
- **Upload** creates the profile in the **SME table**, or the **Reviewer table** on the Reviewers tab, linked to the
  chosen project.
  - The profile is then offered on the project's **Assign** screen if its skills match.
  - The same person submitted twice to one project is flagged, not added.
- The email is the person's Google sign-in to the candidate app, for SMEs and Reviewers alike. QA uses dummy Google
  accounts.

## Policies

Today's Policy rules page: documents and extraction, Suggest rules, rules with Apply to project, Publish rule set.

## Candidate app for MVP1 (owner, 15 Nov)

Mockup: `docs/design/mockups/candidate-screens.html`, dark, following the live QA candidate app.

- **No Opportunities, Payments or Certifications.** Recruiters do the recruiting. The header shows only **Home** and
  **Sign out**.
- **Sign in** follows the Admin mode (Offline: email and name; Online: email and password), using the email the PM
  or Admin uploaded in Sourcing, plus the one-time 18+ confirmation.
  An unknown email gets "No tasks for this account", with no way to apply.
- **Home is the task list.** It shows every task assigned to the person: new ones and ones sent back for rework.
  - Each task has a status: **New**, **Rework**, **In review**, **Accepted** or **Rejected**.
  - A welcome card points at the next thing to do (rework first, then new tasks).
- **Clicking a task opens it:**
  - **New:** authoring starts.
  - **Rework:** the form opens with the reviewer's comment and the section to fix highlighted. The button reads
    "Resubmit for review".
  - **In review, Accepted or Rejected:** read-only, with a line saying why.
- **Tutorial is linked to the task:** a Tutorial button on the task page plays the video for that task's template
  (how to author it), with chapters per section.
- **Help is an AI chat, linked to the task**, opened from a Help button on the task page.
  - It answers questions about **this task and its form only**: what a section needs (for example, what goes in
    S1 · Reusable assignment, with an example), which published rules apply, and how to submit.
  - It gives examples but **never writes the task**: the SME authors it.
  - It **refuses anything outside the task**: "I can only help with this task and its form."
- **A candidate can also be a Reviewer (owner, 15 Nov).** The role comes from how they were assigned on each
  project's Resource assignments: SME or Reviewer. One person can author on one project and review on another, but
  is never both on the same project.
  - **Home** shows **Tasks to review** (To review, Sent back, Approved) next to **Your tasks**, each only if the person
    has any.
  - **Review page:** the authored form, read-only, with a **comment box under each section** (S1, S2, S3–S4, S5,
    S6–S8). Help is available; Tutorial is for authors.
    - **Send back for rework** needs at least one comment. The task returns to the SME as **Rework**, with each
      comment shown under its own section and the section highlighted.
    - **Approve** sends the task to the **PM or Admin**, who accepts it (approved dataset) and exports. The Reviewer
      does not reject; the PM or Admin can.
- **First sign-in (owner, 15 Nov):** a one-time **Before you start** screen. The person accepts the **contributor
  terms** (confidentiality, IP, data use) and confirms **synthetic data only**. Both are required, and the acceptance
  and terms version are recorded and audited. Later sign-ins go straight to Home.
- **No identity check in MVP1 (owner, 15 Nov).** No Stripe identity step.
  - Today's eligibility check requires a verified identity before work can be accepted. With the new flow switched
    on, it must not require it; with the old flow, it keeps requiring it (no breakages).
  - Identity images and ID numbers are still never stored.
- **Change from today:**
  - Removed: the 6-step candidate journey, Your applications, proposals to accept, and the profile chat.
  - Today's Tutorials page (one general video) and support bot (general help) become the task-linked Tutorial and
    the task-scoped Help.

## Admin: candidate app sign-in mode (owner, 15 Nov)

A switch under **Admin → Candidate app sign-in**, applying to every SME and Reviewer at once.

**All existing Admin functions stay unchanged (owner, 15 Nov):** Users (add user, roles, reset password,
deactivate), Taxonomy, Terms, Failure codes and API clients. Candidate app sign-in is a new Admin page next to them;
nothing else in Admin changes.

What the four kept pages do in MVP1 (owner, 15 Nov: keep them):
- **Taxonomy:** the demographic attributes offered in wizard step 4. They feed the project's requirements and the JD PDF.
- **Terms:** the contributor terms accepted on the candidate's first sign-in. **A current version must be published
  before any SME signs in**; the build adds a check for this.
- **Failure codes:** for RL reviews. Not used in MVP1 (the Reviews menu is hidden).
- **API clients:** keys for annotation inputs, RL Gym and Anvil's calls into Praxis. Anvil keys are refused once
  keyless Google identity is set up. The Praxis-to-Anvil export uses an Anvil-issued token held as a server secret.

- **Offline:** sign in with **email and name, no password**. This is today's simulated sign-in.
  - It is unauthenticated: anyone who knows an uploaded email can sign in as that person.
  - So it is allowed only outside production (QA, demos). The server must refuse Offline when `APP_ENV=production`,
    whatever the switch says.
- **Online:** sign in with **email and password**. The username is the person's Gmail address.
  - When a PM or Admin assigns a **new** person to a project, Praxis emails them. This happens only in Online mode.
  - **Decided (owner, 15 Nov):** the email carries a one-time **set-your-password link** (expiring, single use),
    never the password. Passwords never travel in email or chat and are stored only as hashes. Forgot password
    sends the same kind of link.
  - This needs the real email service, which is mocked in tests.
- Changing the mode signs everyone out of the candidate app, and the change is audited.
- **Change from today:** the candidate app has Google sign-in (simulated in QA) and no passwords. The Online mode
  adds password accounts for candidates, which is new code: hashing, reset links, rate limits.

## Pending: Anvil's application-type change (received 15 Nov, not agreed)

Details are in `docs/anvil/ANVIL-KYC-APPLICATION-TYPE-REQUEST.md`. If the change is agreed:

- A new KYC template version (v7, written by Keystone) creates one task per **application type** (Single, Joint,
  Minor, Custodian) instead of one per state. The state becomes an optional example used for coverage.
- The Dashboard **coverage** and task names follow the template's selector: application type for v7, state for v6.
  This replaces "coverage by state" for v7 projects only.
- The export gains a selector block and a compatibility discriminator. It is an additive Praxis change.
- No v6 template, authored task or review history changes.

## Open

- Whether the Reviewer route is enabled in the project wizard (today it may be greyed out).
