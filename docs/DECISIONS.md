# ADI Praxis — decision log

Decisions taken while building, where the specs were silent, ambiguous or in conflict. Entries marked
**(chosen by Claude)** were made without a question to the product owner, at their request to finish the remaining
milestones without interruption (26 Sep 2026); each was the option Claude would have recommended. Please review them.

## M0 Foundation (all confirmed by the owner)
- Internal sign-in: email + password (argon2id), server-side sessions.
- Logo: ADI Praxis mark + wordmark with the tagline set as text; mark cropped for icons.
- Append-only enforcement and the UI smoke test deferred to M6; staging pipeline deferred to M8.
- Stripe Identity webhook path: `/integrations/stripe/identity-webhook` (FLOW2 wins).

## M1 Templates (confirmed)
- FLOW 1 offers only the newest published version of each workflow.
- Publishing needs the core fields (name, primary work, verification, human gate, TPT, skills, task mode).
- KYC template seeded with SPEC's example coverage dimensions and edge cases, as a draft.
- Added `PATCH /templates/{id}` (drafts) and `POST /templates/{id}/versions`.

## M2 FLOW 1 (confirmed)
- Demographic taxonomy seeded with standard lists (ISO 3166, ISO 639-1 + CEFR, ISCED, IANA).
- Start and end dates required to submit; working days are Monday to Friday.
- Cancelling is allowed from READY_FOR_STAFFING.

## M3 FLOW 2 core (confirmed)
- Synthetic candidates for local dev; SelectionGate stub until M4.
- No age-band filter (FLOW2 §9 forbids matching on age).
- City radius matched through a Geocoder interface (offline table in v1).
- Scoring definitions (skills 50, experience 20, language 15, availability 15, preferred bonus 10) as documented.
- Missing JD: keep, reuse an identical JD, or rebuild from the frozen snapshot.

## M4a sourcing and candidate access (confirmed)
- M4 split into three slices.
- Google sign-in and Stripe Identity: real adapters ready, mocks locally; production refuses mocks.
- Opportunity: text + PDF/DOCX import with human-confirmed text.
- 18+: attestation at first sign-in + over-18 derived from Stripe's result (date of birth never stored).

## M4b SME profile (confirmed)
- Claude via Vertex AI (`claude-opus-5`, one retry on `claude-opus-4-8` after a refusal).
- Default question policy, editable by the owner.
- Evidence: PDF/DOCX/PNG/JPG up to 10 MB, private storage, malware-scanner stub.
- Sensitive chat content: only a redacted copy is kept.

## M4c selection, onboarding and assignment (confirmed)
- Country of work, languages, time zone and hours are collected in onboarding and feed the matching record.
- A project is STAFFED when enough candidates have **accepted**; declined or expired (7-day) proposals free the slot.
- Contributor terms are Admin-managed and versioned; placeholders are seeded for local dev and block onboarding in production.
- Reviewers are assigned per project.
- **(chosen by Claude)** The suitability assessment runs in the worker on `enrollment.submitted` (Claude on Vertex, or local rules). If the model is unavailable or its output fails validation, the reviewer can retry or review without a recommendation; nothing is decided automatically.
- **(chosen by Claude)** Reviewer endpoints are `/review/enrollments/...` rather than SPEC's placeholder `/applications?status=IN_VALIDATION`, because FLOW2 calls the application an enrollment. SPEC's API table is updated.
- **(chosen by Claude)** A PM "Assign" now sends a proposal (FLOW2 C08). Only acceptance counts towards STAFFED and emits `candidate.assigned`. The stub gate that assigns directly is kept only as a named test double.
- **(chosen by Claude)** At acceptance the server rechecks: account, identity, selection, scope expiry, contribution role, onboarding and current terms, unresolved conflicts, the pinned requirements version, and the concurrent-project limit (accepted work on other projects), under a row lock on the candidate.
- **(chosen by Claude)** Being selected for a pool counts as covering that pool's template skills in the matching record, so the expert can match the project that selected them. Lists from earlier pools are merged, not replaced.
- **(chosen by Claude)** Candidate-declared conflicts block proposals until a Reviewer assigned to that project (or an Admin) resolves them. A reviewer who declares a conflict can no longer see or decide that application.
- **(chosen by Claude)** "Open workbench" issues a single-use handoff token that is valid for 10 minutes and stored only as a hash. Until FLOW 3 (M5), the workbench page confirms the handoff and says tasks will appear when the project starts.
- **(chosen by Claude)** Declining a proposal records an optional reason and has no effect on pool status or matching.
