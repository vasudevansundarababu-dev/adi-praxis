# Corrected KYC proposal fixture (synthetic)

This is Keystone's corrective KYC packet of 12 Nov 2026 (`golden-kyc-reusable-proposal/proposal.json`, proposal SHA-256 `51dc3e8c…`), with only the three edits Praxis asked Keystone to make:

1. `authoring.profile.profileId` is a new form ID, `golden-kyc-reusable-v1`. The ID `golden-kyc-openenv-v2` belongs to published v4 and v5, and form IDs are never reused.
2. `authoring.profile.coverageDimensions` and `authoring.profile.edgeCases` are removed. They are not profile fields, and the template block already carries the empty coverage and edge-case values.
3. `authoring.profile.contract.outputsFrom` is set to `"template_execution"`. The reusable form has no per-task output field; the shared answer schema is `execution.output_schema`.

All content is synthetic. Tests never call Anvil or any live service.
