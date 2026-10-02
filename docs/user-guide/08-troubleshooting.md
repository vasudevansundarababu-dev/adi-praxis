# 8. Troubleshooting and FAQ

| Problem | Why | What to do |
| --- | --- | --- |
| "No access — This page is for …" | Your role may not use that page | Use the menu; ask an Admin for the role if you need it |
| A second tab signed me out or switched user | One browser holds one sign-in | Use a separate browser profile or private window per role |
| "Too many attempts. Wait a minute and try again." | Sign-in limit | Wait a minute |
| "Choose your own password" appears after sign-in | You signed in with a temporary password | Enter it and choose a new one (12+ characters); nothing else opens until you do |
| I forgot my password (console or partner portal) | | Ask an Admin to **Reset password**; you get a new temporary password |
| "SME supply is not switched on" | Partners, certification and payments are off in this environment | Ask the platform team |
| The Support Bot says it is not available | Claude quota or outage in the test environment | Report it once as `[Environment] Claude unavailable …` |
| Guideline generation ends **Failed** | Same as above | Use **Regenerate** later |
| PM: "No published templates yet" | An Admin has not published a template | Ask an Admin |
| PM: I can't see a project | PMs see only projects they own | Ask the owner or an Admin |
| Validator: an application or task is missing from my queue | You are not assigned to its project, you wrote it, or you declared a conflict | Ask the PM to add you as a Validator |
| Validator: **Accept** is disabled | Every checklist item must be Yes | Answer the checklist, or choose Request rework |
| Finance: I can't approve the pay run | It is not confirmed yet, or it pays you | Wait for a PM; another Finance user approves |
| SME: **Confirm and submit** is disabled | Something is unconfirmed, a required box is unticked, or identity is not verified | Read **Before you submit** |
| SME: **Get next task** is disabled | The project is paused, you have 3 open tasks, or you reached the project limit | Finish an open task |
| SME: "Changed in another window: reload to continue" | The task is open in two tabs | Reload and keep one tab |
| SME: "Offline: your changes are kept here…" | Network dropped | Keep working; it saves when you reconnect |
| SME: I can't edit the workbench on my phone | The workbench is read-only on small screens | Use a laptop |
| SME: an upload is refused | Wrong type, over 10 MB, no readable text (a scanned image), or more than 5 files | Use PDF, Word, text or captions; split large files |
| Partner: **Submit a candidate** is missing | The requisition is not open, the deadline passed, or you reached the limit | Check the requisition |
| Partner: the candidate got no invite email (test) | Email is simulated in test | Use the "Test environment: invite link" box |

**How do I get a console account?** An Admin adds you under **Admin → Users** and passes you a temporary password;
you choose your own at first sign-in.

**Can AI reject me or my task?** No. AI recommends; a Validator decides every selection, grade, certification and task.

**Where do accepted tasks go?** Into the append-only Approved Task Dataset, which RL Gym reads. They never change; a
correction is a new record.

**Is my identity document stored?** No. Only the result of the check is kept.
