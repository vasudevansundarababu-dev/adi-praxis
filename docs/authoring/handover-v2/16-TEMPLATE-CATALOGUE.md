# 16 Template coverage and common screen generation

The local instruction catalogue contains fourteen templates. This is the coverage set for reusable authoring UI tests, not proof that fourteen fully typed/executable workflows already exist. KYC is the concrete typed pilot; most other current forms remain generic. Multi-agent KYB is a design reference; all actual published agent modes must be confirmed in template configuration.

Each template spec retains six chapters: Task anatomy; Synthetic/test-data rules; Expected solution and rubric; Author workbench; Automated checks and review; Example/acceptance/open questions. The editable domain guides in template-instructions are included as appendices. Their labels/outcome examples must be reconciled with approved schema before implementation.

## Required reusable profile per template

Define exact field names/types/labels, requiredness and dependencies; pick-list catalogues; authorised test-data restrictions; tool schemas/fixtures or none; reference shape; rubric/critical semantics; deterministic checks; human-review wording; environment capability; Anvil adapter mapping; section examples and field help. Register it once. Classic renders controls; Chatbot reads the same profile and proposes only allowed field updates. Neither LLM-generated arbitrary UI nor a generic free-text form is a substitute for this profile.

## Catalogue listing

### DM01 - Q4 Global Paid Search Query Clustering

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: query dataset, product brief, locale and channel constraints. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: clusters, query assignments, intent labels, exclusions, ambiguous queries, rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: intent: informational, commercial, transactional, navigational, unclear; assignment: assigned, excluded, needs_review. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### DM02 - Omnichannel Creative and Locale Compliance

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: creative assets, substantiated claims, channel specifications, locale requirements. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: asset-by-locale findings, claim evidence, proposed corrections, release recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: finding: compliant, noncompliant, insufficient_evidence, not_applicable; recommendation: ready_for_review, revise, hold. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK03 - Adverse Media Review

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: customer identifiers, supplied media extracts, dates and source metadata. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: identity match, source reliability, allegations versus established facts, relevance, recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: match: confirmed, possible, false_positive, unresolved; recommendation: close, escalate, request_information. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK04 - Audit and Evidence Preparation

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: audit request, control descriptions, evidence inventory and review period. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: evidence index, request mapping, provenance, gaps, preparation memo. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: evidence: available, missing, incomplete, conflicting, out_of_scope. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK05 - Communications Surveillance

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: synthetic communications, participant roles, timestamps and surveillance policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: relevant excerpts, contextual findings, policy mapping, escalation recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: disposition: close, escalate, request_context; finding: supported, unsupported, inconclusive. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK06 - Compliance Monitoring

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: defined monitoring scope, records, obligations and monitoring period. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: obligation-to-evidence assessment, exceptions, severity, proposed follow-up. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: result: compliant, noncompliant, insufficient_evidence, not_applicable; severity: low, medium, high, critical, undetermined. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK09 - Customer Risk Rating

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: customer profile, risk factors, evidence and versioned rating methodology. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: factor assessments, calculation where supported, proposed risk, overrides, rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: risk: low, medium, high, undetermined; override: none, proposed_increase, proposed_decrease. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK10 - Enhanced Due Diligence

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: high-risk case, source-of-funds/wealth evidence, ownership and adverse findings. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: enhanced checks, evidence gaps, risk assessment, recommendation, human handoff. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: recommendation: proceed_for_approval, request_information, escalate, recommend_decline; evidence: verified, unverified, conflicting, missing. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK12 - Issue and Remediation Tracking

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: issue records, action plans, owner records, due dates and closure evidence. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: issue status, linked evidence, overdue assessment, closure recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: status: open, in_progress, pending_validation, closed, reopened; recommendation: retain_open, request_evidence, recommend_closure. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK13 - KYB and Beneficial Ownership

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: entity records, ownership graph, ownership percentages, control evidence and applicable policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: entity verification, ownership traversal, beneficial owners and controllers, gaps, recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: party_role: legal_entity, shareholder, beneficial_owner, controller, authorised_signatory, trustee, settlor, beneficiary, other; disposition: complete_for_review, request_information, escalate. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK14 - KYC Onboarding and Refresh

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: customer case, identity evidence, prior KYC and applicable dated policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: steps, findings, disposition, risk_rating, rationale, evidence citations, human_handoff. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the existing KYC canonical pick lists: scenario.trigger is NEW_ONBOARDING or PERIODIC_REFRESH; solution.disposition is RECOMMEND_APPROVE, RECOMMEND_REJECT, REQUEST_INFORMATION or ESCALATE; solution.riskRating is LOW, MEDIUM or HIGH. Party roles and response kinds follow packages/shared/src/kyc.ts. These canonical values supersede provisional wording in earlier guide examples; do not silently add enum values.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK15 - AML Transaction-Monitoring Alerts

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: alert, synthetic transactions, customer profile, scenario parameters and historical context. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: transaction analysis, expected versus observed activity, gaps, alert disposition, escalation rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: disposition: close_with_rationale, request_information, escalate_for_investigation; suspicion: not_established, potential, unresolved. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### BK11 - Fraud-Risk and Compliance Handoffs

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: fraud alert, transaction records, case timeline, roles and escalation policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: facts, fraud indicators, compliance concerns, handoff package, recommendation and rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: handoff: fraud, compliance, joint_review; recommendation: request_information, escalate, close_with_rationale. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

### DM03 - Noise Cancelling Headphones Launch

Common UI: Classic schema renderer + shared Chatbot + instructions + horizontal flow + agent projection + common checks/review.

**2. Case inputs and evidence** Input means the material the agent can inspect: product brief, test evidence, audience, channel requirements, budget and launch dates. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised.

**5. Expected work and result** Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: launch plan, channel assets, substantiated claims, budget allocation, measurement plan and release recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs.

**6. Allowed outcomes and values** Use the template pick lists rather than new labels. Current proposed labels: claim_status: supported, unsupported, needs_review; release: ready_for_review, revise, hold. If no choice fits, flag it for review; do not silently invent an enum or policy threshold.

Implementation gate: domain owner confirms exact schema/pick lists and published agent mode; developer supplies tests and executable adapter capability. Do not mark full Anvil readiness from this help text.

## Registration acceptance

Each profile renders all applicable fields, shows examples/help, rejects unsupported enums, preserves data during editor switches, scopes approved rules, projects agent visibility and runs its registered checks. The shared bot must not force KYC-specific names into unrelated templates. A template with only a generic pass-through validator is explicitly unqualified for domain completeness until its checks and reference/rubric bindings exist.
