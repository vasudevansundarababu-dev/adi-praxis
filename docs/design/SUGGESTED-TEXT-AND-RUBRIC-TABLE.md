# Suggested text for every field, and a rubric table (approved by the owner, 15 Nov 2026)

Mockup: [`mockups/suggested-text-and-rubric-table.html`](mockups/suggested-text-and-rubric-table.html). It has both
templates (KYC v7 Custodian task, Marketing VEYRA) and three screens: Suggested text, Rubric table, Decisions.
The owner accepted all seven recommendations below on 15 Nov 2026 (logged in `docs/DECISIONS.md`).

## What the owner asked (15–16 Nov 2026)
1. "First provide Suggestion as text for every input box … He would provide his consent that whats is been suggested
   represents actual flow … He can change it." For Marketing and KYC.
2. "He does not understand the rubrics … May be a table with a score … When you edit you show existing screen."

## Design
**Suggested text** (`apps/candidate/components/work/profile-editor.tsx`)
- Every empty field (free text, repeated rows such as S2 evidence and S5 steps, pick lists) shows a labelled
  **Suggested text** box: *Use this text*, *Edit, then use*, *Suggest another*, *I'll write my own*.
- A filled field shows where its text came from: *Written by you*, *Suggested · used as it is*, *Suggested · edited by you*.
- *Use all suggestions in this section* fills the empty fields of one section.
- Each section ends with: "I've read every field in Sx, and it describes how this work is actually done."
  Changing any field in that section clears the tick. Submit needs every section confirmed.
- S8 shows the split (written / used as is / edited) to the author and the reviewer, and the revised declaration.
- Suggestions come from the template, the task slot, the project's published rules and the author's own text only;
  never from case snapshots. Brief fields (business context, deliverable) pass the existing answer-leak and
  real-data checks before they are shown.

**Rubric table** (`apps/candidate/components/work/rubric-editor.tsx`)
- S7 opens as a table: what is assessed, one column per score level (KYC: 5 / 2 / 0; Marketing: 4 / 2 / 0, with
  3 and 1 optional in the editor), weight, critical, Edit. Marketing rows are grouped A–G with each group's total.
- A total-weight meter, a critical count, and "How the score works" with a worked example.
- Clicking a row or Edit opens today's criterion editor (side panel; same fields and save).
- D14: only what blocks Submit is shown, in red, at the top; recommendations are collapsed with a count; internal
  notes live inside the criterion editor. D16: a criterion that is not in the template always shows **Remove**;
  with a fixed set, adding a new criterion is not offered.

## Decisions (all accepted as recommended)
1. **Human-authorship declaration.** Today's terms say "I will not use the built-in assistant or an external LLM to
   generate answers", and Submit refuses after an earlier AI draft (`PRIOR_AI_DRAFT`, `apps/api/src/routes/conversation.ts`).
   *Recommend:* new wording ("I wrote it or I read, changed where needed and accepted every suggested text in it. It
   describes how this work is really done."), per-field provenance with the suggestion version, and replace the
   `PRIOR_AI_DRAFT` block with "every section confirmed after its last change". New `AUTHORSHIP_VERSION`.
2. **RL Gym and provenance.** The export contract (approved 12 Nov) has no provenance. *Recommend:* keep it in
   ADI Forge (audit log + reviewer view) and ask RL Gym whether they want an optional flag in a later version.
3. **Consent granularity.** *Recommend:* per section, plus the final declaration; using a suggestion is audited per field.
4. **"Use all suggestions in this section".** *Recommend:* keep it; section confirmation still required; reviewer sees
   the counts. A human reviewer still accepts or rejects the task.
5. **Model and flag.** *Recommend:* the Gemini model QA already uses for the profile chat, behind
   `FIELD_SUGGESTIONS_ENABLED`, mocked in tests.
6. **Which fields.** *Recommend:* all of them, both templates; S4 policy identities and S7 IDs/weights/evaluators stay
   filled from the template or project as today.
7. **Rubric table.** *Recommend:* default S7 view for both templates, folding in D14 and D16.

Non-negotiables kept: AI only suggests; the author accepts each text and a human Reviewer decides the task. No real
customer data. No "ADI-Labs", "Praxis" or "Anvil" in user-facing text.

## Build (done 15 Nov 2026, flag `FIELD_SUGGESTIONS_ENABLED`)
1. Shared: suggestion request/response types, provenance per field, section-confirmation state, new authorship terms
   version (`packages/shared`).
2. API: `POST /me/tasks/:id/suggestions` (section or field; template + slot + published rules + author text; leak and
   real-data guards; audited; idempotent), provenance saved with the task, Submit check "every section confirmed",
   `PRIOR_AI_DRAFT` replaced. Mock model in tests.
3. Candidate: suggestion boxes and provenance pills in `profile-editor.tsx`; section confirmation; S8 summary.
4. Candidate: rubric table view in `rubric-editor.tsx`, editor in a side panel, blockers-only banner (D14), Remove for
   non-template criteria (D16).
5. Reviewer page: show provenance split and which fields came from suggestions.
6. Tests: unit (guards, provenance, confirmation cleared on change, D16 remove), API (audit, idempotency, submit
   check), Playwright on KYC v7 and VEYRA (use a suggestion, edit one, confirm sections, submit; rubric table edit and
   remove C1).
