# Task drafting from documents and interviews, and MCP tool recording (M9, draft)

Draft for review. Extends `TASK-KYC.md`. Writing a KYC task from a blank workbench is slow and confusing for many
experts. M9 lets an expert start from something they already have (a document, an interview transcript) or from a
short AI interview, and get a first draft of W01–W05 to check and edit. It also records every tool in the task as an
MCP tool, and every tool response as a recorded MCP call, so RL Gym can replay a task on a standard MCP server.

Owner decisions (27 Sep 2026): tools are recorded as MCP; both an in-app AI interview and transcript upload; uploaded
files are kept privately with the task; build this feature before the tester package.

## 1. Principles

- **The expert is the author.** The AI proposes a draft; the expert checks, edits and confirms every section. Nothing
  drafted is submitted until the expert confirms it, and a human Reviewer still accepts or rejects (CLAUDE.md).
- **Synthetic only.** Whatever the source says, the task that comes out uses invented people, companies, documents and
  identifiers. The source is used for *how the work is done* (steps, checks, pitfalls, typical defects), never for
  *who* it was done for.
- **Nothing the source contains reaches the dataset.** The source file stays private to the task. The Approved Task
  Dataset and RL Gym only ever receive the synthetic task, plus a fingerprint (SHA-256) and the kind of source.
- **Every step is recorded.** Uploads, scans, AI drafts, regenerations and the expert's confirmations are audited.

## 2. Ways to start a task (new screen W00 "How do you want to start?")

| Option | What the expert does | What the AI does |
| --- | --- | --- |
| Blank | Nothing new: W01–W06 as today | Nothing |
| From a document | Uploads a PDF, DOCX or TXT (≤ 10 MB): a procedure they wrote, their own notes on a case pattern, public guidance (e.g. FATF), a training handout | Reads the text and drafts W01–W05 for this task's slot |
| From an interview transcript | Uploads the transcript of an interview someone held with them (PDF, DOCX, TXT, or VTT/SRT captions) | Same as a document; speaker labels are kept as context |
| AI interview | Answers up to 8 short questions in a chat inside the workbench (tap-to-answer where possible): the case, what went wrong, what they checked, which tools, what they concluded, what a junior would miss | Asks follow-ups only where the draft would otherwise be empty, then drafts W01–W05 |

The expert can combine sources (e.g. upload a handout, then answer the interview) before asking for the draft. The
slot's coverage tags and edge case are always part of the brief: the draft must contain the slot's edge case.

Before the first upload the expert confirms: *"This file contains no customer data, and I am allowed to share it. I
understand that names, numbers and details will be replaced with invented ones."*

## 3. Guardrails on uploads

1. File type is sniffed from the bytes (not the name); size ≤ 10 MB; malware scanner interface (stub in v1, as for
   evidence).
2. Text is extracted. Files with under 40 characters of text (e.g. scanned images) are refused with a clear message.
3. The extracted text is scanned with the existing sensitive-data and synthetic-data scanners (IBANs, cards, national
   IDs, passport and company numbers, real emails and phones). Findings are shown to the expert with the lines they
   were found on. The expert can remove the file, or continue; the AI is then told these values must never appear in
   the draft. If a finding is confirmed as real customer data by a Reviewer, the task is quarantined as today and the
   file is deleted.
4. The document is treated as data, never as instructions: the drafting prompt wraps it as quoted material and the
   draft is validated against the KYC schema and sanitised to the allowed tools, enums and IDs. Text in a document
   such as "ignore previous instructions" has no effect beyond appearing as content.
5. The file is stored privately (GCS, same bucket policy as evidence) under the task. Who can open it: the author, the
   Reviewers assigned to the project, and Admins. PMs and RL Gym cannot.

## 4. Drafting

- **Draft all** fills W01–W05 from the sources. **Redraft a section** replaces one section, optionally with an
  instruction ("make the near-match a trustee, not a director"). Drafting never overwrites a section the expert has
  already confirmed unless the expert asks for that section explicitly.
- Every drafted section shows an **AI draft — check and confirm** banner. The expert confirms each section with
  "I've checked this section". Editing a confirmed section keeps it confirmed; redrafting it clears the confirmation.
- W06 gains one automated check: **all drafted sections confirmed by the author**. Submit stays blocked until it
  passes, alongside every existing check (schema, consistency, human gate, synthetic data, similarity, coverage).
- The draft runs in the worker (it can take 20–60 s); the workbench shows progress and can be left and resumed.
  If the model is unavailable or its output fails validation after one retry, the expert is told and can write the
  section by hand; nothing half-valid is saved.
- Model: Claude on Vertex AI (`claude-opus-5`, one retry on `claude-opus-4-8` after a refusal), as for the profile
  chat. Local development and tests use a deterministic mock drafter; tests never call Vertex.

## 5. MCP tool recording

The fixed KYC tool catalog becomes a catalog of **MCP tool definitions**: each tool has an MCP `name`, a
`description` and a JSON Schema `inputSchema` (e.g. `sanctions_pep_screening` takes `{ name, dateOfBirth?,
nationality? }`; `registry_lookup` takes `{ companyNumber?, companyName?, jurisdiction? }`). The catalog is versioned
and part of the task's lineage.

Each tool response the author writes in W03 is a **recorded MCP call**:

