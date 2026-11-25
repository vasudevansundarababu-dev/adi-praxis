# KYC Judgment v1 contract files (copied, read-only)

Copied byte for byte from Studio's `contracts/` at commit 1ba841d ("KYC Judgment v1: apply the 25 Nov decisions on
C1-C4's open questions"), so Authoring's tests check its C1 export and C2 catalog against the agreed contracts without
reading another repository. Do not edit these files; copy them again when Studio changes the contracts.

- `schemas/`: policy-library.v1 (C1) and the schemas it references (common, clause-condition, fact-catalog).
- `kyc-judgment-openenv.fact-catalog.json`: the C2 catalog.
- `kyc-judgment.policy-library.json`: Studio's valid C1 fixture (fixture wording, not approved rules).
- `rejected-unreviewed-rule.policy-library.json`: Studio's rejected fixture (an unreviewed version).
- `kyc-judgment-v1.proposal.json`: the joint `praxis.anvil.template-spec.v1` proposal Studio's own builder
  (`utility/integrations/praxis_wire.joint_proposal`, Studio e14116d, template sha256 3219b7b7…) makes from C4's
  `kyc-judgment-v1.template.json`, with no Studio template id or version yet (so the form id is
  `kyc-judgment-v1-none-none`).
