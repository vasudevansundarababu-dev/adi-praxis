export const CONVERSATION_EXAMPLES = [
  {
    "name": "Q4 Global Paid Search Query Clustering",
    "scenario": "A synthetic headphone campaign has product searches mixed with replacement-pad and troubleshooting queries. Group queries by intent without treating every query as a purchase opportunity.",
    "evidence": "Query Q-03: \u201creplace ear cushion\u201d; Query Q-04: \u201cwireless noise cancelling headphones\u201d",
    "finding": "Q-03 is a support/accessory intent; Q-04 is a product purchase candidate.",
    "outcome": "Return clusters with query IDs and explain exclusions."
  },
  {
    "name": "Omnichannel Creative and Locale Compliance",
    "scenario": "An advertiser supplies two locale variants. One says \u201celiminates all noise\u201d; the supplied product test supports reduction only.",
    "evidence": "Asset A-01: \u201celiminates all noise\u201d; Test E-02: limited laboratory reduction results",
    "finding": "The absolute claim exceeds supplied substantiation.",
    "outcome": "Recommend revision and route release to the authorised reviewer."
  },
  {
    "name": "Adverse Media Review",
    "scenario": "An invented customer shares a name with an invented article subject, but their birth years differ.",
    "evidence": "Customer E-01 born 1988; article E-02 subject born 1961",
    "finding": "Name overlap alone does not establish an identity match.",
    "outcome": "Record the mismatch and recommend closure or additional checks under stated policy."
  },
  {
    "name": "Audit and Evidence Preparation",
    "scenario": "An audit request covers three months. The evidence inventory contains only two signed monthly attestations.",
    "evidence": "Request E-01: Jan\u2013Mar; evidence E-02: Jan; E-03: Mar",
    "finding": "February attestation is missing; the file is not complete.",
    "outcome": "Prepare the indexed pack and list the outstanding request."
  },
  {
    "name": "Communications Surveillance",
    "scenario": "A synthetic employee message mentions bypassing a limit; a later message says it refers to a test system.",
    "evidence": "Message E-01: \u201cbypass the limit\u201d; E-02: \u201ctest environment only\u201d",
    "finding": "The supplied context must be considered; the phrase alone is inconclusive.",
    "outcome": "Document context and recommend escalation or closure under the supplied policy."
  },
  {
    "name": "Compliance Monitoring",
    "scenario": "A monitoring policy requires a dated approval for a defined exception; the supplied record lacks that approval.",
    "evidence": "Policy P-01 requires signed exception approval; E-01 has no approval",
    "finding": "Required approval evidence is absent.",
    "outcome": "Record an evidence-supported exception and proposed follow-up."
  },
  {
    "name": "Customer Risk Rating",
    "scenario": "A synthetic customer profile supplies product and channel factors but omits a required geography factor.",
    "evidence": "E-01 product factor 2; channel factor 1; geography unknown",
    "finding": "A final score cannot be completed using an invented geography value.",
    "outcome": "Provide known factors, identify the gap and request missing evidence."
  },
  {
    "name": "Enhanced Due Diligence",
    "scenario": "A high-risk synthetic case claims sale proceeds, while the supplied transfer description states a loan.",
    "evidence": "E-01 declaration: property sale; E-02 transfer: shareholder loan",
    "finding": "The source-of-funds accounts conflict.",
    "outcome": "Request supporting evidence and escalate; do not approve the relationship."
  },
  {
    "name": "Issue and Remediation Tracking",
    "scenario": "An issue owner marks an action complete, but no retest demonstrates the control now works.",
    "evidence": "Issue E-01 complete; action E-02 installed; retest absent",
    "finding": "Implementation evidence alone does not establish effective remediation.",
    "outcome": "Recommend pending validation and identify required closure evidence."
  },
  {
    "name": "KYB and Beneficial Ownership",
    "scenario": "A synthetic company is owned through another entity. One intermediate ownership record is stale. Apply the explicit ownership policy supplied with this case.",
    "evidence": "E-01 parent owns 60%; E-02 parent ownership filing is stale",
    "finding": "The chain cannot be treated as fully verified from stale evidence.",
    "outcome": "Map the known chain, request current evidence and recommend escalation."
  },
  {
    "name": "KYC Onboarding and Refresh",
    "scenario": "An invented applicant requests a current account. The identity document and address evidence show inconsistent family names. The policy requires resolution before a completion recommendation.",
    "evidence": "E-01 identity: Mira Demo; E-02 address: Mira Sample; no name-change evidence",
    "finding": "The family-name discrepancy is unresolved.",
    "outcome": "Request supporting name-change evidence and escalate any approval decision."
  },
  {
    "name": "AML Transaction-Monitoring Alerts",
    "scenario": "A synthetic alert shows a sudden increase over the stated customer activity. No business explanation is supplied.",
    "evidence": "E-01 expected monthly activity DEMO 5000; E-02 observed DEMO 42000",
    "finding": "Activity deviates from the supplied profile; this does not by itself prove money laundering.",
    "outcome": "Document the deviation, request context and escalate under the stated policy."
  }
];
