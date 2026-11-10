# Classic, Chatbot and Both - local implementation handoff

## Delivered behaviour
PM/Admin chooses Classic, Chatbot or Both in project creation. The setting is shown in project review/summary and restored when editing a draft. An API request creating an authoring project without the choice is refused. Existing projects retain NULL configuration, interpreted as historical Both access; ordinary edits do not silently enrol them in new controls. Submitted projects cannot be changed, and configuration changes after task assignment are refused.

The candidate workbench obeys the project. Both exposes two tabs; a single-view project exposes only its permitted editor. Direct Classic saves and chat messages are checked server-side, so an alternate URL is not a bypass. Mode preference and unsent chat text are task-owned metadata, saved without changing the task's structured output or revision.

Classic and Chatbot share TaskInstance.output, revision, evidence, policy links, expected solution, rubric, check service and submission process. Switching flushes Classic autosave first, waits for acknowledgement and reloads the current record; failures keep the SME in the original view. Chat changes remain proposals until confirmed. Conflicting revisions cannot overwrite newer data.

Configured projects require common human-authorship consent before editing; generative draft/redraft endpoints are disabled. Both editors retain text-entry boundaries, template instruction PDFs, investigation map and server-filtered agent preview. The common check/submit panel records own-work/no-external-LLM/source-authority declarations for the exact saved revision. Changing output invalidates the declaration. Unresolved questions, pending proposals, policy-version changes and normal task checks remain blockers. Manual clarification answers are audited, not treated as a model-generated solution.

Annotation remains on its existing path. Existing null-config projects retain legacy controls; new configured projects use the new human-only rules. Expert/PM approval-role redesign is separate: local tests use existing authorised Admin final review, not fabricated two-stage acceptance.

## Material changes to existing behaviour
- New authoring-project API callers must supply authoringExperience; UI, internal demo setup and maintained fixtures were updated.
- Newly configured Classic-only projects deny conversation messages; Chatbot-only projects deny direct Classic saves. Both retains access to both.
- Human-only consent/declaration is now common; Classic cannot bypass it. No AI detector is treated as proof of authorship.
- Existing projects are preserved; converting an active project requires separately designed migration, not a hidden mode toggle.
- The paused-project restriction also covers conversation mutations.

## Validation boundary
Provider output in tests is controlled; no live MaaS calls. Tested stages include project setting persistence, all three API restrictions, common consent, task ownership, preference resume without output mutation, Classic-to-chat draft retention and shared changes, agent-preview privacy, phone read-only, submit/rework/resubmit, immutable accepted record and dataset export. Missing executable Anvil contract still returns an explicit 409 rather than success.

Read final counts and logs in VALIDATION-REPORT.md. The product builds and type checks are local evidence, not staging deployment, independent QA, provider quality or full cloud qualification.

## Final validation receipts
Full API regression: 724 pass / 5 gated skips in 54 files. Added Classic-only lifecycle: focused conversation suite 20 pass, including the new no-model-run acceptance/export case. Candidate 23, console 55, shared 192 and MCP replay 2 pass. Workspace type checks and both production builds pass. Actual PM + SME Chrome journey passed in the full API run.
