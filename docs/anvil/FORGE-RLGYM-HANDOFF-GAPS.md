# ADI Forge ↔ RL Gym: what was manual on 18 Nov 2026, and what each side must fix

Status: draft for the owner and RL Gym (Anvil). Written by the QA DevOps session, 18 Nov 2026.
It builds on `docs/anvil/PRAXIS-ANVIL-CONTRACT-FINAL.md` (the agreed contract) and
`docs/integrations/ANVIL-PROJECT-POLICY-V1.md` (the project policy manifest). It changes neither of them.

## 1. Why we did it by hand

On 18 Nov RL Gym asked for one KYC task, the KYC v7 and Marketing template specs, and then the policy, approval
and case-data evidence behind KYC v7. All of it was gathered by hand into local files. There were two separate
reasons for that, and only the first is because the live integration is off.

| Reason | Example | Would live integration fix it? |
|---|---|---|
| **A. Transport.** The live connection is off: QA has no working RL Gym export credential, and RL Gym does not call the ADI Forge template or project-policy APIs. | The export in QA returned "Valid project-scoped export credential required", so every task showed "not validated". Task ZIPs and template specs went over as local files. | **Yes.** The APIs for this already exist on the ADI Forge side (section 3). |
| **B. Content and approvals that were never created, on either side.** | Official federal policy text, reviewed state and charter rules, legal approvals, a qualification receipt, case-review sign-off. KYC v7 holds only a federal *descriptor* (`normative_text_included: false`); all five state modules say `legal_qualification: pending`. | **No.** An integration can move and hash artifacts. It cannot create a legal review or an approval that nobody has made. |

So the owner's understanding is half right. The manual *transport* is because live integration is off. The
*missing information* would still be missing with integration on, unless the gaps below are closed.

## 2. What the evidence showed for KYC v7 (`6d8f9cae-…`, version 7, template_sha256 `c8c4eddf…248a8d`)

| Item | State on 18 Nov |
|---|---|
| Federal policy | Template carries a descriptor only (hash `0c05f57a…`). The official text of 31 CFR 1020.220 was captured by hand from eCFR (hash `07069b75…`); v7 does not reference it. |
| Bank rules GB-01…GB-07 | In the template, hashes verified. Owner-approved operating choices; legal review pending. |
| State policy (CA, NY, TX, FL, IL) and charter applicability | Not available. All pending legal qualification and charter review. |
| Template qualification receipt | **None.** RL Gym never posted one. This is why RL Gym reports `AV_TEMPLATE_NOT_REGISTERED`. |
| Approvals | Only internal ADI Forge project rule-set reviews, by one Admin, on synthetic documents. No independent or legal approval, no expiry, no revocation record. |
| Case dataset | 200 synthetic cases, hash verified. Case-expectation review pending; no rights record beyond "synthetic, generated, no external assets". |
| Task export ↔ policy | The exported task package (`praxis.authored-task-export.v1`) carries the task's own policy citations (`statePolicies`, `contentSha256`). It does **not** carry the project rule-set digest or a link to the project policy manifest. |

## 3. What already exists on the ADI Forge side (no new build needed)

| API | What it gives | Who calls it |
|---|---|---|
| `POST /api/v1/integrations/anvil/templates/validate`, `POST …/proposals`, `GET …/proposals/:id` | Template authorability check, draft creation, and readback of the full template spec with `template_sha256`, part hashes and publication status | RL Gym |
| `POST /api/v1/integrations/anvil/templates/qualifications` | RL Gym records a qualification receipt or a revocation for a published template version hash | RL Gym |
| `GET /api/v1/integrations/anvil/templates/contracts` | Supported schema versions and endpoints | RL Gym |
| `GET /api/v1/projects/:id/anvil/project-policy` and `…/sources/<path>` | The project's published policy manifest and the exact original bytes of each policy source, with hashes | RL Gym |
| Task export (generic package `praxis.authored-task-export.v1`) | Built per approved task; sent to RL Gym's validate and resolve endpoints | ADI Forge calls RL Gym |

## 4. What ADI Forge (authoring side) should fix

1. **Put the policy binding in every task export.** Each task package should name the policy snapshot it was authored
   against: the project rule-set version and digest, and a link (with hash) to the project policy manifest. Today
   RL Gym has to ask for this by hand.
2. **Record real approvals, not only rule reviews.** Add an approval record with: reviewer identity and role,
   independence (not the uploader), scope (policy set × product × state × charter × effective interval), the
   artifact hashes it covers, expiry, and revocation. Show "pending" plainly until one exists. The AI never approves.
3. **Separate synthetic practice documents from public policy.** A project policy document should be marked
   `synthetic` or `official`, with source location and effective dates for official ones. Never bind a synthetic
   document as public policy.
4. **Declare the input contract, never the input data.** A task already says which kind of case it is written for
   (the template's case selector, for example `product = individual`). That is all ADI Forge should state. The
   benchmark dataset, the population drawn from it, its rights and review, and which cases run against which task
   belong to RL Gym. Authors must not see or choose the evaluation population, so tasks cannot be fitted to it
   (owner decision, 18 Nov 2026). Worked examples shown to authors stay separate from any evaluation set.
5. **Show the qualification state before export.** Block or warn on export when the template version has no RL Gym
   qualification receipt, instead of sending tasks that RL Gym will reject as not registered.
6. **Keep exports offline-capable.** Keep a supported "download package" path (what was built by hand on 18 Nov)
   for isolated testing while live integration is off.

## 5. What we expect on the template side (RL Gym / Anvil)

1. **Post the qualification receipt after publication** (`POST …/templates/qualifications`), with receipt ID, receipt
   hash, expiry, and any revocation. Contract section 3, step 5. Without it every export is "not registered".
2. **Policy artifacts by content, not only by descriptor.** For each policy the execution part relies on: id,
   version, SHA-256 of the actual text, source location, effective from and to, and kind (`official_text`,
   `descriptor`, `bank_rule`). Keep the descriptor hash and the text hash as separate fields.
3. **State modules and charter applicability rules**, each with its own version, hash, effective interval and review
   status, and the rule that decides which state and charter applies to a case.
4. **The approvals RL Gym relies on**, with reviewer, scope, expiry and revocation, so ADI Forge can show them and
   never claim one that does not exist.
5. **RL Gym owns input data binding.** RL Gym keeps the dataset, its population, approval and rights record, and binds
   cases to a task at run time using the task's declared case selector. ADI Forge does not need and should not receive
   the evaluation population. (On 18 Nov a population file was built by hand only because RL Gym asked for it; that
   is not the intended flow.)
6. **A project-scoped export credential for QA**, plus its rotation and revocation rules (contract open question 7).
7. **New material means a new version.** Adding policy text, state modules or receipts to a published template
   changes its hash, so it arrives as a successor version (for example v8). A published version is never changed
   in place.

## 6. Order to switch live integration on

1. RL Gym posts the qualification receipt for KYC v7 (and Marketing v2) to QA.
2. RL Gym issues the QA export credential; the owner stores it in Secret Manager.
3. ADI Forge adds the policy binding to the task export (section 4, item 1).
4. Run one KYC and one Marketing export end to end in QA; compare with the files sent by hand on 18 Nov.
5. Then decide which of the remaining items (approvals, state modules) block real benchmark use. Dataset binding
   is RL Gym's (section 5, item 5).
