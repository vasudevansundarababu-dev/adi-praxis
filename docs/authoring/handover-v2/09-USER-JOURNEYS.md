# 09 End-to-end user journeys

## J1 PM creates and staffs a project

PM selects published template/version, sees fixed agent mode, chooses Classic/Chatbot/Both and the authorised review route, sets accepted target/coverage/dates, attaches policies and JD, reviews qualified SME matches and assigns work. Project summary explains exactly what is ready or missing. Existing identity/onboarding and staffing checks remain authoritative. Template field/rendering support and policy gaps must be visible before presenting a project as end-to-end ready.

## J2 SME authors in Classic

SME opens an assigned task, accepts the authoring terms, reads the template Instructions PDF and fills the eight-section target form. They add repeatable evidence/tool/rubric items explicitly. Tabs retain answers; autosave acknowledges the final change before leaving. Horizontal flow appears below and reads the same confirmed data. SME selects a role to inspect its fields, checks agent visibility, resolves validations, declares current revision and submits. Current generic pages are transitional and need the registry-driven form implementation.

## J3 SME authors through the common chatbot

The bot loads the actual template, saved task, approved rules and prior turns. It asks for the missing field in context. The SME describes an inconsistent name and absent identifiers. The bot preserves those observations, asks applicability/jurisdiction questions and flags affected findings/rubric; it does not write the reference decision. SME supplies the substantive content and confirms coordinated placement. The graph and Classic fields update together. No provider response means no invented update.

## J4 Switch Classic and Chatbot without loss

In a Both project the SME types an unsent chat answer, switches to Classic, changes a field and immediately switches back. Save barrier completes before switching; chat draft remains. Reload restores confirmed fields and the persisted draft. If save fails, remain in the current view with error and answer intact. A pending proposal tied to an older revision is discarded/recomputed, not silently overwritten. Classic-only/Chatbot-only projects reject alternate editor writes at the API.

## J5 Add a bank/customer policy

SME uploads through the proposed policy-submission route, labels authority and supplies metadata/rights. System extracts/scans/qualifies it into a pending queue. Expert checks the original text, applicability and candidate rules. Authorised publication makes only reviewed versions active. The SME binds approved rules to steps/criteria. Until that bridge exists, PM/Admin performs project-policy intake and SME task-source uploads remain non-authoritative attachments.

## J6 Expert review and rework

Expert opens frozen submission, checks evidence/policy/reference/rubric and graph, reviews declarations/similarity without assuming misconduct, and records field-specific corrections. Return moves the same task to Authoring. Chat receives actual comments and current policy snapshot; Classic opens the corresponding fields. SME changes, revalidates, redeclares and resubmits a new submission version. Existing acceptance/payment counts are not incremented by rework.

## J7 Expert -> PM approval

Expert completes review; task stays Review/Approval Pending, now assigned to PM. PM verifies the reviewed revision, policy approval, blockers and export readiness. Approve locks acceptance and appends the immutable dataset record; eligible earning follows existing rules. If the same person holds both roles, record both decisions honestly. This target flow requires implementation beyond current one-stage review.

## J8 Graph with decisions, human review and loops

A multi-agent template provides three specialist roles and a consolidator. SME defines inputs/outputs, joins, evidence completeness, missing-evidence return, human referral, business reviewer responses, correction return and unresolved escalation. Each decision cites applicable rules and every loop has a limit/exhausted exit. Expert checks this expected process; no graph edge implies actual execution. Unsupported human-interaction/loop adapters block executable Anvil export.

## J9 Completion and export

PM/Admin sees accepted count, coverage, in-progress/rework tasks and project dates. Reaching target or end date triggers a closure review, not automatic acceptance of incomplete work. Proposed end-date behaviour: stop new assignments, preserve drafts, explicitly decide rework grace and close/export eligible approved records. Freeze exact template/policy/task/adapter versions and hashes. Dataset export can succeed while executable contract export is blocked; label both statuses separately.

## J10 Interruption, model outage and stale policy

A network loss preserves local text and reports unsaved state. A provider failure preserves canonical output and attempt status. The author resumes without a duplicate task/payment. A policy update invalidates stale proposals and affected pending reviews. Large context limits fail visibly; the user is not told that all prior details were remembered when they were not included.
