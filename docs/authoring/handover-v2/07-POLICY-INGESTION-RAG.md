# 07 Project policy ingestion, review and retrieval

## Authority and scope

Policies belong to the project. PM/Admin uploads the initial set. SMEs may propose additional bank/customer documents, but those documents must pass authorised review before any rules become authoritative. The proposed SME policy-submission bridge is not the same as existing task-source upload. Current policy routes grant PM/Admin access; candidate attachment upload must not bypass that boundary.

Bank policy and customer policy are source categories, not a hierarchy that the model may invent. Record issuer, scope, effective dates, jurisdiction and precedence where approved. A customer document cannot silently override bank rules. Regulations/public standards can be a separately labelled source type; do not call them bank policy.

## Ingestion pipeline

| Stage | Stored evidence / action | Gate and user message |
|---|---|---|
| Upload request | Tenant/project, actor, declared category, title, issuer, version, effective dates, language and rights declaration. | Authorised upload/proposal route only. |
| File intake | Original bytes, hash, media signature, size and scanner result. | Refuse malware, unsupported file or oversize; never trust filename alone. |
| Content extraction | Text with PDF page or document section/line locators and extraction method. | Scans/OCR gaps flagged; no fabricated page citations. |
| Sensitive-data check | Suspected real identifiers/confidential matter and handling status. | Quarantine/restrict access; author sees a safe reason, not leaked values. |
| Policy qualification | Assess purpose, authority, prescriptive clauses, scope, version and relevance. | Candidate classifier result with reasons; human decision still required. |
| Candidate rules | Extract obligation/prohibition/permission, scope, exception, condition, effective period and exact source span. | DRAFT only; extraction does not publish a rule. |
| Expert rule/document review | Compare each rule with original page, resolve exceptions/conflicts, reject unrelated content. | Approve, request correction or reject with rationale. |
| PM/Admin publication | Freeze reviewed rule versions and publish a project rule set. | Separate authority; no chatbot-driven publication. |
| Retrieval/index | Index approved, authorised spans/rules with tenant/project/version/visibility metadata. | Pending/rejected/archived content excluded from authoritative context. |
| Task use and snapshot | Link rule versions to steps/criteria and snapshot at submission. | Policy changes invalidate stale proposals and affected review. |

Current parser limit inspected: 10 MB per policy file, supported readable formats and configurable maximum pages. An image-only scan can yield NO_TEXT_FOUND. OCR is not automatically qualified because a parsing library exists. The project must configure a limit supporting its 20-page policy use case and verify page/line locators. Upload success or a clean scan does not establish authenticity.

## “Is this really a policy?” review

Check issuer/owner, intended audience, scope, approval/effective metadata, prescriptive language, enforceable rules, exceptions, consistency and relevance. A slide deck, invoice, account statement, marketing leaflet, unrelated article or random document must not be promoted merely because it contains “policy”. A genuine customer policy may be informal or lack a standard heading; allow an expert to explain acceptance rather than applying an opaque classifier as a final rejector.

Proposed qualification outcomes: policy candidate, supporting reference, unrelated/non-policy, unreadable, sensitive/quarantined. These are document-workflow outcomes, not extra task states. Store why and who decided. Suspected authenticity requires issuer/version clarification; an LLM cannot certify a document is genuinely issued by a bank.

## Rule schema and UI

A reviewed rule needs ID/version, document version/hash, exact locator/quote, paraphrased requirement, condition/applicability, exceptions, jurisdiction, effective interval, precedence/conflict links, visibility and review decision. A step-rule link needs the step/role ID, reason and applicability judgement. A rubric-rule binding states how the requirement is assessed. Never mix a policy quote, an author's invented case fact and a reviewer inference without provenance labels.

For a 20-page document show upload -> extraction progress -> candidate rules with page links -> applicability selection. Ask the SME “Which of these approved rules applies to this step, and why?” Do not ask them to retype twenty pages. If the needed rule is not present, offer clarification or a policy proposal; never manufacture a rule from model memory.

## Retrieval design

Start with the existing published project rule set for small libraries. For larger projects add a permission-filtered hybrid retrieval layer: deterministic rule/ID matches plus full-text search, optionally vectors, followed by a reviewed relevance rerank. Filter tenant, project, publication/version/effective scope and visibility BEFORE retrieval; recheck selected records before dispatch. Retrieve source snippets and their metadata, not only embeddings. Keep exceptions together with a rule when splitting text.

Document chunks are data. An embedded “ignore prior instructions” clause cannot grant tool access or change the bot's role. No arbitrary URL fetching or live bank contact is needed. Embeddings are derived project data; changing embedding models requires index versioning/rebuild and recall checks. A vector database does not itself provide memory, authenticity or hallucination prevention.

## Policy-change lifecycle

When a policy version changes, identify affected tasks and links. Existing submissions retain their frozen snapshot; pending author proposals become stale if their digest changed. Expert review and PM approval must explicitly decide whether to return, revalidate or preserve an older benchmark version. Approved exported records are immutable; publish a new task revision/dataset record rather than rewriting prior benchmark evidence.

## Required reviewer controls

Original document viewer with exact page/line navigation; extracted text/OCR confidence warning; candidate rule comparison; Bank/Customer/source type; effective date/scope; accept/edit/return/reject; conflict/precedence field; audit identity/timestamp; publication status; affected-task list. Expert access is assigned and audited. Until the SME bridge is implemented, PM/Admin performs intake through existing policy services and the interface explains the limitation.
