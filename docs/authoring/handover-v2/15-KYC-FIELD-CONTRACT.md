# 15 KYC exact field contract and checks

Source: packages/shared/src/kyc.ts, packages/shared/src/mcp.ts and current workbench. These are existing canonical names; labels can be friendlier, but adapters must not silently rename them. The earlier draft's parties[]/documents[] and risk_rating are not literal top-level current KycTask properties. Current paths are customerFile.parties[], evidence.documents[] and solution.riskRating. Anvil reference_output is an export mapping, not a license to replace current solution storage.

Fields are optional in the TypeScript draft interface so incomplete work can save. Submission requiredness is enforced by kycChecks/slot rules; the interface's optional marker does not make a complete benchmark field optional. The target template profile must encode those checks rather than invent different requiredness.

| Exact current field(s) | Meaning / author action | Important check |
|---|---|---|
| header.title | Case title. | Required useful assignment name. |
| header.difficulty / estimatedSteps | Complexity and expected work count. | Difficulty 1-5 in workbench; no execution claim. |
| header.jurisdiction / language | Case boundaries. | Supplied scope; not inferred from identifier name. |
| header.coverageTags / edgeCase | Slot classification. | Configured coverage dimensions and assigned edge case. |
| scenario.trigger | Trigger. | NEW_ONBOARDING or PERIODIC_REFRESH. |
| scenario.customerType / product / channel | Customer/service/context category. | Align with evidence and policy applicability. |
| scenario.businessContext | Agent-visible brief. | No private solution; no invented case fact. |
| customerFile.parties[].id | Stable party ID. | Unique; referenced documents/ownership must resolve. |
| parties[].role / kind / name | Role, PERSON/ENTITY and authorised test identity. | Use catalogue role; do not insert real sensitive identity. |
| parties[].dateOfBirth / incorporationDate | Relevant supplied date. | Valid date; correct kind. |
| parties[].nationality / incorporationCountry | Supplied jurisdictional attributes. | Do not assume tax/identity requirements solely from this field. |
| parties[].addresses | Supplied addresses. | Authorised test data; record uncertainty. |
| parties[].identifiers[].type/value | Supplied identifier and value. | Missing stays missing; use approved synthetic formats/permissions. |
| customerFile.ownership[].ownerId / ownedId / percent | Ownership link. | Valid parties and meaningful quantities; not unsupported control inference. |
| customerFile.statedPurpose / expectedActivity | Customer's stated business facts. | Distinguish statement from independently verified evidence. |
| evidence.documents[].id/type/issuer | Record ID, document kind and issuer. | Unique ID; missing issuer stays unknown. |
| documents[].partyId | Party concerned. | Existing party ID. |
| documents[].issueDate / expiryDate | Validity information. | Valid dates; inconsistency/expiry reflected in solution. |
| documents[].fields[].name/value | Extracted record facts. | Faithful authorised source content. |
| documents[].defects | Private evaluator-facing defects. | Exclude from initial agent-visible projection. |
| environment.tools[] | Allowed catalog tool keys. | No unknown action or operational permission. |
| environment.responses[].id/tool | Recorded fixture and tool. | Stable response ID; declared allowed tool. |
| responses[].input / arguments | Summary and MCP argument object. | Arguments satisfy tool schema; legacy input handling preserves compatibility. |
| responses[].kind / response | Recorded result. | CLEAR/HIT/NEAR_MATCH/DATA/ERROR; do not claim live execution. |
| policy.rules[].id/text | Existing task policy free-text representation. | Chat cannot rewrite project authority through this section. Published rule links use policy service metadata. |
| solution.steps[].id/action | Expected step, TOOL or REASONING. | Unique ID; current type does not encode arbitrary decisions/humans/loops. |
| steps[].tool/responseId/input/arguments | Expected recorded call binding. | Must resolve to matching fixture/tool arguments. |
| steps[].expectedResult / why / dependsOn | Expected output, rationale and prerequisites. | Known dependencies, no self-reference; new graph loop contract is separate. |
| solution.findings[].id/description/evidenceRefs/severity | Supported conclusion. | Known evidence references; LOW/MEDIUM/HIGH severity. |
| solution.disposition | Recommended next action. | RECOMMEND_APPROVE, RECOMMEND_REJECT, REQUEST_INFORMATION or ESCALATE. |
| solution.riskRating / riskFactors | Supported risk classification and reasons. | LOW/MEDIUM/HIGH; no automatic real-world risk decision. |
| solution.requestsToCustomer | Expected information requests. | Specific gaps, permitted action boundaries. |
| solution.rationale / humanHandoff | Evidence-grounded explanation and authorised handoff. | Existing human-gate checks for approve/reject/high risk; avoid autonomous finalisation. |
| rubric.criteria[].id/name/weight/passCondition/critical | Observable criterion and score contribution. | Total 100; references and critical semantics require review. |
| rubric.commonErrors[].description/caughtBy | Plausible wrong path and catching criterion. | Valid criterion reference. |
| rubric.acceptableVariations[] | Other valid approaches. | Do not force identical wording or unsupported exclusions. |

## Allowed tools and pick lists

Tools: document_check, registry_lookup, sanctions_pep_screening, adverse_media_search, address_check, risk_calculator, request_info. Tool argument schemas live in the shared MCP registry; do not hard-code a new call schema in the chatbot.

Party roles: CUSTOMER, DIRECTOR, SHAREHOLDER, BENEFICIAL_OWNER, TRUSTEE, SETTLOR, BENEFICIARY, SIGNATORY, OTHER. Response kinds and dispositions are listed above. Free-form labels do not extend a published enum.

## Richer rubric and graph gaps

Current criteria do not directly contain every target field such as partialCredit, zeroCredit, ruleVersionIds or per-role bindings. Current KycStep does not declare actor permissions, human response schemas, branch conditions or bounded loops. Add these through a reviewed schema/version and adapters; never claim that a visual diamond is already a stored executable condition.

## Export mapping

Export adapters explicitly map existing scenario/customer/evidence fields to agent-visible evidence, applicable policy/tool/action boundaries to constraints/actions, ordered supported steps to stages, private solution to reference_output, and criteria to rubric bindings. Exact rights, task IDs, versions and hashes accompany accepted records. If a field/graph construct cannot be represented, executable export fails with a specific diagnostic. Existing dataset export and MCP replay are separate from that qualification.
