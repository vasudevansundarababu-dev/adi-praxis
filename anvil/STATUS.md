# Praxis → Anvil: SEED task exports

_Written by an AI agent (OpenHands) on behalf of the Praxis owner. This branch holds only handoff files, no app code._

**Status: READY (version 1, Praxis main `79a8a9e`).**
Updated: 2026-11-10 (UTC)

## Where
Folder `anvil/seed-export/` on branch `handoff/anvil-seed-export` of `vasudevansundarababu-dev/adi-praxis`.
Start with `anvil/seed-export/index.json`. Before importing, check the files against `anvil/MANIFEST.sha256`
(`cd anvil && shasum -a 256 -c MANIFEST.sha256`).

## What is in it: 5 SEED workflows × 2 draft tasks = 10 tasks
| Folder | Workflow | Tasks | Rubric source |
|---|---|---|---|
| `phone-launch` | Launch of Noise Cancelling Phone | SEED-PHONE-001, -002 | catalog blueprint milestones |
| `locale-compliance` | Omnichannel Creative & Locale Compliance | SEED-LOCALE-001, -002 | **fictional SEED rubric** (no blueprint yet) |
| `kyb-review` | KYB and beneficial ownership | SEED-KYB-001, -002 | catalog blueprint milestones |
| `aml-alerts` | AML transaction-monitoring alerts | SEED-AML-001, -002 | catalog blueprint milestones |
| `kyc-onboarding` | KYC onboarding and refresh | SEED-KYC-001, -002 | **fictional SEED rubric** (KYC uses its own task definition) |

Per workflow folder:
- `tasks/<id>.task.json`: executable task, `praxis.anvil.task.v1` (frozen contract, `task.schema.json`). Includes the
  rubric (weights sum to 10000 bps), hard-failure constraints and a reference output.
- `tasks/<id>.policy.json`: frozen policy snapshot (`praxis.anvil.policy.v1-proposed`, `policy-snapshot.schema.json`):
  rules with source quotes and document hashes, task changes, rubric version and digest. Its `task_id` is the Praxis
  task-instance UUID; `index.json` maps it to the `SEED-…` task ID.
- `policy-import.json`: the task group in the owner's proposed Anvil import format
  (`anvil.policy-import.v1-proposed`, `policy-import.schema.json`).
- `documents/policy.md`: the fictional policy the rules came from. `documents/unpublished-conflict-1.md` (Phone launch
  only) is a deliberately conflicting sheet that was **not** published; it shows the conflict case.

## How rules link to tasks
A task constraint with ID `policy-<key>` enforces published rule `R-<key>` (for example `policy-weekly_spend_cap` →
`R-weekly_spend_cap`). In `policy-import.json` those rules name the proposed evaluator `anvil.task-constraint-binding`,
which checks that constraint on `output.json`. Rules without a linked constraint (KYB `R-ubo_25`, KYC
`R-address_recency`) carry no evaluator, so they should show as **Needs evaluator / Not evaluated**, never Pass. Each
project's first task also has one task-specific rule change.

## Checks run before publishing (all passed)
- 10/10 tasks valid against `task.schema.json` and Praxis's own contract check; 10/10 snapshots valid against
  `policy-snapshot.schema.json`; 5/5 manifests valid against `policy-import.schema.json`.
- Every reference output satisfies its own constraints and rubric; 23/23 deliberately rule-breaking outputs are caught.
- Every rule source hash matches the published document; no verifier-only text is in agent-visible fields; no secrets.

## Ground rules
- Everything is fictional SEED data. Tasks are **drafts**: no human review, approval or rights clearance is claimed.
- The policy formats and the evaluator ID are **proposed**, not installed Anvil interfaces. Please report mismatches
  rather than changing the Praxis contracts. Real seed policy documents will replace these later as a new version.
