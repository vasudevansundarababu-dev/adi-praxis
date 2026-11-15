# `praxis.anvil.project_policy_annotations.v1` — PROPOSED

Policy rule annotations for RL Gym. They are an additive, evaluator-side companion to the unchanged
`praxis.anvil.project_policy.v1` manifest (`contracts/anvil/project-policy-v1/`). The status stays **proposed** until
RL Gym agrees; see `docs/anvil/RL-GYM-POLICY-ANNOTATIONS-CHANGE-NOTE.md`.

- `schema.json` is generated from `packages/shared/src/policy-annotations-export.ts`
  (`pnpm --filter @praxis/api exec tsx scripts/export-annotations-schema.ts`). A shared test fails if the two drift.
- Semantic checks that JSON Schema cannot express are in `validateProjectPolicyAnnotations`: one entry per manifest rule,
  no extra or duplicate entries, and `manifest_sha256` plus `source_project` equal to the manifest's.
- Never show this document to agents: it quotes source text and covers evaluator-only rules.
