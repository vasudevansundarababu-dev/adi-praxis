# User journeys and handoffs

## J1 PM/Admin prepares project — existing Praxis
Choose published template, targets/coverage, dates and terms; configure project policies using existing upload/extract/rule-review/publication; create/attach JD; match eligible SMEs; assign through existing staffing. Additional authoring mode/review-flow toggles must not be presented as implemented if absent. Admin existing operation is the demo route.

## J2 SME creates a case through chat — new
1. Open assigned task after existing identity/onboarding/assignment gates.
2. Describe fictional case using a relevant section example.
3. Assistant reads saved answers/current case/template/published rules and asks the next contextual question.
4. SME adds a gap, e.g. missing SSN/Tax ID. Assistant distinguishes fact from requirement; requests jurisdiction/policy support rather than inventing law.
5. Review coordinated scenario/evidence/reference/rubric changes and exact policy links; confirm or discard.
6. Inspect dependency map and node details; inspect View as agent without private expected answers.
7. Resume after refresh; unresolved questions and reviewer comments remain available.
8. Resolve gaps, review coordinated content, use existing detailed editor/check/submit. Automated readiness is not human acceptance.

## J3 Admin final review and rework — reuse existing path
Admin reviews submitted revision using existing checklist and checks, plus preserved conversation/draft provenance. Request rework with pinned comments; SME resumes the same task and chatbot receives the feedback. Confirm changes and rerun checks; resubmit. Admin ACCEPT appends an immutable accepted record. Rework is not another payable unit. No fabricated reviewer decision. Separate expert-review stage is future design, not inferred from existing Reviewer role.

## J4 Payment, completion and export — existing with qualifications
Existing acceptance event may record earnings only when requisition/rate-card/pay-route eligibility is satisfied. Existing payment release/provider process remains unchanged and requires its usual controls. Existing completion considers accepted task count and coverage. Dataset export returns accepted records; KYC MCP replay is separate. Executable Anvil export requires a valid praxisContract; absent contract returns a visible blocker. No live payout or Anvil execution is part of local chatbot acceptance.

## J5 Additional SME policy — flagged dependency
Existing candidate attachment upload is a task source, not project policy. A future candidate proposal route must classify Bank/Customer, check file/content, quarantine suspected real data, queue authorised policy review, extract candidate rules and publish approved versions before linking. Until implemented, PM/Admin adds policies through the existing project library. Chat must explain the limitation rather than silently accept arbitrary documents as authority.

## J6 Multi-agent authoring — mockup only
Same workbench. SME explains who does each part, required handoff artifacts and join conditions. Chat proposes a role/step graph and per-role permissions plus stage/final rubric. SME confirms; each role's agent preview excludes other/private artifacts. Runtime scheduling, isolation and Anvil adapters require separate acceptance. Demo remains single-agent with SME→Admin review.

## Validation scenarios

V1: create project and assigned synthetic authoring task via existing endpoints; chat remembers prior answers and unresolved requirements. V2: unknown evidence/rule IDs, autonomous decisions, sensitive data and explicit override attempts do not apply. V3: concurrent edit or policy digest change rejects stale proposals. V4: confirm updates task/map/rubric; browser refresh resumes; executor preview excludes private fields. V5: author reconciliation then submit; Admin requests rework; chat receives actual feedback; resubmit; Admin accepts; one immutable record/hash chain and dataset export. V6: missing executable contract produces409, not simulated Anvil acceptance. V7: desktop authoring, phone read-only and legacy detailed editor remain distinct supported views. V8: single/multi mockups support role expansion, join inspection, per-role preview and narrow layout; multi runtime remains unimplemented.

## Human-only authoring overlay
Before J2 the SME accepts the current terms. Examples teach the structure; the SME types their own substantive content. Chat extracts their wording, asks contextual questions and proposes changes requiring confirmation. It cannot write the answer for them. Cut/paste and text drops are blocked only in authoring inputs; authorised documents use upload controls. A changed revision invalidates the prior declaration. Reviewers see consent, declaration and existing similarity signals, use judgement and request clarification/rework when necessary. No control proves external LLM use or absence.

Demo review route: SME → Admin final decision. Future supported product configuration: SME → expert Reviewer → PM final decision. Existing Reviewer role alone is not a two-stage approval engine. Two-author comparison and SME-versus-LLM adjudication are excluded from this MVP.

## Revision 1.1 - instruction-first experience
The assigned template fixes agent mode. SME opens its Instructions PDF, sees eight authoring sections and the current investigation-step count, then authors the case. Expert opens the same template guide at its reviewing page, inspects eight checks and returns corrections or completes expert review. PM approves the reviewed revision. Same-person expert/PM operation retains both responsibilities. The graph shows only task work. Instruction copy explains each field and the expected action; it does not tell the SME the case answer.

Current UI code includes the PDF help links and section/step counts. Three-state workflow and two-stage expert/PM permissions remain specification changes requiring implementation and tests before rollout.

## J7 Project-configured authoring experience - revision 1.3
PM/Admin selects Classic, Chatbot or Both during project creation and previews the SME view. Template agent type remains fixed. SME opens the configured experience. Both exposes two tabs backed by one task; moving between them retains draft fields, answers, policy links and rubric. SME resolves the same validation blockers and submits the same contract. Expert and PM review one submitted revision irrespective of authoring view. Rework resumes the same allowed experience. Project configuration changes cannot silently discard an in-progress draft. See AUTHORING-EXPERIENCE.md for exact acceptance scenarios and implementation gaps.

## J7 implementation evidence
The local browser journey creates each project option through the actual PM console, verifies stored configuration and reloads the draft. The SME journey types an unsent chat answer, switches to Classic, edits a field and immediately switches back; both the saved field and unsent answer are retained. Separate API tests enforce all three modes, ownership, legacy compatibility and frozen configuration. These checks use isolated local services and controlled provider responses; they are not deployment acceptance.
