# 01 Requirements and acceptance

## Purpose and actors

Admin manages system configuration and authorised final actions. PM prepares projects, policies, JD, staffing, targets and exports. SME authors assigned cases. Expert evaluates domain correctness and the SME's added policy material, may make audited corrections or return work. PM provides final approval in the target two-stage flow. One authorised person may hold Expert and PM responsibilities, but the decision records remain distinct. Do not grant PM new permissions simply by hiding a button.

Demo flow: SME -> authorised PM/Admin final review. Target alternatives: SME -> PM; SME -> Expert -> PM. Two independent authors and SME/LLM comparison are explicitly excluded from MVP.

## Functional requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| PR-01 | Project authoring experience is required for new AUTHORING projects: CLASSIC, CHATBOT or BOTH. | UI/API refuse omission; persisted selection survives reload. Legacy NULL is preserved. |
| PR-02 | Published template fixes agent mode and schema version before assignment. | No SME/reviewer mode picker; server refuses unsupported workflow/export. |
| PR-03 | Shared template registry powers every Classic screen and the common chatbot. | A new template is registered through schema/configuration; no copied chatbot or page. |
| PR-04 | Both editors share task ID, output, reference, rubric, policy snapshot and revision. | Change in one view appears in the other after a verified save; no duplicate task. |
| PR-05 | Preserve typed answers during section, view and agent-preview transitions. | Final keystroke immediately followed by navigation is saved; failure retains editor and text. |
| PR-06 | Chat memory includes current fields, relevant prior answers, unresolved questions and actual rework feedback. | Missing SSN/Tax ID in a later answer creates contextual clarification without forgetting earlier evidence. |
| PR-07 | SME creates the substantive answer; chatbot extracts, asks and checks. | Requests to generate the answer or answer unrelated questions do not produce substantive content. |
| PR-08 | Confirm proposed coordinated changes before mutating case output. | Before/after and affected fields visible; stale task/policy proposals cannot apply. |
| PR-09 | Horizontal connected graph below both editors represents the same saved task. | Parallel joins, decisions, human steps and bounded loops have visible connected routes and field bindings. |
| PR-10 | Policy is project-level, immutable by version and published only through authorised review. | Pending or random uploaded documents cannot become authoritative context. |
| PR-11 | SME may propose bank/customer policy additions for review. | A permission-scoped submission queue exists; approved rule versions, not raw upload labels, become usable. |
| PR-12 | View as Agent is a server projection. | Reference/rubric/private discussion and future/other-role artifacts are absent, including downloadable payloads. |
| PR-13 | Eight-section target experience is common across templates with domain-specific controls. | Every applicable content section has editable fields or a clear Add action; no first-tab-only editor. |
| PR-14 | Expert/PM review is tied to a submitted immutable revision. | Changes invalidate affected review/approval; the reviewer never approves an unspecified latest draft. |
| PR-15 | Rework returns the same task, preserving comments and provenance. | No second accepted count or earning for resubmitting the same accepted unit. |
| PR-16 | Payment uses existing eligibility and ledger controls. | Approval may create one eligible earning; actual payout status remains separate. |
| PR-17 | Target count/date controls intake, closure and export. | Only approved, eligible immutable records included; incomplete/in-review cases stay visible and excluded. |
| PR-18 | Anvil contract validation is separate from dataset export. | Missing adapter, unsupported graph or invalid binding blocks executable export with a precise reason. |

## States and review responsibilities

User-facing task states are Authoring, Review/Approval Pending and Approved. Within Pending store a responsible stage (Expert review or PM approval), an assigned reviewer and the submission version. Rework returns to Authoring with comments. A final declined/withdrawn administrative record may be necessary internally, but do not invent an additional user-facing state without a decision. Existing status enums and review routes are not already equivalent to this target model; migrate deliberately.

Template single/multi mode, project authoring experience and project review route are three independent settings. A multi-agent template can be authored in Classic or Chatbot. A Classic task can still contain operational human handoffs.

## Nonfunctional requirements

Proposed pilot targets: p95 first acknowledgement under two seconds for accepted messages, p95 completed small clarification under 15 seconds, 99.5% monthly authoring availability, and accessible labelled controls at 1024/736/390/320 widths. These are targets, not measurements or purchased SLAs. Persist the user message before dispatch; display generation pending/failure honestly. Account for reasoning tokens, retries and rejected responses. Project/tenant ownership applies to files, turns, retrieval and exports. Publish retention, consent and document-rights notices before collection. Never log credentials or whole sensitive uploads in model telemetry.

A hosted open model is not free usage. No model recommendation authorises enabling a service or spending money. Browser typing restrictions cannot prove that an SME did not use another LLM. A valid JSON response or citation does not prove semantic correctness.