| Field | Meaning |
| --- | --- |
| `id` | R1, R2, … (unchanged, referenced by trajectory steps) |
| `request` | `{ "method": "tools/call", "params": { "name": "<tool>", "arguments": { … } } }`, arguments valid against the tool's `inputSchema` |
| `result` | `{ "content": [{ "type": "text", "text": "…" }], "structuredContent": { … }?, "isError": false }` |
| `kind` | CLEAR, HIT, NEAR_MATCH, DATA or ERROR (unchanged; ERROR sets `isError: true`) |

A reference-trajectory tool step points at a recorded call; its arguments must equal the call's arguments. The W04
check "every tool step has a defined response" becomes "every tool step has a recorded call with matching arguments".
The workbench edits arguments through a small form generated from the tool's `inputSchema`, not raw JSON.

Existing tasks (free-text `input`) are migrated on read: the text becomes the tool's main argument (e.g. `name` for
screening), so older tasks stay valid.

**Replay.** Every accepted task exports a replay bundle: the tool definitions plus the recorded calls. A reference
replay server (`tools/mcp-replay`, stdio, official MCP TypeScript SDK) serves `tools/list` from the bundle and answers
`tools/call` with the recorded result for matching arguments (canonical JSON comparison), or an `isError` result
"no recorded response for these arguments". It is a test and reference tool; how RL Gym runs tasks is RL Gym's
concern (interface only, per CLAUDE.md).

## 6. What is recorded (provenance)

| Record | Contents | Where |
| --- | --- | --- |
| Task source | kind (DOCUMENT, TRANSCRIPT), file name, type, size, SHA-256, storage key, scan findings, uploaded by/at | `TaskSource` (private) |
| Interview | questions, answers, redaction notes (sensitive content redacted as in the profile chat) | `TaskInterviewTurn` |
| Draft run | sources used, model and version, prompt version, section(s), status, validation problems, duration | `TaskDraftRun` |
| Expert decisions | per section: drafted at, confirmed at, redrafted, edited after draft (yes/no) | task output `provenance` |
| Audit | `task.source.uploaded`, `task.source.flagged`, `task.draft.requested`, `task.draft.completed`, `task.draft.failed`, `task.section.confirmed`, `task.source.opened` | `AuditEvent` |

The Reviewer's R02 screen gains a **How this task was made** panel: the source kind, a link to open the source file
(opening is audited), the interview transcript, which sections were drafted, and which the author changed after the
draft. The `ApprovedTaskRecord` lineage records the source kind, the source SHA-256 values, the model and prompt
versions and the MCP catalog version, never the source content.

## 7. API (additions)

Author routes follow the existing candidate task routes (`/me/tasks/:id`); reviewer routes follow `/review/tasks/:id`.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /me/tasks/:id/drafting` | Author | Sources (with scan findings), interview state, draft runs, section confirmations |
| `POST /me/tasks/:id/sources` (multipart: `kind`, `declaration`, `file`) | Author | Upload a document or transcript (up to 5 per task); returns scan findings |
| `DELETE /me/tasks/:id/sources/:sourceId` | Author, before submit | Remove a source (the file is deleted; its SHA-256 stays in the audit log) |
| `GET /me/tasks/:id/sources/:sourceId/file` | Author | Download |
| `POST /me/tasks/:id/interview/messages` | Author | Answer the current interview question (`clientMessageId`, `questionId`, `content`, `skip`); returns the next |
| `POST /me/tasks/:id/drafts` | Author | Draft all or one section (`{ section?, instruction? }`); 202 with the run |
| `GET /me/tasks/:id/drafts/:runId` | Author | Draft status, sections written, notes and problems |
| `POST /me/tasks/:id/sections/:section/confirm` | Author | Confirm a drafted section |
| `GET /review/tasks/:id` (field `drafting`) | Project Reviewer, Admin | How the task was made |
| `GET /review/tasks/:id/sources/:sourceId/file` | Project Reviewer, Admin | Open a source (audited as `task.source.opened`) |
| `GET /mcp/kyc/tools` | Admin, PM, Reviewer, RL Gym key | The MCP tool catalog (authors see it in the workbench) |
| `GET /dataset/records/:id/replay` | Admin, RL Gym key | Replay bundle for an accepted KYC task |

All state changes are authorised, idempotent (Idempotency-Key) and audited, as elsewhere.

## 8. Acceptance criteria

- [ ] An expert can start a task blank, from a document, from a transcript or from an AI interview (W00).
- [ ] A PDF, DOCX, TXT or VTT/SRT upload is accepted; other types, oversize files and image-only PDFs are refused
      with a clear message.
- [ ] Likely real identifiers in an upload are shown to the expert before drafting, and never appear in the draft.
- [ ] Draft all fills W01–W05 with a schema-valid synthetic task that contains the slot's edge case; the mock drafter
      does this deterministically in tests.
- [ ] Redrafting one section leaves confirmed sections untouched.
- [ ] Submit is blocked until every drafted section is confirmed, and all existing checks still apply.
- [ ] Instructions hidden in an uploaded document do not change what the drafter does beyond content.
- [ ] Every tool response is stored as an MCP `tools/call` request and result whose arguments validate against the
      tool's `inputSchema`; existing tasks still load and pass checks.
- [ ] A tool step whose arguments do not match its recorded call fails the W04 check.
- [ ] The replay server answers `tools/list` and every recorded `tools/call` of an accepted task, and returns an error
      result for unrecorded arguments.
- [ ] The Reviewer sees how the task was made and can open the source file; the opening is audited; PMs cannot.
- [ ] The Approved Task Dataset record contains provenance (kinds, hashes, model, versions) and no source content.
- [ ] If the model is unavailable, the expert can keep writing by hand and nothing invalid is saved.
