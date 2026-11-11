# Wave 2 test notes

For the owner's QA session once Wave 2 is deployed. Everything in `WAVE-1-TEST-NOTES.md` still applies; this adds
what is new. QA runs on live models (Gemini 3.8 Flash until the Claude quota appeal succeeds).

New templates: Adverse media review · Enhanced due diligence · Customer risk rating (agent mode Single; field contracts
marked "requires confirmation").

## 1. Expert → PM review route
1. Create a project with review route **SME → Expert review → PM approval** (now selectable). Assign a Validator.
2. As the SME, submit a task: the header shows **Review pending: Expert review**.
3. As the Expert: return it with a comment pinned to a section or graph node, then after resubmission edit it with a
   reason (try a minor edit, then a material one: material sends it back to the author to reconfirm), then **Pass**.
4. As the PM: the task shows **Approval pending: PM approval**; approve it (or reject it: the PM may reject too). One
   approved record, one earning.
   An Expert edit to the rubric or the reference answer always goes back to the author, even if marked minor.
5. Try a stale approval: after the Expert passes, have the Expert edit again, then approve as PM: refused with a reason.
6. If the same person is Expert and PM, both decisions appear separately in the history.

## 2. Building the workflow (Classic)
Select a step in the graph: add a step, a decision, or a person step after it; add a step that runs alongside (a join
appears); on a decision, add a correction loop back to an earlier step; remove a step. The status line says whether the
workflow passes every check. Chatbot shows the same graph.

## 3. Chatbot (live model)
- Describe a change to the process in your own words (for example "after the recommendation, add a step called
  Screen sanctions lists: check every party against the sanctions lists"). The proposal lists the workflow change in
  plain words; nothing changes until you confirm.
- Ask it to add a step you did not describe: it cannot apply wording you never wrote.
- Its follow-up questions now ask for the next missing required field of the template, and follow the topic of your
  last answer (evidence, policy, rubric…).

## 4. Export
For an approved task of each new template: the task contract envelope, the workflow graph and the project policy
manifest export as in Wave 1, then import into Anvil.
