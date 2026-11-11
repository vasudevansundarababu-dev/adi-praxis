# Praxis Project policy sidecar v1

This optional sidecar accompanies unchanged `praxis.anvil.export.v1` Task exports. It does not add fields to the existing strict envelope. Praxis Project maps to Anvil Task Group. Anvil application Project membership remains a separate access boundary.

`schema.json` is generated from `anvil.praxis_policy.ProjectPolicyManifest`. `example.json` and `policies/privacy.txt` are fictional interchange examples; the repeated `a` Task payload digest is deliberately a placeholder. Replace it with the exact real Task export payload digest before importing. `no-policy.example.json` demonstrates optionality. No example is a source review, qualification, evaluator installation or run authorization.

Collections and required identity fields are explicit; empty policy/rule arrays are valid. Each Task binding lists its effective policies and explicit exclusions from Project defaults. It cannot omit a default silently. Policy references are identity plus immutable version. The same identity/version with changed content must conflict in persistence. The parser validates references and hashes; it does not perform persistence/idempotency itself.

Policy source paths are portable relative paths without hidden segments, traversal, backslashes, URI encoding or URLs. Duplicate paths are case-insensitively rejected. Each source is at most 10 MiB, all sources total at most 25 MiB, and the manifest at most 2 MiB. Source bytes are opaque until an isolated extraction path is implemented; declared media types do not establish file safety. Original bytes and extracted display text must remain separate.

`agent_instructions` intentionally projects only applicable `agent_instruction` rule text and stable policy/rule identities. It never projects source files, evaluator-only rules, private case expectations or executable programs. Anvil owns verifier configuration, runtime/credential custody, known-case validation and results. Neither policy text nor source author provenance supplies permission.

QA should validate the JSON Schema and semantic checks: duplicate JSON keys, identity/reference uniqueness, default/exclusion completeness, Project/version binding, exact Task payload binding and exact source bytes. Those semantic checks cannot all be represented by JSON Schema alone. Python contract checks are in `services/backend/tests/test_praxis_policy.py`.
