# Project authoring experience - revision 1.3

Status: implemented in the isolated local Praxis feature branch; not deployed. Project persistence, editor enforcement, shared-record switching and human-authorship parity are implemented and locally tested. The interactive mockup remains a separate design preview. It supersedes earlier assumptions that every project opens chat by default or always exposes `?editor=form`.

## Project creation
PM/Admin must choose **Authoring experience** before project creation completes:

| Stored value | Display name | SME view |
|---|---|---|
| CLASSIC | Classic | Guided structured fields only |
| CHATBOT | Chatbot | Conversation-led authoring only |
| BOTH | Both | Classic and Chatbot tabs over the same task |

Use one required choice, with no silently selected production default. The mockup starts with Both selected solely to demonstrate switching. Put this choice alongside template and authoring settings in project creation, not inside template agent-mode configuration. Show a short SME preview before saving.

The selected template version separately defines **Single Agent / Multi Agent**. Neither author nor reviewer may change that property. All three authoring experiences may be used with either supported agent type. UI availability does not establish multi-agent execution readiness.

## Shared task and draft behaviour
- One task ID, canonical structured output, reference solution, evidence inventory, rule links, rubric and revision stream. Do not make separate Classic and Chatbot task copies.
- A shared draft layer retains unsaved field edits, typed chat input and current section across switching. Distinguish saved revision from unsaved draft. A switch is not a submission or approval and must not fabricate a revision.
- Classic edits update the shared draft. Chat reads that draft/current revision and proposes patches; it cannot invent substantive answers. SME confirms or discards proposals.
- Use one save/validation service for confirmed changes. Apply optimistic revision checks and policy-version checks. Pending proposals become stale after conflicting changes in either view; show the conflict instead of overwriting newer work.
- Agent preview and investigation map derive from the same structured draft/confirmed revision. Label draft changes and reconciliation needs; do not present unconfirmed model proposals as established evidence or grading.
- Evidence changes invalidate affected solution/rubric reconciliation. Persist unresolved dependencies, ask appropriate follow-up questions when chat is enabled, and expose the same blockers in Classic.
- Changing view does not change the expected answer, score, rights, payment eligibility or exported benchmark contract. Reference answers and grading stay outside executor-visible inputs.

## Common controls in every experience
Both views retain instructions PDF, field definitions, read-only examples, investigation map, View as agent, current investigation-step count, required authoring-section count, consent, own-work declaration, sensitive-data checks, originality review signals and deterministic submit validation. Classic is not an escape from the human-only authorship controls. Legitimate source upload remains separate from typing restrictions and policy publication.

The chatbot is a facilitator and extractive organiser, not an answer writer. Enabling it does not enable an AI-authoring enterprise workflow. The non-chat Classic view invokes no facilitation call merely because fields are opened or saved; existing non-generative platform checks may still apply.

## Permissions and configuration lifetime
- PM/Admin configures the project; SMEs can choose a view only when BOTH is enabled. Reviewer/PM acceptance uses the same submitted snapshot regardless of input view.
- API must enforce the configured experience on all entry points, including direct URLs and legacy drafting routes. Hiding a tab alone is insufficient. Enforce existing ownership/read-only restrictions as well.
- Freeze configuration/version on activation for current assignments. Before activation PM/Admin may edit the setting. Later changes require an explicit audited configuration version and a clear choice of new assignments only or reviewed migration of in-progress assignments; preserve every existing draft and conversation.
- The additive migration leaves existing projects NULL, preserving both historical editors and their existing controls. New authoring projects require an explicit choice. Legacy draft edits leave NULL unchanged unless the PM deliberately chooses a mode; mode changes are refused when tasks already exist. Submitted projects retain the existing no-edit rule. No in-flight configuration migration is provided.

## Review states and benchmark handoff
Task states remain Authoring; Review / Approval Pending; Approved. Expert reviews, PM approves; the same authorised person can hold both responsibilities. Rework returns to Authoring. These are independent of the authoring experience. Authoring origin is provenance, not an acceptance criterion or benchmark feature.

An accepted dataset record must still pass the Anvil executable-contract checks. Choosing Classic/Chatbot/Both cannot bypass missing adapters or qualify a runtime.

## Acceptance scenarios
1. Create each option; save/read back the exact setting; require an explicit valid enum and authorised PM/Admin.
2. Classic-only: no Chatbot control; direct chat mutation is denied. Chatbot-only: no Classic control; direct editor mutation is denied while shared validation/read endpoints remain permitted.
3. Both: type an evidence change in Classic, switch without saving, see the same draft in Chatbot and map. Confirm an extractive chat proposal and switch back; see the same revision and content.
4. Refresh and resume both the draft and last permitted view. Keep unpublished proposals distinct from confirmed work.
5. Concurrent edits or changed policy invalidate stale proposals and prevent lost updates. Failed save preserves text and shows recovery.
6. Identical structured task authored in either view produces the same validation and benchmark payload, apart from allowed authorship/audit metadata.
7. All modes enforce consent, privacy, own-work/revision declaration and submission rules. Examples cannot be inserted as substantive answers.
8. Expert/PM see one submitted revision and its provenance; rework retains project configuration and comments. Agent mode remains read-only.
9. Keyboard, phone read-only policy and narrow layouts remain usable; no overlapping controls at 320/390/736/1024px.
10. Changing project configuration is audited, versioned and cannot silently strand drafts or revoke access mid-edit.

## Local implementation
Project enum/schema migration and creation/edit/summary UI; explicit choice at API creation; frozen configuration after submission or assignment; allowed-editor checks on direct save and chat routes; common consent, source/privacy checks and revision-bound declarations; shared structured output and optimistic revisions; flush-before-switch; persisted permitted view and unsent chat text; shared instructions/map/agent projection and submit checks. Legacy generation is blocked for newly configured human-only projects. Manual clarification answers can resolve conversation follow-ups through the common review route, with audit history, without generating an answer for the SME.

Switching Classic to Chatbot waits for the existing autosave to acknowledge the latest revision, then reloads the canonical task. It creates no second task. A save failure or conflict prevents switching. Chat proposes changes to that same record. Typed chat input is saved separately from confirmed output so it is not mistaken for evidence.

Remaining independent gaps: two-stage Expert→PM role routing, candidate policy-publication bridge, domain-specific executable Anvil adapters, live MaaS model qualification and native multi-agent execution. None was represented as completed by this project-setting change.

## Delivery boundary
Local source and isolated SQL/browser validation only. No paid model calls, cloud deployment, push, merge or live payment. Full implementation/validation evidence is in IMPLEMENTATION-EXPERIENCE-HANDOFF.md.

### Classic persistence follow-up — 10 November 2026

See [CLASSIC-PERSISTENCE-FIX.md](CLASSIC-PERSISTENCE-FIX.md). KYC section navigation now awaits saves and retains the answer on failure. Classic agent preview saves first and preserves the mounted editor. The uniform eight-section Figma design remains a target; current non-KYC templates still use the shared generic Classic form.
