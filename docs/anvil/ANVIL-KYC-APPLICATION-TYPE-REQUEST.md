# Anvil request: KYC application type as the workflow selector (received 15 Nov 2026)

Received from Anvil through the owner. Status: **noted, not agreed**. The owner has not given final approval, and
Praxis changes nothing in the template or the export contract until the new contract is agreed with Keystone.

## The request (as received)

> Application type selects the reusable workflow. Each application's governing state selects its applicable common
> and state policies. A Joint workflow must handle both California and New York applications; an empty coverage cell
> must never skip an application.

Anvil asks Praxis to confirm the smallest versioned authoring and export change:

- application type, required;
- example state, optional, used only for coverage;
- an export selector generated automatically from the application type;
- an explicit compatibility discriminator, so existing v6 exports keep their original meaning.

Anvil also asks Praxis to:

- preserve existing authored content and review history;
- provide one actual reviewed Joint-task export for compatibility testing;
- not publish or replace the existing template until the new contract is agreed;
- keep Staging and Production on hold.

## Praxis reading (Claude, 15 Nov 2026)

**Today:** KYC v6 creates one task per value of a required pick list, `S1.governingState` (CA, NY, TX, FL, IL),
through the template's `caseSelector`. The export package (`praxis.authored-task-export.v1`) carries no selector
field.

**Smallest change on each side:**

1. **Template (Keystone writes, as a new version, v7):**
   - `caseSelector.source` becomes a required application-type pick list (for example Single, Joint, Minor,
     Custodian), so there is one task per application type;
   - the governing state becomes an optional "example state" field.
   - Praxis's slot code is already generic, so no selection code changes. v6 stays published and unchanged.
2. **Export (Praxis):**
   - add a selector block derived from the template's `caseSelector`: field and value, for example
     `application_type: "joint"`;
   - add a discriminator naming the selection basis, so a v6 package (no block, or basis `governing_state`) keeps its
     meaning.
   - The change is additive and versioned, and covered by tests. Existing packages and receipts are untouched.
3. **Praxis screens:** the Dashboard coverage and the task names follow the template's selector (application type
   for v7, state for v6). That replaces the "coverage by state" wording in the MVP1 design for v7 projects.
4. **History:** authored tasks, reviews and approved records from v6 stay as they are (append-only).

**Not possible yet:** a real reviewed Joint-task export needs v7 published in QA, an SME to author the task, a
review, and Anvil's export side switched on. It comes after this development, not before.

## Open questions for Keystone

- The exact application-type values and labels.
- The discriminator's name and values, and where it sits in the package (top level or per task).
- Whether the example state also stays in the export for coverage reporting.
- Whether v7 keeps every other v6 section unchanged.
