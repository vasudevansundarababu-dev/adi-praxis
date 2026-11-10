# Validation report — local approval revision

Date: 10 November 2026. Checkout: isolated local `feat/conversational-case-authoring`, based on `a4b4cbc384ce09beafd3cbb238e92a0d11a9dbc5`. No remote push, deployment, paid model call or live payment.

## Current evidence
- Workspace TypeScript checks passed after the human-authorship and reviewer-provenance changes. Log: `/private/tmp/praxis-final-typecheck.txt`.
- Existing drafting/provenance regression suite: 12 passed after the controls changes. Log: `/private/tmp/praxis-final-legacy.txt`. Together with the current focused controls, 33 tests passed.
- Current focused controls: 21 passed across authorship controls (5), conversation integration (15), and actual Chrome/API journey (1). Log: `/private/tmp/praxis-final-controls.txt`.
- Conversation integration includes all 12 template names and existing submit → Admin rework → resubmit → acceptance → immutable record/hash chain → dataset export. Provider is controlled test output, not live Claude/OpenAI.
- Browser journey checks consent, typed source extraction, confirmation, persisted case/map, reload, agent-preview exclusions, phone read-only and retained detailed editor. A browser paste event is prevented. This does not prove prevention of external authorship.
- Final approval mockup interactions passed: consent, confirm, single/multi switch, role expansion, role-specific preview. No browser JavaScript errors. Desktop multi view visually inspected. Mockup is synthetic local behaviour, separate from application tests.

## Earlier broad baseline
Before the newest human-only control changes, full API suite passed 715 tests with 5 explicitly gated Docker tests skipped. Shared 192, web 55, candidate 23 and MCP replay 2 also passed: 987 passes in that earlier snapshot. Production candidate build passed at that snapshot. These counts are not relabelled as a full rerun of the final revision.

## Material gaps and changed behaviour
1. Authoring opens chat by default; detailed editor remains `?editor=form`. Annotation is unchanged. Enrolled human-only tasks disable legacy AI drafting; older generated content is not automatically declared human-authored.
2. Current project policy access is PM/Admin. SME task-source uploads are not published policies. Candidate proposal/review bridge and semantic document qualification remain gaps.
3. Existing final review role is Reviewer/Admin, not ordinary PM. A two-stage expert Reviewer → PM process is not implemented. Demo uses Admin final acceptance.
4. Executable Anvil export needs `output.praxisContract`. A valid accepted dataset record without this contract correctly returns 409 `NO_EXECUTABLE_CONTRACT`. Dataset export is not Anvil execution acceptance.
5. Multi-agent graph is design-only. Runtime scheduling, role isolation and executable adapters have not been qualified.
6. Shared conversation plumbing across templates does not establish domain-specific semantic correctness for every workflow. KYC has its existing deterministic checks; other domains require their own acceptance.
7. Current bounded context is not vector RAG. OpenAI integration, live model quality, long-policy retrieval, adversarial model evaluation and production operation remain separate work.
8. Similarity signals, declarations and typing restrictions cannot prove no external LLM use. No detector-based automatic misconduct or payout decision is implemented.

Approval requested: UX, facilitator restrictions and scoped design. End-to-end local application evidence uses synthetic data and controlled provider responses, not independent QA or production acceptance.

## UI and instructions revision 1.2
- Replaced the approval mockup with four previews: assigned single-agent SME, assigned multi-agent SME, expert review and PM approval. Template mode is read-only. No human-review graph node.
- Verified mockup at 1024, 736, 390 and 320px without horizontal overflow; section counter, PDF help and review views work without browser script errors. Desktop single/multi screens visually inspected.
- Added template PDF links and field explanations to the local candidate and reviewer components. Conversation layout reflows at narrower widths, and the current investigation-step count is visible. Agent mode and two-stage permissions remain explicit integration work.
- Workspace type checks passed. Existing candidate tests: 23 passed; reviewer/web tests: 55 passed. The wording-control test initially used the wrong default database configuration; rerun with the isolated test configuration passed 5 tests.
- Fourteen template guides: 3 pages each (authoring expectations; field meanings and actions; expert review/PM approval). Combined 42-page PDF parsed and rendered, all pages inspected in contact sheets. Each template also has editable Markdown and its own PDF. Help for a template does not imply its executable runtime is implemented.
- No paid model calls, remote push or deployment.

## Authoring experience mockup revision 1.3
Local Chrome checks passed for Classic/Chatbot/Both configuration, retention of unsaved Classic evidence while switching to Chatbot, confirmed chat wording visible back in Classic, hidden alternate tabs for single-view projects, and no horizontal overflow at 1024/736/390/320px. Project and Both workspace screenshots were visually inspected; no browser script errors. These are mockup interaction checks, not production configuration/API validation. No application code or deployment was changed for this revision.

## Project experience implementation - final local checks
- Additive PostgreSQL enum/nullable-column migration applied only to the isolated test database; existing NULL projects preserve legacy Both access. New authoring creation requires an explicit mode.
- Full API suite: 724 passed, 5 explicitly gated Docker tests skipped, 54 files passed. Log `/private/tmp/praxis-mode-final-api.txt`. Earlier full run found an internal demo-setup caller missing the now-required choice; fixed the caller and reran successfully.
- Actual Chrome journey includes all three PM project-creation choices, save/readback/reload, required-choice error, SME consent, typed answer retention across switching, Classic field save seen by chat, proposal confirmation, case/map/rubric persistence, filtered agent preview and phone read-only.
- Existing candidate 23, console 55, shared 192 and MCP replay 2 tests pass. Workspace type checks and both candidate/console production builds pass. Tests use controlled model output; no paid provider call, deployment, push or live payout.
- Existing SQL lifecycle passes submit → Admin rework → chat with actual feedback → resubmit → human acceptance → immutable accepted record/hash chain → dataset export. Missing executable Anvil contract still returns 409.
- Separate added Classic-only lifecycle verifies shared own-work/revision controls, human acceptance and export with zero TaskDraftRun records. Its prepared synthetic fixture represents SME-entered fields, not a real human-authorship proof. Final result is recorded in the implementation handoff.
- Two test runner processes were briefly started against the same isolated database during development; that attempt was discarded. Reported successful runs were serial against the shared test database.
- Full independent QA/staging acceptance, live MaaS model qualification, two-stage Expert→PM approvals and authentic cloud benchmarking remain separate gaps.

Additional final Classic-only lifecycle: focused conversation suite 20/20 passes, including one new test beyond the preceding full 724-test API run. Log `/private/tmp/praxis-mode-classic-lifecycle.txt`. This is reported separately rather than relabelling the earlier full run as 725.
