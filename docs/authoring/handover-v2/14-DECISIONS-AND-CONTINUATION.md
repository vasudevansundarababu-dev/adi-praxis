# 14 Conversation decisions and continuation handoff

This register consolidates decisions visible in the supplied conversation and inspected source documents. It is not a verbatim transcript or a claim to remember unavailable chat history. Keep this file as the continuation index and append future dated decisions rather than relying on model memory.

| Decision | Current instruction / supersession |
|---|---|
| Authoring purpose | SMEs create realistic, complete benchmark tasks with professional judgement; do not dilute the experience with “fictional” labels. |
| Single/multi scope | Agent mode is fixed by the published template. Independent repeated cases are single-agent trials. |
| Shared chatbot | One chatbot engine for every template; template-driven context/questions/checks. No per-template chatbot forks. |
| Shared Classic | Common schema-driven framework with domain configuration/plug-ins. Reuse common screens instead of fourteen independent implementations. |
| Project experience | PM/Admin chooses Classic, Chatbot or Both during project creation. Both shares one task and retains draft answers. |
| Latest layout | Authoring fields or conversation on top; horizontal connected graph BELOW in both views. This replaces side preview and the tall vertical graph as the desktop target. |
| Graph semantics | Real connected nodes, decision diamonds, explicit branches, business human review and bounded loops. Text-card chains are insufficient. |
| Human distinction | A business human interaction can be an authored graph node. Expert/PM platform task review remains a status outside it. |
| Navigation | Show section and step counts separately. Every applicable Classic content section has its fields/Add actions. Save on transition; never lose the answer. |
| Agent preview | Available in both editors, with server-enforced private-answer/rubric/role visibility. |
| Task states | Authoring / Review-Approval Pending / Approved, with responsible stage inside Pending. Rework returns to Authoring. |
| Review routes | Implement SME -> PM and SME -> Expert -> PM. Demo uses first route through currently authorised final reviewer. Expert and PM may be same authorised person with honest decision records. |
| Excluded comparisons | Two-SME winner selection and SME versus LLM authored-task competition excluded from MVP; enterprise exploration deferred. |
| Policy scope | Base documents uploaded at project level. SME bank/customer additions require qualification/review before authority. |
| Document authenticity | Detect unreadable/non-policy/unrelated content and require expert judgement. A classifier or filename does not prove policy authenticity. |
| Rule applicability | Extract candidate rules with citations, then ask which approved rule applies to each step, including exceptions. |
| Chat memory | Correlate new answers with saved fields/history/policies. SSN/TIN absence is an observation, not an invented mandatory requirement. |
| Human authorship | Bot facilitates, extracts and clarifies; SME supplies answers/reference/rubric. No Generate my answer button. |
| External LLM use | Prohibit through consent/declaration and review controls, but do not promise technical proof or perfect prevention. |
| Typing and similarity | Authoring paste/cut/text-drop friction plus legitimate document upload and reviewed accessibility exceptions. Similarity is a human review signal, not automatic misconduct/payout determination. |
| Instructions | Examples for every section and template PDFs: what to expect, field meanings, what to do and how to review. |
| Existing Praxis | Inspect/reuse existing services. Flag changes, missing permissions and unqualified adapters; do not rebuild everything or claim completion from a mockup. |
| Validation | End-to-end UI/API/data checks and regression impact required. Controlled providers are not live-model acceptance. |
| Payments | Accepted task eligibility follows existing terms/ledger. Rework/resubmission is not a second payable unit. |
| Completion/export | Target accepted count/coverage or end date prompts closure/export decision. Only approved eligible versions export; executable Anvil contract qualification is separate. |
| Models | Cost-first managed open-model inference on Google Vertex Model Garden/MaaS. “Open source” was clarified to mean free/cheap usage; hosted calls still cost money. |
| Training | No training required for this authoring exercise. A future model-training platform is a separate discussion/scope, not silently included. |
| Scale/cost | Planning scenario 100,000 tasks over five authoring months; six-month host budget separates development and inference/benchmark costs. No quoted estimate is a measured bill or spend authority. |
| Handover | Include requirements, field guides, journeys, source gap audit, chatbot/guardrails, policy/RAG, model plan, reviewer/help guides and all relevant decisions in Praxis handover. |
| Figma | Latest request is Praxis handover, not another Figma pack. Preserve prior files but do not use Figma delivery as a substitute for the specification. |

## What exists locally

Praxis checkout: /Users/vasudevansundarababu/Documents/Codex/praxis-conversational-authoring. Clean local product commit de758ba contains the persistence fix; 09aa194 contains project experiences/common controls and 38bbaa3 earlier conversational work. None is asserted pushed/deployed by this handover. No new paid model call is part of it.

Local graph reference: praxis-classic-chatbot-flow-preview.html in the thread visualization directory, now horizontal at desktop widths. It is an interactive design preview with confirmation/retained text, not a live LLM or executable multi-agent runtime. The handover package includes standalone preview and Classic/Chatbot PNG references.

## What to build next

Follow chapter 12 phases. Start with template registry/full Classic profile and safe shared question planner. Keep output schema/version and review/payment invariants. Add policy proposal bridge and two-stage approval explicitly. Qualify MaaS adapter and per-template Anvil contracts only with authorised live acceptance. A graph mockup, dataset export or SDK mock response must not be labelled full production acceptance.

## Open decisions, not invented answers

Owner/domain reviewers must confirm all published template agent modes, final field/outcome contracts outside KYC, review-edit authority and author reconfirmation rules, same-person approval policy, deadline/rework grace, per-project document rights/retention, minimum mobile editing support, operator budget caps and live-provider pilot acceptance. These do not prevent delivery of this specification; they do prevent unsupported rollout claims.

## Next-session checklist

Read this index, then 00 and 10. Confirm current branch/status before editing. Inspect current sources instead of replaying stale older instructions. Update the decision register and affected chapters for each material correction. Record implementation commit, checks actually run, failures/limits and deployment status. Avoid secret/config/runtime credential reads. Keep Anvil/Praxis independence and cloud-spend authority separate. Do not restart old agents or treat monitoring prompts as coding instructions.

## Consolidation update - 10 November 2026

The owner approved local implementation of the shared workflow contract and Anvil read-only task viewer first, then the wider Praxis/LangGraph/Harbor integration. No OpenHands is to be used. Clicking a benchmark task name/ID should open the exact task-version graph in read-only mode; export is one graph at a time. Task graphs are excluded from benchmark PDF reports, bulk export deferred; existing report PDFs remain unchanged. The first local Anvil implementation supports captured ordered stages and individual SVG export (d7c2536). It does not implement complete decision/human/loop graphs or deploy to QA. See chapters 17 and 18. The user requested one consolidated specification PDF and refreshed ZIP for team sharing.
