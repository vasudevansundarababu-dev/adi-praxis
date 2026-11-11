/** Versioned template help content; not task approval. */
export const TEMPLATE_INSTRUCTIONS = [
  {
    "id": "DM01",
    "name": "Q4 Global Paid Search Query Clustering",
    "slug": "q4-global-paid-search-query-clustering",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: query dataset, product brief, locale and channel constraints. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: clusters, query assignments, intent labels, exclusions, ambiguous queries, rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: intent: informational, commercial, transactional, navigational, unclear; assignment: assigned, excluded, needs_review. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: query dataset, product brief, locale and channel constraints. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: clusters, query assignments, intent labels, exclusions, ambiguous queries, rationale. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Cluster / query assignment",
        "text": "Group queries by shared intent; assign each query ID to a cluster or explain exclusion."
      },
      {
        "title": "Intent / ambiguity",
        "text": "Choose a permitted intent and identify queries that require clarification rather than forcing an unsupported label."
      }
    ]
  },
  {
    "id": "DM02",
    "name": "Omnichannel Creative and Locale Compliance",
    "slug": "omnichannel-creative-and-locale-compliance",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: creative assets, substantiated claims, channel specifications, locale requirements. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: asset-by-locale findings, claim evidence, proposed corrections, release recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: finding: compliant, noncompliant, insufficient_evidence, not_applicable; recommendation: ready_for_review, revise, hold. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: creative assets, substantiated claims, channel specifications, locale requirements. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: asset-by-locale findings, claim evidence, proposed corrections, release recommendation. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Asset / locale / channel",
        "text": "Identify the exact creative item and its target market and channel."
      },
      {
        "title": "Claim evidence / release recommendation",
        "text": "Link each claim to supporting material; recommend ready for review, revision or hold using the allowed choices."
      }
    ]
  },
  {
    "id": "BK03",
    "name": "Adverse Media Review",
    "slug": "adverse-media-review",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: customer identifiers, supplied media extracts, dates and source metadata. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: identity match, source reliability, allegations versus established facts, relevance, recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: match: confirmed, possible, false_positive, unresolved; recommendation: close, escalate, request_information. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: customer identifiers, supplied media extracts, dates and source metadata. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: identity match, source reliability, allegations versus established facts, relevance, recommendation. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Identity match",
        "text": "Assess whether the media subject is the customer; names alone do not establish a match."
      },
      {
        "title": "Source reliability / allegation status",
        "text": "Evaluate the source and separate allegations from established facts; explain relevance and uncertainty."
      }
    ]
  },
  {
    "id": "BK04",
    "name": "Audit and Evidence Preparation",
    "slug": "audit-and-evidence-preparation",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: audit request, control descriptions, evidence inventory and review period. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: evidence index, request mapping, provenance, gaps, preparation memo. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: evidence: available, missing, incomplete, conflicting, out_of_scope. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: audit request, control descriptions, evidence inventory and review period. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: evidence index, request mapping, provenance, gaps, preparation memo. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Request mapping / evidence index",
        "text": "Show which evidence addresses each audit request, including location, period and provenance."
      },
      {
        "title": "Gap / preparation memo",
        "text": "Describe missing or conflicting material and the action needed; summarise what the pack does and does not support."
      }
    ]
  },
  {
    "id": "BK05",
    "name": "Communications Surveillance",
    "slug": "communications-surveillance",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: synthetic communications, participant roles, timestamps and surveillance policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: relevant excerpts, contextual findings, policy mapping, escalation recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: disposition: close, escalate, request_context; finding: supported, unsupported, inconclusive. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: synthetic communications, participant roles, timestamps and surveillance policy. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: relevant excerpts, contextual findings, policy mapping, escalation recommendation. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Excerpt / context",
        "text": "Quote the relevant communication and consider its surrounding messages, speakers and timing."
      },
      {
        "title": "Policy concern / disposition",
        "text": "Explain the supported concern and choose closure, context request or escalation under the supplied policy."
      }
    ]
  },
  {
    "id": "BK06",
    "name": "Compliance Monitoring",
    "slug": "compliance-monitoring",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: defined monitoring scope, records, obligations and monitoring period. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: obligation-to-evidence assessment, exceptions, severity, proposed follow-up. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: result: compliant, noncompliant, insufficient_evidence, not_applicable; severity: low, medium, high, critical, undetermined. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: defined monitoring scope, records, obligations and monitoring period. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: obligation-to-evidence assessment, exceptions, severity, proposed follow-up. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Obligation / monitoring result",
        "text": "Identify the applicable requirement and whether evidence supports compliance, an exception or insufficient evidence."
      },
      {
        "title": "Severity / follow-up",
        "text": "Use the approved severity scale; explain impact and required corrective action without inventing thresholds."
      }
    ]
  },
  {
    "id": "BK09",
    "name": "Customer Risk Rating",
    "slug": "customer-risk-rating",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: customer profile, risk factors, evidence and versioned rating methodology. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: factor assessments, calculation where supported, proposed risk, overrides, rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: risk: low, medium, high, undetermined; override: none, proposed_increase, proposed_decrease. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: customer profile, risk factors, evidence and versioned rating methodology. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: factor assessments, calculation where supported, proposed risk, overrides, rationale. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Risk factors / calculation",
        "text": "Record each methodology input, its evidence and the calculation. Keep unknown values explicit."
      },
      {
        "title": "Proposed risk / override",
        "text": "Choose the permitted rating where supported. Explain any proposed override and required approval; do not invent a factor."
      }
    ]
  },
  {
    "id": "BK10",
    "name": "Enhanced Due Diligence",
    "slug": "enhanced-due-diligence",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: high-risk case, source-of-funds/wealth evidence, ownership and adverse findings. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: enhanced checks, evidence gaps, risk assessment, recommendation, human handoff. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: recommendation: proceed_for_approval, request_information, escalate, recommend_decline; evidence: verified, unverified, conflicting, missing. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: high-risk case, source-of-funds/wealth evidence, ownership and adverse findings. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: enhanced checks, evidence gaps, risk assessment, recommendation, human handoff. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Source of funds / source of wealth",
        "text": "Explain the origin of the relevant money and the wider accumulation of wealth using the supplied supporting evidence."
      },
      {
        "title": "Enhanced checks / recommendation",
        "text": "Document additional checks and gaps, then state the evidence-supported recommendation and escalation needs."
      }
    ]
  },
  {
    "id": "BK12",
    "name": "Issue and Remediation Tracking",
    "slug": "issue-and-remediation-tracking",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: issue records, action plans, owner records, due dates and closure evidence. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: issue status, linked evidence, overdue assessment, closure recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: status: open, in_progress, pending_validation, closed, reopened; recommendation: retain_open, request_evidence, recommend_closure. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: issue records, action plans, owner records, due dates and closure evidence. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: issue status, linked evidence, overdue assessment, closure recommendation. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Issue / action / owner / due date",
        "text": "Identify the problem, planned remedy, accountable owner and target date."
      },
      {
        "title": "Closure evidence / status",
        "text": "Distinguish implementation from effectiveness testing. Use the allowed status and explain why closure is or is not supported."
      }
    ]
  },
  {
    "id": "BK13",
    "name": "KYB and Beneficial Ownership",
    "slug": "kyb-and-beneficial-ownership",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: entity records, ownership graph, ownership percentages, control evidence and applicable policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: entity verification, ownership traversal, beneficial owners and controllers, gaps, recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: party_role: legal_entity, shareholder, beneficial_owner, controller, authorised_signatory, trustee, settlor, beneficiary, other; disposition: complete_for_review, request_information, escalate. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: entity records, ownership graph, ownership percentages, control evidence and applicable policy. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: entity verification, ownership traversal, beneficial owners and controllers, gaps, recommendation. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Party role / ownership percentage",
        "text": "Identify entities, owners and controllers; record the source-backed share at each link."
      },
      {
        "title": "Ownership traversal / verification status",
        "text": "Trace through intermediaries to the relevant persons under the approved method. Mark stale, missing or conflicting links explicitly."
      }
    ]
  },
  {
    "id": "BK14",
    "name": "KYC Onboarding and Refresh",
    "slug": "kyc-onboarding-and-refresh",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: customer case, identity evidence, prior KYC and applicable dated policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: steps, findings, disposition, risk_rating, rationale, evidence citations, human_handoff. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: trigger: onboarding, periodic_refresh, event_triggered_update; disposition: complete_for_review, request_information, escalate, recommend_decline; risk: low, medium, high, undetermined; party_role: customer, representative, authorised_signatory, other. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: customer case, identity evidence, prior KYC and applicable dated policy. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: steps, findings, disposition, risk_rating, rationale, evidence citations, human_handoff. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Disposition",
        "text": "Select the permitted completion-for-review, information request, escalation or decline recommendation. It is a recommendation, not an account action."
      },
      {
        "title": "Risk rating / party role",
        "text": "Use the approved rating or undetermined where evidence is insufficient; distinguish customer, representative and signatory roles."
      }
    ]
  },
  {
    "id": "BK15",
    "name": "AML Transaction-Monitoring Alerts",
    "slug": "aml-transaction-monitoring-alerts",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: alert, synthetic transactions, customer profile, scenario parameters and historical context. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: transaction analysis, expected versus observed activity, gaps, alert disposition, escalation rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: disposition: close_with_rationale, request_information, escalate_for_investigation; suspicion: not_established, potential, unresolved. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: alert, synthetic transactions, customer profile, scenario parameters and historical context. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: transaction analysis, expected versus observed activity, gaps, alert disposition, escalation rationale. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Expected / observed activity",
        "text": "Compare the customer profile with the transaction amounts, timing, counterparties and pattern supplied in the case."
      },
      {
        "title": "Alert disposition / suspicion",
        "text": "Choose an allowed next step and explain whether concern is potential or unresolved. An alert does not establish wrongdoing."
      }
    ]
  },
  {
    "id": "BK11",
    "name": "Fraud-Risk and Compliance Handoffs",
    "slug": "fraud-risk-and-compliance-handoffs",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: fraud alert, transaction records, case timeline, roles and escalation policy. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: facts, fraud indicators, compliance concerns, handoff package, recommendation and rationale. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: handoff: fraud, compliance, joint_review; recommendation: request_information, escalate, close_with_rationale. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: fraud alert, transaction records, case timeline, roles and escalation policy. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: facts, fraud indicators, compliance concerns, handoff package, recommendation and rationale. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Fraud indicator / compliance concern",
        "text": "Separate evidence of possible fraud from compliance obligations; explain each without treating suspicion as proof."
      },
      {
        "title": "Handoff destination / package",
        "text": "Identify the authorised receiving team and supply facts, evidence IDs, timeline, open questions and required next action."
      }
    ]
  },
  {
    "id": "DM03",
    "name": "Noise Cancelling Headphones Launch",
    "slug": "noise-cancelling-headphones-launch",
    "fields": [
      {
        "title": "1. Assignment and brief",
        "text": "Task title identifies this case. Trigger explains why work is needed. Scope, date and locale set the boundaries. Describe the decision or deliverable the benchmark agent must produce; do not include your answer in the agent brief."
      },
      {
        "title": "2. Case inputs and evidence",
        "text": "Input means the material the agent can inspect: product brief, test evidence, audience, channel requirements, budget and launch dates. Give each item a stable ID, source and relevant date. Record gaps explicitly. Use authorised test data; exclude real personal identifiers and confidential material unless expressly authorised."
      },
      {
        "title": "3. Tools and recorded responses",
        "text": "A tool is an allowed action; arguments are its inputs; recorded response is what that call returns. Link the response to the matching call and evidence ID. Select none for a pure structured decision. Do not claim a live check occurred."
      },
      {
        "title": "4. Policy applicability",
        "text": "Choose an approved project rule, its version and source page/section. Explain which step it applies to, why and any exception. Distinguish public requirements from bank/customer policy. Additional documents need authorised review before their rules become active."
      },
      {
        "title": "5. Expected work and result",
        "text": "Steps describe the work the agent should do; findings state supported conclusions. The expected deliverable for this template is: launch plan, channel assets, substantiated claims, budget allocation, measurement plan and release recommendation. Explain the rationale and unresolved issues. Keep reference answers separate from agent-visible inputs."
      },
      {
        "title": "6. Allowed outcomes and values",
        "text": "Use the template pick lists rather than new labels. Current proposed labels: claim_status: supported, unsupported, needs_review; release: ready_for_review, revise, hold. If no choice fits, flag it for review; do not silently invent an enum or policy threshold."
      },
      {
        "title": "7. Grading criteria",
        "text": "For each criterion supply what is assessed, observable pass/partial/fail conditions, weight and evidence or rule link. Mark critical errors, common mistakes and acceptable alternatives. Where this template requires percentage weights, use a total of 100."
      },
      {
        "title": "8. Final checks and submission",
        "text": "Confirm coordinated changes, inspect the investigation map and View as agent, resolve blockers and declare your own work. Submit sends this revision for review. Rework returns it to Authoring with comments; correct it and submit again."
      }
    ],
    "reviews": [
      {
        "title": "1. Brief and scope",
        "text": "Can another agent understand the task without verbal explanation? Confirm the requested work, date, boundaries and required outputs. Check that the brief does not reveal the reference answer."
      },
      {
        "title": "2. Evidence quality",
        "text": "Open the supplied inputs: product brief, test evidence, audience, channel requirements, budget and launch dates. Check IDs, dates, provenance, permissions and internal consistency. Missing evidence must remain missing; it cannot be replaced by an assumption."
      },
      {
        "title": "3. Tool behaviour",
        "text": "Check allowed tools, input fields and every recorded response. Responses must match their calls and case. Confirm that the no-tool option is appropriate where selected."
      },
      {
        "title": "4. Policy and added documents",
        "text": "Review document relevance and policy status, not just its filename. Check authority, scope, version, source locator and exceptions. Approve or return additional bank/customer policy documents through the policy process; do not promote unreviewed rules."
      },
      {
        "title": "5. Reference solution",
        "text": "Check the steps and supported conclusions against the evidence. Required result: launch plan, channel assets, substantiated claims, budget allocation, measurement plan and release recommendation. Preserve reasonable uncertainty and acceptable alternative approaches. Do not require unsupported legal conclusions."
      },
      {
        "title": "6. Graph and agent view",
        "text": "Single-agent: check step dependencies. Multi-agent: check role inputs, permissions, handoff artifacts and joins. The graph describes task work only; approval status is not a graph node. Agent view must exclude private solutions and grading."
      },
      {
        "title": "7. Rubric and validation",
        "text": "Check observable criteria, weights, critical flags, partial credit, common errors and alternatives. Resolve validation blockers. Similarity or authorship signals require judgement; they do not prove misconduct."
      },
      {
        "title": "8. Review decision and PM approval",
        "text": "Expert: return actionable, field-specific corrections or mark expert review complete. PM: approve the reviewed revision or return it for correction. Revisions after review require renewed checks. Approval does not itself prove executable Anvil export; contract validation remains required."
      }
    ],
    "glossary": [
      {
        "title": "Task title / brief",
        "text": "Name this case and state the requested deliverable. Describe the assignment without revealing the reference answer."
      },
      {
        "title": "Trigger / as-of date / scope",
        "text": "Say why the task starts, which date governs the evidence and which customer, asset, period or locale is in scope."
      },
      {
        "title": "Evidence ID / source / date",
        "text": "Give each record a unique identifier, its origin and relevant date so findings can cite it precisely."
      },
      {
        "title": "Tool / arguments / response",
        "text": "Name an allowed action, supply the inputs it accepts and record the matching result. Use none when tools are unnecessary."
      },
      {
        "title": "Policy rule / version / source locator",
        "text": "Select the approved rule and exact version. Identify its page or clause; explain scope, applicability and exceptions."
      },
      {
        "title": "Steps / dependencies",
        "text": "Describe expected work in order. A dependency means another step must supply its output first. Multi-agent tasks also need role and handoff details."
      },
      {
        "title": "Findings / evidence references",
        "text": "State supported observations and link their record IDs. Distinguish known facts, reasonable inferences and unresolved gaps."
      },
      {
        "title": "Rationale / human handoff",
        "text": "Explain why the recommendation follows from the evidence and applicable rules. State what an authorised person must decide or do next."
      },
      {
        "title": "Criterion / weight / critical flag",
        "text": "Define an observable grading test, its contribution to the total and whether failure is a critical error under the scoring rules."
      },
      {
        "title": "Partial credit / common errors / acceptable variations",
        "text": "Describe incomplete-but-useful work, predictable mistakes and other valid approaches. Grade outcomes fairly rather than requiring identical wording."
      },
      {
        "title": "Reviewer comment / decision",
        "text": "Name the affected field and correction needed. Expert review and PM approval are separate responsibilities, even when one person performs both."
      },
      {
        "title": "Claim substantiation / launch asset",
        "text": "Link each product claim to supporting tests or approved source material and identify the exact asset using it."
      },
      {
        "title": "Budget / measurement / release",
        "text": "State allocations, success measures and the recommended release status; reconcile them with the supplied launch constraints."
      }
    ]
  }
] as const;
