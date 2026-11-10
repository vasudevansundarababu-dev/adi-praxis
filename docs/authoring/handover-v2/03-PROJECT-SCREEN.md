# 03 Project creation: field-by-field specification

PM/Admin prepares the project before any SME authors tasks. Reuse current project, template, JD, policy and staffing services. Add only missing configuration/permissions and renderers.

| Field/control | Meaning and what the user does | Validation / help |
|---|---|---|
| Project name | Give the assignment a clear business name. | Required. Example: Customer onboarding benchmark, November set. |
| Domain and published template | Choose the task family and exact published version. | Required; unpublishable/draft versions cannot silently become assignments. |
| Agent type | Read the template-defined Single or Multi value. | Display-only here after selecting the template; never repeated as an SME mode choice. |
| Authoring experience | Choose Classic, Chatbot or Both. | Required for new authoring projects. Both uses one task, not two authoring submissions. |
| Review route | Choose SME -> PM or SME -> Expert -> PM in target design. | New workflow configuration; current one-stage permissions are not sufficient evidence of implementation. Demo uses authorised Admin final acceptance. |
| Task target | Specify accepted tasks required, not raw submissions. | Positive validated count. Rework does not increase it. |
| Coverage dimensions and quotas | Specify customer types, risks, locales, edge cases and required coverage. | Sum/target rules and available slots must reconcile. A reached count with missing coverage is not necessarily complete. |
| Maximum per SME | Limit assigned workload and concentration. | Must fit project target and staffing policy; respect existing assignment checks. |
| Start/end dates | Define assignment window and project deadline. | End after start; timezone shown. Agree rework grace separately; never imply that existing task autosave expires at the end date. |
| Time target | Set expected effort per task. | Planning/pay input, not an automatic timeout on the author. |
| Project policies | Add authoritative base documents and review their extracted rules. | Project scope; only published versions are active. Show gaps before project readiness. |
| Bank/customer category | Label the document's stated authority and scope. | A label does not establish authenticity. A customer document does not override bank policy by default. |
| SME job description | Attach an existing JD or prepare one from template skills. | Existing JD CRUD can be reused. Automated JD generation is proposed, not proven by current code. PM reviews generated wording if added. |
| Required skills/jurisdiction/language | Define qualifications used by matching. | Reuse eligibility and staffing gates. Distinguish hard constraints from preferences. |
| Rate/currency and payment terms | Set authorised compensation terms. | Reuse approved rate cards, pay routes and eligibility. Do not promise a payout merely because a chatbot is complete. |
| Matched SME list | Inspect qualified candidates and assignment rationale. | PM/Admin assigns; chatbot cannot recruit, assign or bypass identity/onboarding requirements. |
| Expert reviewers | Assign qualified industry experts when route requires them. | Target extension; authorised access only to assigned project/tasks/documents. |
| Final approver | Assign authorised PM/Admin responsibility. | Current API role restrictions must be explicitly extended and tested before PM approval is promised. |
| Create/save/submit project | Review configuration, then create and staff it. | Required fields, policy readiness and staffing constraints shown with actionable errors. |

## Project configuration lifecycle

Persist authoringExperience on the Project; the local implementation uses nullable CLASSIC/CHATBOT/BOTH. Legacy NULL retains previous Both access without silently enrolling existing tasks into new declarations. Ordinary legacy edits must not force a migration. Mode changes after task assignment are blocked in the local slice; an active-project migration needs a separate preview, authority, compatibility and rollback plan.

The template should declare a versioned authoring UI profile and export capability. Do not mutate a published template's shape under active tasks. Project creation pins template version, instruction version, review route and policy baseline. Every submission records what was actually used.

## PM help example

“Choose how SMEs will author. Classic provides guided fields. Chatbot asks questions and organises the SME's own words. Both allows switching on the same task. This setting does not choose how many agents execute the benchmark.”
