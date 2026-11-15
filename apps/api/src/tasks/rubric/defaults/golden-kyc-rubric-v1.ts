/**
 * D8 (owner, 15 Nov 2026, 'template default, SME edits'): default criteria for the KYC rubric evaluator, kept in Authoring only (never exported; template data unchanged). Source: the owner's 20-criterion table (QA KYC v7 cheat sheet). Weight 5 each, 100 in total.
 * Data only: edit the table, not the code.
 */
export const GOLDEN_KYC_RUBRIC_V1_DEFAULTS = {
  "evaluator": {
    "id": "golden-kyc-rubric-v1",
    "version": "1"
  },
  "scale": "five_two_zero",
  "criteria": [
    {
      "id": "identification_parties",
      "name": "All parties identified",
      "weight": 5,
      "passCondition": "Every owner, signer and authorised party in the snapshot is identified with their role",
      "partialCredit": "Most parties identified; a secondary party or role missing",
      "failCondition": "Parties missed or invented",
      "critical": false
    },
    {
      "id": "identification_verification",
      "name": "Identity verified",
      "weight": 5,
      "passCondition": "Each party's identity is verified with documentary or non-documentary checks, and the results are recorded",
      "partialCredit": "Verification done for some parties, or the results are incomplete",
      "failCondition": "No verification, or verification is assumed",
      "critical": true
    },
    {
      "id": "profile",
      "name": "Customer profile",
      "weight": 5,
      "passCondition": "Expected activity, source of funds and purpose recorded from the evidence",
      "partialCredit": "Profile partly recorded",
      "failCondition": "Profile missing or invented",
      "critical": false
    },
    {
      "id": "screening",
      "name": "Sanctions and watchlist screening",
      "weight": 5,
      "passCondition": "Every party is screened with screening.check, and hits are resolved or escalated",
      "partialCredit": "Screening done but a hit is left unresolved",
      "failCondition": "Screening missing for any party",
      "critical": true
    },
    {
      "id": "decision",
      "name": "Recommendation",
      "weight": 5,
      "passCondition": "The recommendation matches the evidence and policy, using an allowed value",
      "partialCredit": "Defensible but weakly supported",
      "failCondition": "Contradicts the evidence or policy",
      "critical": true
    },
    {
      "id": "next_action",
      "name": "Next action",
      "weight": 5,
      "passCondition": "A clear next step or handoff is stated for the recommendation",
      "partialCredit": "A next step is vague",
      "failCondition": "No next step",
      "critical": false
    },
    {
      "id": "evidence",
      "name": "Evidence cited",
      "weight": 5,
      "passCondition": "Every finding cites the documents or tool results it relies on",
      "partialCredit": "Some findings are uncited",
      "failCondition": "Findings without evidence",
      "critical": false
    },
    {
      "id": "revision_integrity",
      "name": "Revisions handled",
      "weight": 5,
      "passCondition": "Changed or newer documents are reconciled with document.compare and the latest version is used",
      "partialCredit": "Revision noticed but not fully reconciled",
      "failCondition": "A stale or conflicting version is used without noting it",
      "critical": false
    },
    {
      "id": "account_structure",
      "name": "Account structure",
      "weight": 5,
      "passCondition": "The product structure (single, joint, minor or custodial) is identified correctly",
      "partialCredit": "Mostly correct, with a detail missed",
      "failCondition": "Wrong structure",
      "critical": false
    },
    {
      "id": "account_roles",
      "name": "Roles on the account",
      "weight": 5,
      "passCondition": "Owner, joint owner, custodian or minor roles are assigned correctly",
      "partialCredit": "One role unclear",
      "failCondition": "Roles wrong",
      "critical": false
    },
    {
      "id": "account_eligibility",
      "name": "Eligibility",
      "weight": 5,
      "passCondition": "Age, capacity and residency eligibility are checked against policy",
      "partialCredit": "Partly checked",
      "failCondition": "Not checked",
      "critical": false
    },
    {
      "id": "account_agreements",
      "name": "Agreements",
      "weight": 5,
      "passCondition": "Required agreements and consents are present for each party",
      "partialCredit": "One agreement not confirmed",
      "failCondition": "Agreements ignored",
      "critical": false
    },
    {
      "id": "account_authority",
      "name": "Authority",
      "weight": 5,
      "passCondition": "Authority to act (custodian, guardian or power of attorney) is verified with authority.check",
      "partialCredit": "Authority noted but not verified",
      "failCondition": "Authority assumed",
      "critical": false
    },
    {
      "id": "account_party_separation",
      "name": "Party separation",
      "weight": 5,
      "passCondition": "Each party's data and evidence is kept separate, with no mixing",
      "partialCredit": "Minor overlap noted and corrected",
      "failCondition": "Parties' data mixed",
      "critical": false
    },
    {
      "id": "account_exceptions",
      "name": "Exceptions",
      "weight": 5,
      "passCondition": "Policy exceptions are identified and routed to specialist review",
      "partialCredit": "Exception noted but not routed",
      "failCondition": "Exception missed",
      "critical": false
    },
    {
      "id": "account_resolution",
      "name": "Resolution of findings",
      "weight": 5,
      "passCondition": "Open findings are resolved (finding.resolve) or listed as gaps",
      "partialCredit": "Some findings left open without being listed",
      "failCondition": "Findings ignored",
      "critical": false
    },
    {
      "id": "state_applicability",
      "name": "State applicability",
      "weight": 5,
      "passCondition": "The governing state comes from the application, and the state policies are applied",
      "partialCredit": "State identified, but policy applicability is unclear",
      "failCondition": "The wrong state is assumed",
      "critical": false
    },
    {
      "id": "state_rule_selection",
      "name": "State rule selection",
      "weight": 5,
      "passCondition": "The correct common and state rules are selected for the state, charter and date",
      "partialCredit": "One rule missing",
      "failCondition": "Wrong rules",
      "critical": false
    },
    {
      "id": "state_dates",
      "name": "Dates",
      "weight": 5,
      "passCondition": "Policy effective dates and document validity dates are checked against the application date",
      "partialCredit": "Some dates checked",
      "failCondition": "Dates ignored",
      "critical": false
    },
    {
      "id": "state_instrument",
      "name": "State instruments",
      "weight": 5,
      "passCondition": "State-specific documents and IDs are judged under that state's rules",
      "partialCredit": "Partly judged",
      "failCondition": "Ignored",
      "critical": false
    }
  ]
} as const;
