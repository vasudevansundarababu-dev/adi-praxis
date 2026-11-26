/**
 * Help for console staff (PMs, Admins, Validators) on the pages of the current flow, in plain business English (owner,
 * 26 Nov 2026). Each entry says what it is, why it matters, what you do next, and gives a KYC example. Each paragraph
 * starts with its heading (the text before the first full stop), which the offline bot matches on.
 *
 * Every statement was checked against the console (apps/web) and the API on 26 Nov 2026; see the help-text audit note.
 * Keep it in step when a screen changes.
 */
export const STAFF_CONSOLE_GUIDE = `MENU. The top row has the groups you can use: Home, Projects, Templates, Sourcing, Admin and Tutorials. A group with more than one page shows its pages on a second row. Projects also has "Approved exports" for Admins. You only see the pages your role can use. Validators who are not PMs or Admins see the earlier menu, with Reviews (Applications, Task reviews, RL reviews, Identity reviews, Conflicts).

ROLES. Reviewer, Validator, PM and Admin are different roles. Admin can do everything: create and prepare projects, assign people, approve tasks, export, and manage users. A PM (project manager) creates and runs their own projects and approves tasks on them. A Validator is a console user who reviews in the earlier flow. A Reviewer is not a Validator: a Reviewer is an SME you assign to check other SMEs' tasks, and they work in the SME app, not the console. People make every decision; the AI only suggests and checks. You cannot remove your own Admin role.

HOME. Home shows tiles for what is waiting for you, by role: tasks to review or approve, projects being staffed or in progress, and benchmark results waiting for a decision. Press a tile to go there. "New project" starts a project. If nothing is waiting, Home says so. Example: the tile "Benchmark review: KYC teen accounts" means the benchmark sent back results for a person to check.

THE BELL. The bell at the top (PMs and Admins) lists what is waiting for you: tasks to review or approve, results that need a reviewer assigned, edge-case outcomes to send or check, tasks held waiting for a new kind of case, and SME needs to handle. Each item opens the right project tab. An item disappears when the work is done.

PROJECTS LIST. Projects lists the projects you own (Admins see all). Search by name, workflow or topic, and open a project. Statuses: Draft, Ready for staffing, Staffing, Staffed, In progress, Paused, Completed, Cancelled.

CREATING A NEW PROJECT. To create a new project, press "New project". It walks you through six steps: Template, Basics, Volume, diversity and TPT, Demographics, Job description, and Review and submit. Pick a published template. In Basics choose how SMEs write (Classic form, Chatbot, or Both) and the review route: SME → PM approval, or SME → Expert review → PM approval. Set how many distinct tasks you need and the most tasks per expert. TPT (time per task) is a planning and pay target, not a deadline. The job description is generated from the template; you set the pay per task, and you cannot submit without it. Save as draft any time; Submit project freezes the template, job description and filters. Example: a KYC onboarding project with 20 distinct tasks, at most 3 per expert, 60 minutes TPT, route SME → Expert review → PM approval.

PROJECT PAGE. A submitted project has five tabs: Dashboard, Resource assignments, Tasks, Policies and Benchmark. At the top you can pause a project in progress (SMEs keep their saved work) and resume it, or cancel a project that is still a draft, ready for staffing, staffing, or paused. Cancelling is final.

DASHBOARD TAB. The Dashboard shows the project at a glance: experts assigned, tasks approved, the rule set, and the rework rate. The "Next step" banner says what to do now, for example "TSK-003 is waiting for your decision" or "2 more experts are needed". The coverage table shows which slots have an approved task. Project details show the review route and who reviews; they were fixed when the project was submitted.

RESOURCE ASSIGNMENTS TAB. This tab lists everyone on the project: SMEs who write and Reviewers who check, with their task and its status. Press "Assign" to add people, or "Export to Recruiter" for a spreadsheet. Each person sees their tasks, including any sent back for rework, when they sign in to the SME app.

ASSIGNING PEOPLE. On the Assign screen, search for people from this project's sourcing profiles and the platform pool, choose a task, and press "Assign as SME" (to write it) or "Assign as Reviewer" (to check one already written). A Reviewer never reviews their own task, and a person is never both on one project. If the SME places are full, raise "Required workers" first. Example: assign Ana as SME on TSK-004 and Ravi as Reviewer on TSK-002.

TASKS TAB. The Tasks tab has one row per task: its author, status and what to do. Statuses: Open (no author yet), Assigned, In progress, Submitted, Rework, Approved, Rejected. On an Open task use "Assign SME". You can change the author only before they start. Open a task to read it and decide.

VALIDATE AND EXPORT (Tasks tab). Tick approved tasks and press "Validate" to check them against the benchmark's requirements in one go. Until RL Gym's own check is connected, ADI Forge checks them itself, and the panel says so. Each shows valid, needs fixing (with who should fix it: the author, the PM, the template, support or the benchmark) or not validated. Validate changes nothing. You can export to RL Gym once every task in the project is approved: "Export to RL Gym" then opens; it always sends every approved task and gives you a file to download. RL Gym is the benchmark platform that tests AI agents on your tasks.

THE TASK PAGE. Here a PM or Admin reads one task and decides. The top shows its status and author. The Checks panel shows the task's archetype, complexity and edge-case focus. The Review card shows the route (Author → Reviewer → PM/Admin, or Author → PM/Admin) and where the task is now. On the two-step route the Reviewer checks first; the decision box opens for you once the Reviewer passes it. Why you cannot decide on a task: it is still with the Reviewer, it is not submitted yet, or you wrote it or declared a conflict with its author.

DECIDING ON A TASK. In "Your decision (final)" choose Approve, Rework or Reject. Approve adds the task to the approved dataset. Rework returns it to the author with your comments. Reject is final, with a reason (duplicate, not realistic, incorrect, or contains real data). Rework and Reject need comments for the author, each under one section. To approve, every checklist item must hold: realistic, correct, covers the slot's edge case, fair difficulty, distinct, and the rubric would catch the listed failures. Example comment on S6: "The outcome should be request information, not approve: the minor's taxpayer ID is missing."

CORRECTING AN APPROVED TASK. For a small fix you can make yourself, use "Correct this approved task". Choose the field, type the corrected value and say what you corrected and why. Every check runs on the corrected task first; if one fails, nothing changes. Saving approves the correction as a new revision; the earlier approved version is kept, and the next re-export sends the correction to the benchmark. Example: fix a typo in an evidence date.

SENDING AN APPROVED TASK BACK. If an approved task needs the author's work, use "Send back for rework" and say what the author must fix. The author sees it in their bell and on the task. The approved version stays in the dataset as it is, and is not sent to the benchmark while the task is in rework. When you approve the new version, it replaces this one.

BENCHMARK TAB. The Benchmark tab is where the project meets the benchmark that tests AI agents. "Export for benchmark" (or "Re-export") sends the tasks approved so far; RL Gym recognises unchanged tasks, and corrected tasks replace their earlier version. "Held tasks" wait for a new kind of case from Studio (the tool that builds templates and practice cases); after 3 days the bell asks you to chase Studio or release the task. "Validate with Studio" asks whether the benchmark can run this project's edge cases: Supported, Needs data, or Needs an environment change.

EDGE-CASE OUTCOMES (Benchmark tab). Each edge-case variant needs an expected outcome from a person before its practice cases count. Send the waiting ones in one batch to an SME on the project, or answer them yourself (the option reads "I answer as Admin, for an SME"; PMs can use it too). You can ask for a second check by another person. The batch shows Being answered, Waiting for the second check, Written to Studio, or "Studio did not take it: send again". Why it matters: these answers become the results the benchmark scores against. Example: confirm that "minor with no taxpayer ID" should end in "request information".

SME NEEDS (Benchmark tab). SMEs raise new edge cases, families, variants and data needs from their tasks. For each, merge duplicates, send it to Studio with a short summary, or reject it with a reason.

BENCHMARK REVIEW (Benchmark tab). When the benchmark sends back results ("episodes") for review, assign each task to the SME who wrote it or to an SME Reviewer; they decide in the SME app. A PM or Admin can also decide here. Verdicts: Accept (the agent really failed), Dispute (the task, rubric, scoring or test set-up is wrong) or Can't assess, always with reasons. "Dispute: the task needs correction" sends the task back to rework; the corrected version goes in the next re-export. A decision is final.

POLICIES TAB (other projects). For projects that are not policy-library projects, the Policies tab holds the project's rules. Upload or paste policy documents, press "Extract candidates" to draft rules, then tick "Apply to project" on each rule you have checked against its source: the tick is your review. Then "Publish rule set": every task in the project uses the published set. A warning such as "Quote not found in the document" means check the quote before you tick. For policy-library projects (such as KYC Judgment) the tab opens the Policy rules page instead.

SEARCHING RULES. On the Rules table, "Search rule name" finds rules whose title or rule key contains every word you type, within the chosen document; press Search or Enter. In the review queue, Search narrows the list as you type, by rule key or title. Neither search fixes typos or matches by meaning.

TEMPLATES. Templates lists the workflow templates by domain. You cannot change a template in ADI Forge: templates are made and changed only in Studio; ADI Forge shows each released version. Admins can publish a released version (so new projects can use it) or retire it (new projects can no longer choose it). PMs see published templates and can create a project from one. Projects keep the template version they were created from.

USERS (Admin). Add staff with their roles, edit roles, reset a password or disable access. A new user gets a temporary password: copy it then, because it is not shown again, and pass it on safely. A reset signs the person out everywhere. On first sign-in they choose their own password (at least 12 characters).

CANDIDATE APP SIGN-IN (Admin). This page sets how SMEs and Reviewers sign in to the SME app, for everyone at once. Online: they sign in with their email and a password, set through a one-time link. Offline is for testing and demos only, never production: anyone who knows an uploaded email can sign in as that person, and production refuses it. "New flow" on means direct assignment to tasks, the five-tab project page and the shorter menu. Changing the sign-in mode signs everyone out of the SME app.

APPROVED EXPORTS (Admin). Approved exports lists every approved task record, with downloads of each task and of the whole dataset. Approved records are never changed or deleted.

SIGNING IN. Staff sign in at the console with email and password. After too many attempts, wait a minute. To change your password, use "Change password"; your other sessions are signed out when you save.

TUTORIALS. Tutorials has the user guide (PDF) and short videos for your role. Some videos still show the earlier flow (applications, requisitions, pay runs).`;
