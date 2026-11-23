# From a policy document to approved clauses on a Golden KYC v8 project

For the owner (PM or Admin), 23 Nov 2026. Approving a clause is your decision; Authoring and its AI only suggest.

## Before you start

- **Studio publishes Golden KYC v8 with policy bindings.**
  - Studio sends the bindings inside the template's execution part (`execution.policy_bindings`). Authoring refuses
    unknown top-level fields, so a top-level `policies` part would be rejected.
  - An Admin publishes the v8 draft in Authoring: **Templates → the v8 draft → Publish**.
  - Until the bindings arrive, every clause with a condition shows **Setup needed**. That is shown, never hidden, and
    you can still approve the clause.
- **Policy extraction is set up.** Live extraction is on for this computer, and the LlamaExtract Agentic profile is
  enabled.
- **The policy document.** The existing KYC projects use `00-US-federal-KYC-policy.md` (version 1, sha256
  `a5c0aa26ed48…`). Policy work is per project and cannot be copied, so upload it again on the new project.

## Steps

1. **Create the project.** Console → **Projects → New project**. Choose the **Golden KYC v8** template and fill in the
   rest as before.
2. **Upload the policy.** Open the project's **Policies** tab and add the policy document: **Upload** the file, or
   **Paste text** and then **Save text**.
3. **Extract the rules.**
   - Choose the extraction profile (LlamaExtract Agentic) and press **Use for this project**.
   - Then press **Extract candidates**.
   - Each extracted rule appears in the rules table with its exact quote.
   - The earlier KYC projects got 104 rules from this document. Their jurisdictions are US-Federal, CA, FL, IL, NY and
     TX.
4. **Set up the project's facts (once).**
   - Under **Approved clauses**, press **Start the fact catalog from the template's facts**. This takes the facts the
     v8 template binds, for example `product` and `governing_state`.
   - You can edit it under **Project fact catalog**. Saving makes a new version; earlier versions are kept.
5. **Get suggestions.**
   - Press **Suggest dispositions**. For each rule the AI suggests one of:
     - **Recommended**, either always or with a condition, shown in plain words ("Governing state is CA");
     - **Needs review**, with one question for you;
     - **Outside scope**, quoting the mismatch.
   - Suggestions change nothing. If the AI is unavailable you get a plain message, and you can do every step by hand in
     the rules table.
6. **Decide each rule.**
   - **Conditions:** for a conditional rule you agree with, press **Use this condition**. This saves a new draft of the
     rule with that condition.
   - **Corrections:** edit a rule in the rules table (**Edit**, or **Define with AI**) to fix its wording, actor,
     exceptions or quote.
   - **Exclusions:** exclude rules that don't belong.
7. **Approve.**
   - Tick **Apply to project** on each rule you approve. This is the approval: it records you and the time, and pins
     that exact version.
   - Then press **Publish rule set**. SMEs can cite only published, applied rules.
   - If you change a condition after applying, the rule becomes a draft again: apply it again.
8. **Check.** **Approved clauses** lists each approved clause with "Applies when …" and **Available** or **Setup
   needed**. On the **Benchmark** tab, **Validate** asks Studio whether the environment can run your clauses and edge
   cases.

## What the SME then sees, and what is exported

- **In S4,** the SME cites approved clauses as before. When any clause has a condition, S4 also shows when each clause
  applies, and **Setup needed** where the template doesn't supply a fact yet. SMEs never change a condition.
- **On export,** each task revision carries its cited clauses (`policy_clauses`), pinned exactly as you approved them:
  clause and version, source hash, condition and approval.
- **In the RL Gym,** the agent sees each clause's ID, version, locator, obligation and exceptions, never the condition or
  your approval.
- **Optional quality check:** under **Quality evaluation (PM only)**, save your own private labels for the document and
  compare them with the extraction and the suggestions.
