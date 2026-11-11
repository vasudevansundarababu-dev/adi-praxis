# Praxis SME Authoring specification and handover v2.1

Prepared 10 November 2026, America/Chicago. Product requirements, design and implementation handover. Latest local product commit inspected: de758bac9247fe7c53d36f033e225964f34f75f0 on feat/conversational-case-authoring. Source repository: https://github.com/vasudevansundarababu-dev/adi-praxis.git; owner's source branch: feat/catalog-published-defaults. No push, merge, deployment, paid model call or training is included in this documentation delivery.

## Read this before building

Praxis helps qualified SMEs author realistic benchmark tasks. The SME supplies substantive case facts, evidence, recorded tool behaviour, the reference solution and grading judgement. The chatbot facilitates that work; it must not become a second answer-author. Anvil executes and evaluates exported tasks; Praxis acceptance alone does not prove executable benchmark readiness.

There is ONE shared chatbot capability for ALL templates and ONE reusable Classic authoring framework. A template contributes its versioned field definitions, requiredness, pick lists, examples, tools, policies, reference shape and validations. Do not build fourteen independent chatbots or fourteen unrelated Classic pages. Both views read/write the same canonical task. Not every current generic template has the required typed field implementation yet.

Project creation chooses Classic, Chatbot or Both. Template configuration determines Single Agent or Multi Agent before assignment. SMEs and reviewers cannot choose an agent mode. In Both, switching view never creates another task, reference answer, rubric or payable submission.

## Latest layout decision

The Flow preview runs horizontally, left to right, BELOW the authoring area in BOTH Classic and Chatbot. It is a proper connected graph: agent nodes, diamond decisions, labelled branches, business human-review nodes, correction loops, limits, escalation and final output. It must not be replaced with stacked prose cards or text arrows. At narrow widths reflow the same connections into a compact accessible layout; never shrink labels until unreadable. Graph shape and task data remain identical when the editor changes.

The human-review node is a business step inside the authored case. Praxis Expert review and PM approval of the task remain outside that graph. These responsibilities must not be conflated.

## Scope and delivery status

- EXISTING: project/template/JD/staffing, PM/Admin policy intake and rule publication, KYC fields/checks, autosave, one-stage authorised review/rework, conditional earnings, immutable accepted dataset and export services.
- LOCAL IMPLEMENTED: project Classic/Chatbot/Both configuration; server view enforcement; shared consent/declarations; persisted conversation/proposals and unsent answer; revision/policy checks; common submission controls; save barriers and Classic preview retention. Tested locally; not deployed here.
- DESIGN / TO BUILD: schema-driven full Classic forms for all templates, horizontal workflow graph with decisions/human interactions/loops, fully adaptive template-aware clarification beyond current deterministic prompts, SME policy submission/review bridge, configurable Expert-to-PM stage, per-template executable adapters and new managed-open-model provider adapter.
- EXCLUDED: two-SME adjudication, SME versus LLM answer competition, model training platform, autonomous operational banking actions, cloud provisioning and paid benchmark execution.

## Document map

01 Requirements and acceptance; 02 System/chatbot architecture; 03 Project setup fields; 04 SME screens and section fields; 05 Shared templates and graph contract; 06 Chatbot memory and guardrails; 07 Policy intake/RAG; 08 Expert/PM review; 09 User journeys; 10 Existing-code change impact; 11 Vertex model choice and cost; 12 Build order and validation; 13 Help text and operating guides; 14 Decision register and continuation handoff; 15 KYC field contract; 16 Template catalogue supplement. Existing per-template six-section guides accompany the package as appendices.

This v2 handover resolves conflicting historical notes. In particular: remove unrestricted SME agent-mode pickers; remove blanket chat-default assumptions; never put platform approval into the investigation graph; keep human substantive authorship; put the connected graph below BOTH editors; use one template-driven authoring system. Older mockups are historical references.

## Consolidated multi-agent extension - approved to build

Chapter 17 incorporates the approved LangChain/LangGraph and Harbor architecture, shared graph fields, runtime boundaries, human interactions, review changes and acceptance gates. Chapter 18 records the latest decisions and actual implementation limits. These chapters supersede earlier approval-pending language. Local implementation is authorised; deployment and paid execution remain separate. The consolidated v2.1 PDF and refreshed sharing ZIP include every chapter.
