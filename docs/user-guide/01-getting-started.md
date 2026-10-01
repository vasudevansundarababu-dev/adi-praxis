# 1. Getting started

## 1.1 The three apps

| App | Who uses it | Test environment address |
| --- | --- | --- |
| **Console** | Admin, PM, Validator, Finance | https://praxis-web-742785092638.us-central1.run.app |
| **Partner portal** (part of the console site) | Staffing partner users | https://praxis-web-742785092638.us-central1.run.app/partner/login |
| **Candidate app** | Experts (SMEs) and the public careers page | https://praxis-candidate-742785092638.us-central1.run.app |

The demo environment has the same apps at `praxis-web-744400601364…` and `praxis-candidate-744400601364…`. Demo user
IDs are listed in [Roles, user IDs and admin functions](ROLES-AND-ADMIN.md#2-demo-and-test-user-ids).

In the test and demo environments a **yellow banner** at the top says the data is synthetic and that candidate sign-in
and identity checks are simulated, followed by the build (for example `Build test-1.1-20260930`). Always include the
build when you report a problem.

## 1.2 Sign in to the console

1. Open the console. You see **"Sign in to the console"**.
2. Enter **Email** and **Password** and select **Sign in**.
3. You land on **Home**, which shows "Welcome, *your name*" and tiles with what is waiting for you, for example
   "Applications to decide" or "Pay runs waiting for you". Select **Open →** on a tile to go straight there.

| Message | What it means |
| --- | --- |
| "Too many attempts. Wait a minute and try again." | Sign-in is limited to 10 attempts a minute |
| "Sign-in failed" or the server's reason | Wrong email or password, or the account is disabled |
| "Could not reach the server. Check your connection and try again." | Network problem |

Your session lasts 12 hours. Select **Sign out** (top right) when you finish. **Dark theme / Light theme** switches
colours.

> **One browser holds one sign-in.** Signing in as another user in a second tab switches the first tab too. To work
> as two roles at once (for example PM and Validator), use a separate browser profile or a private window for each.

## 1.3 The menu

The console menu has two rows. The **top row** shows groups: Home, Projects, Reviews, Certification, Partners,
Payments, Admin. Select a group to open its first page; the **second row** shows that group's pages. You only see
groups your role may use (see [the table](ROLES-AND-ADMIN.md#3-what-each-role-can-open-console-menu)).

If you open a page you may not use, you see **"No access — This page is for …"** and **Go to your home page**. If
SME supply is switched off in an environment, partner, certification and payment pages say **"SME supply is not
switched on"**.

## 1.4 Forms

- A red **\*** marks a required field. Each form starts with "Fields marked * are required."
- Errors appear next to the field or in a box at the top listing what to fix.
- Most changes ask for confirmation when they are final (for example "Cancelling is final. Cancel this project?").

## 1.5 The Help button (Support Bot)

Every console and partner-portal page has a **Help** button at the bottom right.

1. Select **Help**. The **Support Bot** panel opens.
2. Choose a suggestion — "What do I need to fill in on this screen?", "What happens after I submit this?", "Why can't
   I do this step yet?" — or type a question and select **Ask** (or press Enter).
3. Close with **✕** or Escape.

The Support Bot sees only what you can see on the screen and explains fields, required items and next steps. **It
cannot change anything or make decisions.** Do not type passwords or personal data. If you ask too many questions in
a minute it asks you to wait. In the test environment it is answered by Claude; if Claude is unavailable it says "The
Support Bot is not available right now".

The candidate app has no Help button.

## 1.6 Tutorials (videos and this guide)

Every app has a **Tutorials** page with short captioned videos and this guide as a PDF.

| App | Where | What you get |
| --- | --- | --- |
| Console | **Tutorials** on the top row of the menu | "For your role" first (Getting started and your role's video), then the other roles; the full user guide |
| Partner portal | **Tutorials** in the portal menu | The staffing partner video and the partner guide |
| Candidate app | **Tutorials** in the top navigation (also when signed out) | The expert video and the expert guide |

Console and partner tutorials need a sign-in; the candidate app's are public so people can see the work before applying.

## 1.7 Status labels you will see often

| Area | Labels |
| --- | --- |
| Project | Draft, Ready for staffing, Staffing, Staffed, In progress, Paused, Completed, Cancelled |
| Application | Draft, Submitted · assessing, Awaiting decision, More information requested, Selected, Not selected, Review requested, Withdrawn |
| Task | Queued, Assigned/Not started, In progress, In review (Submitted · awaiting review), Rework (Changes requested), Accepted, Rejected (Not accepted) |
| Requisition | Draft, Open, Paused, Filled, Closed |
| Certification | Not started, Course in progress, Ready for the test, Test in progress, Certified, Retake available, With a person for review, Not certified, Expired |
| Pay run | Draft → Confirmed → Approved → Submitted → Completed (or Cancelled) |

## 1.8 Reporting a problem (testers)

Follow [docs/testing/README.md](../testing/README.md): one problem per report, the build from the banner, the user ID
(never the password), steps, what you expected and what you saw, and a screenshot.
