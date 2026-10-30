# Praxis 1.2 integration test build

Build label: `test-1.2-praxis-harbor-20261030` plus the source commit suffix.

Adds structured synthetic executable authoring to the existing task autosave, submit and independent review journey. Both frozen task schemas are supported: `praxis.anvil.task.v1` for a single decision and `praxis.anvil.task.v2` for sequential decisions, delayed evidence and scalar state projections. Rubric bindings, reference outputs, stable IDs and stage availability are validated at active submission, review, correction and export boundaries. Changed accepted executable content must advance task version and revision while preserving logical task ID.

Administrators can download approved tasks with exact payload/hash and source lineage in an optional `praxis.anvil.export.v1` envelope. The original NDJSON export and historical approved-record hash format are preserved. Private source uploads are not automatically exported. Draft software examples use a separate explicitly labeled download path, never a fabricated approval or rights grant.

The demo setup reuses the existing deployment infrastructure and creates two clearly labeled synthetic READY_FOR_STAFFING projects with unassigned CREATED examples. It is idempotent and audits creation/reuse. Staffing, contributor onboarding, author submission and independent human review remain required for approved dataset publication. No customer project or historical evidence is backfilled. No database migration is introduced.

Validation covers both schemas, hidden/future evidence availability, state projection, references, author save/submit/review/export, lineage envelopes, cross-tenant access denial, correction immutability and draft setup idempotency. Browser smoke includes the new approved-export screen. See the integration evidence report for final counts, deployed image/version identifiers and non-destructive deployed checks.

Live agent/model verification is separate from software oracle/reference qualification and is not claimed by this release. Anvil owns Harbor packaging, isolated execution, cancellation, trajectory/reward inspection and run accounting. Prior Library intake references have not been fully reconciled field by field; see `docs/integrations/PRAXIS-ANVIL.md` for the exact supported increment.
