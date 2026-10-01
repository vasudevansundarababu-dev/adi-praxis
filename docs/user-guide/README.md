# ADI Praxis user guide

ADI Praxis (by ADI-Labs) is where subject-matter experts (SMEs) write realistic, fully synthetic tasks from real
workflows, for example Banking / KYC onboarding. People check every task, and accepted tasks go into the **Approved
Task Dataset**, which the separate RL Gym platform uses to train and test AI agents.

This guide is for everyone who uses ADI Praxis: ADI-Labs staff in the console, staffing partners in the partner
portal, and the experts themselves in the candidate app. It describes **release 1.1** (test build
`test-1.1-20260930`). Words in **bold** or "quotes" are exactly what you see on the screen.

## Chapters

| Chapter | Read it if you are… |
| --- | --- |
| [1. Getting started](01-getting-started.md) | Everyone: the three apps, signing in, the menu, the Help button, common messages |
| [2. Admin](02-admin.md) | An Admin: templates, guidelines and courses, partners, users, terms, keys |
| [3. Program Manager (PM)](03-pm.md) | A PM: projects, opportunity pages, staffing, requisitions, progress, pay-run confirmation |
| [4. Validator](04-validator.md) | A Validator: deciding applications, reviewing tasks, RL reviews, certification reviews |
| [5. Finance](05-finance.md) | Finance: rate cards, earnings and holds, pay runs, reconciliation, partner statements |
| [6. Staffing partner](06-partner.md) | A partner user: requisitions, putting candidates forward, tracking them, statements, API |
| [7. Expert (SME)](07-sme.md) | An expert: applying, identity, profile, onboarding, certification, writing KYC tasks, payments |
| [Roles, user IDs and admin functions](ROLES-AND-ADMIN.md) | Who can do what, demo accounts, every Admin function |
| [8. Troubleshooting and FAQ](08-troubleshooting.md) | Something did not work |
| [Demo videos](VIDEOS.md) | A guided tour, one video per role |

A PDF of the whole guide is built with `node docs/user-guide/build-pdf.mjs` (see [VIDEOS.md](VIDEOS.md) for the
videos).

## The big picture

```
 Admin                    PM                       Expert (SME)                Validator               RL Gym
 ─────                    ──                       ────────────                ─────────               ──────
 publishes a     ──►  creates a project     ──►  applies, verifies     ──►  selects the expert
 workflow             from the template,         identity, builds a          (a person, never AI)
 template             publishes the              profile
                      opportunity page
 uploads           ──► opens a requisition  ──►  (or a partner puts      ──►  confirms grades,
 guidelines;           with guidelines            them forward) takes the     decides certification
 approves the          and a rate card            course and test
 course and test
                       staffs the project   ──►  accepts the assignment,
                                                  onboards, writes a     ──►  accepts, asks for   ──►  dataset record
                                                  KYC task (by hand or        rework or rejects        (append-only)
                                                  drafted by AI)              the task
                                                                              judges RL Gym
 Finance: weekly pay run ◄── each accepted task earns from the rate card     results  ◄───────────── RL results
```

## Rules that hold everywhere

- **A person makes every decision.** AI recommends and drafts; it never selects, rejects, grades, certifies or accepts
  a task on its own.
- **Synthetic data only.** Tasks never contain real customers, colleagues, employers or documents. The platform scans
  for real-looking identifiers and asks the author to explain or replace them.
- **No identity documents are kept.** The identity check is done by the provider (Stripe Identity); ADI Praxis keeps
  only the result, never document images, ID numbers or date of birth.
- **The dataset never changes.** Accepted tasks and RL verdicts are append-only; a correction is a new record.
- **Everything is recorded.** Every change is written to the audit log with who did it and when.

## Glossary

| Word | Meaning |
| --- | --- |
| **SME / expert / candidate** | A subject-matter expert. "Candidate" before they are selected |
| **Workflow template** | The definition of a kind of task (for example "KYC onboarding and refresh"): sections, coverage, checks, human gate. Admins publish it; projects use a frozen version |
| **Project** | A PM's piece of work using one template: how many distinct tasks, by when, by whom |
| **Opportunity page** | The public page candidates read before applying to a project's pool |
| **Pool** | The candidates selected for a project's opportunity |
| **Requisition** | A role a project needs filled through partners or the careers page, for one tier, with headcount, requirements, guidelines and pay |
| **Tier** | The SME level for certification: **Expert**, **Reviewer**, **Annotator**. ("Reviewer" on a screen means this tier) |
| **Validator** | The internal console role that makes human decisions (called `REVIEWER` in the code) |
| **Guidelines package** | The domain rules an Admin uploads; Claude drafts a knowledge map, a course and a test per tier from them |
| **Coverage / slot** | The matrix of case types and edge cases a project must cover; each task fills a slot so tasks stay diverse |
| **TPT** | Time per task: a planning and pay target in minutes, never a deadline |
| **W00–W06** | The sections of the KYC task workbench, from "How do you want to start?" to "Check and submit" |
| **Recorded tool call (MCP)** | A tool response the author writes so RL Gym can replay the task exactly |
| **Human gate** | The decisions an AI agent must hand to a person (for KYC: approve, reject, high risk) |
| **Approved Task Dataset** | The append-only store of accepted tasks that RL Gym reads |
| **Rate card** | What an SME earns per accepted task; versioned and never edited |
| **Pay run** | The weekly batch of payouts: built, confirmed by a PM, approved and submitted by Finance |
