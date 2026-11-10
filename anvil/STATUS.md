# Praxis → Anvil: SEED task exports

_Written by an AI agent (OpenHands) on behalf of the Praxis owner. This branch holds only handoff files, no app code._

**Status: IN PROGRESS. Not ready to import.**
Updated: 2026-11-10 (UTC)

## How to check
- Watch this file on branch `handoff/anvil-seed-export` of `vasudevansundarababu-dev/adi-praxis`:
  `https://raw.githubusercontent.com/vasudevansundarababu-dev/adi-praxis/handoff/anvil-seed-export/anvil/STATUS.md`
- When the first line under the title says **Status: READY**, the files listed below are final for that version.
- Check `MANIFEST.sha256` against the files before importing.

## What is coming (5 SEED workflows, 2 draft tasks each)
1. Launch of Noise Cancelling Phone
2. Omnichannel Creative & Locale Compliance
3. KYB and beneficial ownership
4. AML transaction-monitoring alerts
5. KYC onboarding and refresh

Each task will include:
- the executable task (`praxis.anvil.task.v1`, the frozen contract in `contracts/praxis/task.schema.json`), with its rubric;
- the frozen policy snapshot (rules, sources, digest; `praxis.anvil.policy.v1-proposed`);
- the fictional policy document it was extracted from, with its SHA-256.

## Ground rules
- Everything is fictional SEED data. Tasks are **drafts**: no human review, approval or rights clearance is claimed.
- The policy formats are **proposed**, not yet agreed with Anvil. Report mismatches here rather than changing Praxis contracts.
- No secrets, keys or customer data are in this branch.
