# 04 SME workbench: screens and fields

## Common shell for every template

Show project/template/version, assignment, task status, current saved revision, section X of 8 and workflow step/role count. Only a Both project shows Classic/Chatbot tabs. Keep Instructions PDF, View as Agent, save status and validation accessible in both. Flow preview is a connected horizontal graph BELOW the authoring area. The same graph appears after changing editor; no separate graph copy.

Selecting a role/step updates its authoring context. Selecting a decision/human/loop shows the relevant routes and conditions. A business human node is an authored scenario interaction; it is not the Expert reviewing the task or the PM approving it. In Classic show appropriate controls; in Chatbot show the conversation and persistent typed-answer composer. Do not restrict editability to the first tab.

Current KYC uses six grouped sections W01-W06 and non-KYC templates use the shared generic editor. The eight-section specification below is the common target renderer, not a claim that all existing pages already implement it.

## Section 1: Assignment and brief

| Field | Meaning / action | Example / check |
|---|---|---|
| Title | Name the work the benchmark agent must do. | Resolve inconsistent applicant identity evidence. Required. |
| Trigger | Choose the template event that starts the work. | KYC: NEW_ONBOARDING or PERIODIC_REFRESH. |
| Business context | Explain the situation and assignment without giving the answer. | Identity and address records have different family names. |
| Customer/subject type | Identify the entity or subject category. | Individual applicant; scope determines applicable rules. |
| Product/channel | Describe relevant service and submission channel. | Current account / online application, if supplied. |
| Jurisdiction/language/as-of date | State the task's boundaries and relevant date. | Do not let the bot infer a country from an identifier label. |
| Difficulty/estimated steps | Set template-supported complexity and expected work size. | KYC difficulty 1-5. Not an execution receipt. |
| Coverage tags/edge case | Classify the case into the assignment's coverage cell. | Missing identifier and inconsistent name; use configured pick lists. |

## Section 2: Evidence and parties

| Field | Meaning / action | Example / check |
|---|---|---|
| Evidence ID/type | Give every input a stable ID and document/record type. | E1 identity record; E2 address record. No duplicate IDs. |
| Source/issuer/date | Identify origin, issuer and date known to the case. | Missing issuer stays unknown; do not invent provenance. |
| Extracted fields | Record the actual relevant text/values. | Family-name values differ. Use authorised test data. |
| Party ID/name/kind/role | Identify who the evidence concerns. | P1 / applicant / PERSON / CUSTOMER. |
| Relationships/ownership | Link parties and quantities when the template needs them. | Supported ownership percent; no unsupported beneficial-owner inference. |
| Missing/inconsistent evidence | Explicitly describe absence or contradiction. | SSN/Tax ID absent; requirement applicability not yet established. |
| Case-source attachment | Upload authorised supporting source material through the source route. | An attachment is evidence, not an approved project policy. |

Empty evidence collections must display an Add action and explanatory text. Adding a record opens its actual fields. Do not create decorative text areas unrelated to the contract merely to make a tab look editable.

## Section 3: Environment and recorded tools

| Field | Meaning / action | Example / check |
|---|---|---|
| Environment choice | Select supported tool environment or explicit none. | None for a pure structured decision; tool environment requires executable binding later. |
| Tool catalog | Choose only template-approved actions. | document_check, registry_lookup, request_info. |
| Response ID/tool | Identify the exact allowed recorded call. | R1 / document_check. |
| Arguments | Enter schema-valid inputs to that call. | Reference the correct party/document ID. |
| Response kind/content | Write what the environment returns. | CLEAR/HIT/NEAR_MATCH/DATA/ERROR for KYC. |
| Response visibility/reveal stage | Declare when and to whom the recorded response is available. | Not all tool outcomes belong in the initial agent-visible prompt. Target graph/adapter extension. |
| Reset/failure behaviour | Define repeatability, unavailable tools and error handling. | Missing tool outcome remains unassessed, not fabricated success. |

A recorded response is not evidence that a live tool executed. The author supplies it as part of the test environment. A benchmark-specific adapter must qualify replay/isolation before real execution.

## Section 4: Applicable project policies

| Field | Meaning / action | Example / check |
|---|---|---|
| Published rule/version | Select the exact approved project rule. | PR identifier is an example only until linked to a real published version. |
| Source page/clause/quote | Locate the authority supporting that rule. | Keep a faithful quotation and locator. |
| Applicable step/role | Bind the rule to the work it governs. | Identity discrepancy assessment step. |
| Applicability rationale | Explain jurisdiction, category, scope and exceptions. | Why the rule applies to this applicant; do not infer a universal SSN requirement. |
| Conflict/exception | Record competing rules or unmet conditions. | Needs expert clarification; do not silently pick precedence. |
| Additional bank/customer policy | Propose a document for authorised review. | Pending until qualified/reviewed/published. No immediate authority. |

## Section 5: Expected work and process

Define steps, expected results, reasons, findings, evidence references, recommendations, risk rating where applicable, rationale and authorised business handoff. The SME writes the reference solution; the bot asks for missing parts. For multi-agent templates also define roles, permissions, input/output artifacts, joins, decisions, human responses and bounded returns. See chapter 05 for graph fields.

A missing fact may imply an unresolved finding; it does not justify inventing a tool result or policy obligation. Changes to evidence flag dependent solution and rubric fields for reconciliation. Keep reference/private grading out of the agent brief.

## Section 6: Allowed outcomes and values

Use the template's pick lists. For KYC: RECOMMEND_APPROVE, RECOMMEND_REJECT, REQUEST_INFORMATION, ESCALATE; risk LOW/MEDIUM/HIGH. These are recommendations or routing decisions, not a real account action. If no option fits, record an unsupported selection request for review rather than changing the enum. Non-KYC workflows use their own schema; do not force a banking disposition into a marketing task.

## Section 7: Rubric

Criterion ID/name identify what is assessed. Weight sets its contribution; use 100 total for KYC. Pass condition must be observable against case evidence, tool calls or output. The target renderer also needs explicit partial/zero-credit anchors, critical-failure scoring semantics, evidence/rule/step bindings, common errors and acceptable variations. These richer bindings are not all fields in current KYC types; add them through a versioned schema/adapter, not an undocumented rename.

Example: “Identify the E1/E2 family-name discrepancy and cite both records.” The SME supplies its weight and critical judgement. Do not grade identical wording when a different evidence-supported answer is acceptable. Mark a critical failure separately from a zero-weight criterion; define whether it caps or fails the task.

## Section 8: Check and submit

Show missing required fields, invalid references, policy applicability gaps, unsupported graph/export features, weights, privacy flags and unresolved proposals. Each finding links to the affected field/node. Save before checks and use the current revision. Show authorship/source declarations, pending policy additions, View as Agent and the intended review route. Submit sends one frozen version to review; it does not approve it or pay it.

## Chatbot-specific fields and actions

Conversation history shows authored answers and safe facilitation messages. Your answer is a persistent draft; it is not automatically a case fact. Send stores the turn and queues facilitation. Proposal review shows the supplied wording, intended fields, source/turn links, affected dependencies and unresolved issues. Confirm applies atomically; discard preserves the canonical task. Cancel/timeout must not lose typed work or imply a successful response. Provide retry only with clear attempt/spend semantics. A section jump changes context, not the stored answer's ownership.
