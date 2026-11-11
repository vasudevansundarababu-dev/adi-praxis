# 18 Latest decisions, implementation status and team handover

## Controlling scope

This consolidated v2.1 specification includes the base authoring requirements and the approved multi-agent extension. Where an older chapter refers to a proposed graph contract or a design still to build, it describes implementation maturity, not a requirement to ask for design approval again. Chapter 17 is the approved architecture direction; exact runtime capability and per-template qualification still have to be demonstrated. This document is a product/engineering handover, not independent QA acceptance.

## Latest product decisions

- One shared chatbot and one reusable Classic authoring framework serve every template. Register domain fields, rules, policies and capabilities through versioned template profiles; no separate chatbot fork per template.
- PM/Admin chooses Classic, Chatbot or Both at project creation. Both views share canonical task data, controls, revision and save barriers. Switching tabs/views must preserve the last answer and unsent chat draft.
- Single or Multi Agent is fixed by the template. SME/reviewer screens show the mode read-only and cannot change it.
- Three top-level states: Authoring, Review/Approval Pending and Approved. Pending identifies Expert review or PM approval internally. Same-person Expert/PM responsibilities remain auditable; the first/demo route is SME -> PM.
- Horizontal connected graph below both editors: explicit nodes, decisions, business human interaction, joins, labelled branches, bounded loops and escalation. Business human interaction is distinct from platform Expert/PM approval.
- Author/reviewer instructions are template-specific PDF help: expectations, field meaning, what to enter, relevant examples, common mistakes and completion/rework instructions. Avoid the word fictional in SME/reviewer task UI and guides. Testing provenance remains accurate in internal metadata and benchmark evidence; do not relabel test results as genuine model performance.
- Facilitator asks and reconciles; SMEs supply substantive answers. No answer-generation function. Consent, declarations, scope/permission controls, source checks, confirmation and human-reviewed similarity findings supplement paste friction. External LLM use cannot be reliably prevented or proven from typing alone.
- LangChain provides model/tool interfaces where appropriate; Anvil-owned LangGraph coordinates runtime state, roles and transitions. Harbor manages qualified actor/environment execution, collection and separate verification. Preserve original Task scoring independently from Harbor native reward.
- Build and test without OpenHands. No paid calls or cloud deployment are implied by local implementation approval.

## Anvil viewer decision - interface dependency

Click a task ID/name in benchmark results to inspect the exact task version read-only. Show graph and selectable node detail. Export the currently viewed graph individually; initial implementation uses SVG. PNG or other formats require their own verification before being advertised. No graph images are added to benchmark PDF reports. Existing report PDFs remain unchanged; bulk graph export is deferred.

An authored graph and an observed execution path are different views. Only captured evidence can support an execution overlay; it is a later enhancement. Do not invent decisions/loops from legacy prose. A faithful projection from recorded ordered stages is labelled as such, and absent/unsupported graphs show a diagnostic.

## Actual local implementation snapshot

| Area | Evidence / status | Remaining work |
|---|---|---|
| Praxis authoring experience and save controls | Local source through de758ba; existing v2 evidence covers all 14 catalogue templates for persistence. | Full typed Classic fields across all templates, adaptive policy-aware chat and common graph authoring are not complete. |
| Praxis handover | Base documentation checkpoint 3c191e9 plus this consolidated specification. | This documentation delivery does not deploy product changes. |
| Anvil task viewer | Local d7c2536; task IDs open read-only captured-stage viewer; single SVG export. 28 focused tests, type checks, production build and actual Chrome component/export/focus checks pass. | Not deployed to QA; not complete multi-agent graphs; API/SQL/full identity acceptance not claimed by the component check. |
| Shared graph/runtime | Approved architecture in chapter 17. | Version allocation, cross-language contract, graph compiler, joins/loops/human request custody and Harbor end-to-end qualification. |
| Review/policy integration | Existing base services identified in source audit. | Two-stage Expert/PM permissions, SME policy proposal queue and full retrieval qualification remain explicit work. |
| Models | Provider abstraction and managed-open-model pilot plan specified in chapter 11. | Model recommendations/prices are dated planning references, not measured quality or permission to activate billing. |

Existing actor projection, hidden references, tenant/project isolation, durable budgets, cancellation and Unknown handling must not be weakened for a demo. Existing Task score, accepted-task payment eligibility and rework invariants remain authoritative.

## Test and rollout plan

1. Shared graph validation and TS/Python fixtures: reference integrity, typed branches, branch-aware joins, bounded/nested cycles, explicit exhausted routes, immutable versions and actor visibility.
2. UI browser journeys: every supported template/section; tab and Classic/Chatbot switches; failed saves; graph selection/navigation; read-only inspector; individual export; keyboard/mobile behavior.
3. Review/policy integration: upload originals and extraction locators, pending versus approved policies, stale decisions, direct/two-stage review, same-person audit and rework/payment invariants.
4. Runtime recovery and security: durable checkpoints, replay-safe effects, cancellation, expiry, no automatic resend of uncertain model calls, human request authorisation and role/artifact separation.
5. Actual Praxis export -> Anvil import -> qualified Harbor trial -> sealed verifier -> original Task results/export. Run real SQL/API/browser/native checks and retain their receipts separately from controlled/mock providers.
6. Separately authorised live-model pilot and staging/release acceptance. A compiled UI, simulated response or oracle baseline is not proof of full authentic benchmark readiness.

## Sharing package and continuation

The sharing ZIP contains one consolidated PDF, matching editable specification chapters 00-18, 14 per-template task.md drafts, template profile index, traceability, existing screen/preview references and earlier instruction-reference appendices. Appendix wording is subordinate to the current field contracts and consolidated decisions. Screens are design references, not proof of runtime functionality.

