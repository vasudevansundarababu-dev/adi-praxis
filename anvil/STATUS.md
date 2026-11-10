# Praxis → Anvil: SEED task exports, version 2 (proposed)

_Written by an AI agent (OpenHands) on behalf of the Praxis owner. This branch holds only handoff files, no app code._

**Status: PROPOSED v2, awaiting Anvil validation.** Updated: 2026-11-10 (UTC).
Generated from a scratch database at Praxis branch `feat/policy-snapshot-v2` (`2207de7`).

**v1 is unchanged.** The READY v1 package stays on branch `handoff/anvil-seed-export` (commit `bef6f49`). Keep v1
pinned until v2 is validated.

## What changed from v1
Only the policy sidecars, `tasks/<id>.policy.json`, now `praxis.anvil.policy.v2-proposed`
(`seed-export/policy-snapshot.v2.schema.json`). They separate content identity from database identity:
- each rule's `content_hash` covers what the rule says and the cited document's `sha256` and quote, never database IDs;
- each rule source binds to the document by `document_sha256`;
- database IDs, versions, timestamps and the v1 hash and digest are kept as `provenance` fields.

In `index.json`, each task's `policy_digest` is replaced by `policy_content_hash`. Documents, `*.task.json` and
`policy-import.json` files are byte-identical to v1. Whole sidecar files still differ between reseeds, because
provenance changes.

Hash and canonicalization rules: `anvil/POLICY-SNAPSHOT-V2.md` (SHA-256 of RFC 8785 canonical JSON).

## Example: same content, same hash; changed content, new hash
`seed-export/examples/hash-stability.json`, generated from two separate seeds:
- `R-event_approval` seeded twice gets different database IDs but the same rule hash `fc6c0edfc37e10c1feae3588e9774c913034f786757f791f59d1479d9789620f`, and the same snapshot hash.
- With one sentence added to its requirement, its hash becomes `82e28a3fab7f231a7da00b8931954cfb9ffde320d9a1d8ee2ad2c646fa1ec2a3`, and the snapshot hash changes too.

## Verify
1. `cd anvil && shasum -a 256 -c MANIFEST.sha256`
2. Recompute the rule, change and snapshot `content_hash` values as described in `POLICY-SNAPSHOT-V2.md`. Praxis
   checked all 30 rules, 5 changes and 10 snapshots this way with a separate implementation before publishing.

## Ground rules
Everything is fictional SEED data; tasks are drafts. Formats and the evaluator ID are proposed, not installed Anvil
interfaces. Please report mismatches rather than changing the Praxis contracts.
