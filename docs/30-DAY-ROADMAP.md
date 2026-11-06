# Anvil + Praxis: next 30 days

Planning window: **3 November–2 December 2026**. This is a proposed delivery and
recruiting plan, not a claim that the backlog, integrations, taskbanks or partnerships
are complete. Module guides and dated build/release evidence describe today's product.

## Outcome

Build a traceable expert-task pipeline: experts author tasks in Praxis; Anvil qualifies
and evaluates them; selected completed results become SME review assignments in Praxis;
the SME's submitted review returns to Anvil as immutable, version-bound evidence.

Target three domain taskbanks—**Marketing, Banking and Commerce—with 200–500
expert-authored samples each** (600–1,500 overall). This is a recruitment/acceptance
target, not current inventory. Count independently authored accepted samples separately
from generated variants, repeated executions and software fixtures. Publish actual
accepted/reviewed counts and coverage gaps, even if the target is missed.

## Delivery sequence and gates

| Window | Anvil | Praxis | Recruiting / evidence | Acceptance gate |
| --- | --- | --- | --- | --- |
| Days 1–7, Nov 3–9 | Ship modern Benchmarks; inventory remaining release gaps; define versioned benchmark manifests and taskbank metadata; stabilize provider diagnostics and accounting. | Reconcile authoring/export support against Anvil v3; define SME review assignment and result contracts using existing review/audit services. | Recruit domain leads and potential faculty/guides; confirm availability, compensation, rights and synthetic-data rules. Use Banking reference cases to calibrate authoring instructions. | Agreed contract/ownership, tested Banking examples, explicit coverage plan and initial reviewer commitments. |
| Days 8–14, Nov 10–16 | Implement authenticated completed-run review dispatch, immutable evidence bundles and callback intake; bind exact run/task/rubric/package/model versions. | Implement scoped review assignment intake, SME assignment/inbox, blinded workbench and submitted structured reviews. | Pilot 10 independently authored samples per domain with expert/faculty review; correct ambiguous rubrics before expanding. | End-to-end local API test with a real submitted synthetic SME review, tenant negatives, duplicate/replay and privacy tests. |
| Days 15–21, Nov 17–23 | Add review status, reviewer evidence and disagreement/adjudication views; benchmark release checks, reproducibility and operational recovery. | Add deadline/reassignment/rework and reviewer-calibration workflows; append-only review successors and export lineage. | Expand toward 50 accepted samples per domain; record reviewer agreement, rejection/rework reasons and coverage by task family/difficulty. | Repeated non-destructive staging roundtrip; restart/timeout recovery; no duplicate reviews or mutation of original run scores. |
| Days 22–30, Nov 24–Dec 2 | Complete prioritized privacy/scanning, access/onboarding, cumulative spend/reconciliation, backup/restore, accessibility and bounded-scale gaps; release only qualified features. | Complete prioritized authoring/export, identity/demo separation, certification/payment qualification, access, recovery and usability gaps. | Progress to 200 accepted samples per domain; 500 per domain is a stretch dependent on recruited expert/faculty capacity and quality gates. Publish candid actuals. | Reviewed release, reproducible demo, verified tests and deployed versions; each published sample has authorship, rights and review lineage. Unfinished items remain explicit. |

The deadline does not authorize weaker authentication, private-reference exposure,
unreviewed data processing, new spending or fabricated approvals. The existing APIs,
databases and workflows are extended; no parallel task/review store is proposed.

## Anvil → Praxis → SME → Anvil API loop (roadmap, not implemented)

1. A completed eligible Anvil run creates one review request referencing immutable
   run/task/rubric/package/model IDs, hashes, observable outputs/trajectories, synthetic
   provenance and reviewed disclosure rights. Operationally unknown executions are
   clearly identified rather than presented as scored answers.
2. An authenticated, project/tenant-scoped service sends it to Praxis with an
   idempotency key and versioned schema. Existing Praxis RL-review interfaces are the
   starting point; compatibility and missing fields must be reconciled before coding.
3. Praxis assigns an eligible SME with conflict checks and an audit trail. The SME
   receives only permitted evidence, records criterion judgments, explanations and
   identified failure modes, and submits through the normal review workflow.
4. A signed/authenticated callback or scoped polling export returns the exact
   submitted review version. Anvil validates correlation, tenant, payload hash and
   replay/expiry rules, then appends the review and updates review status.
5. Corrections append successors; duplicate deliveries are idempotent. A human review
   does not silently overwrite automated scores, run provenance or hidden references.
   Disputes preserve both judgments and explicit adjudication evidence.

This API integration is the next implementation increment. The current file-export
handoff and separate review capabilities do not establish an operational automated loop.
No real SME notification, outreach or external sending is performed by this roadmap.

## Banking as the reference design

Use the existing original synthetic **multi-hop KYC/AML** and **fraud-window/guarded
response** cases to define evidence, tool actions, hard constraints, criterion weights,
reference reasoning anchors and review forms. They are software reference points, not
expert-authored production banking datasets or regulatory advice.

Apply the same authoring/review pattern to:

- **Banking:** ownership/screening, suspicious-activity evidence and investigation
  windows, with Banking-network SMEs and independent qualified reviewers/guides.
- **Marketing:** budget allocation, channel evidence, forecasts and constrained
  multi-stage decisions. Seek guidance and introductions to potential Wharton and
  Harvard academics/experts through the Bodhium network.
- **Commerce:** proposed inventory, pricing, returns and operational-decision families,
  calibrated against the same evidence/constraint/rubric discipline with relevant SMEs.

Wharton, Harvard, Bodhium and Banking networks above describe the user's proposed
recruitment channels. No institutional partnership, professor participation, endorsement,
data licence or research validation is claimed. Use names publicly only with permission.

## Taskbank publication checklist

Every accepted sample needs stable task/revision IDs; expert authorship and domain;
synthetic or properly licensed provenance; actor/private visibility; executable
constraints, deliverables and rubric; passing/failing validation cases; rights/privacy
clearance; and a recorded qualified professor/guide review before publication.
Author declarations alone do not satisfy that review.

Track authored, submitted, reworked, accepted, reviewed and published counts separately,
alongside independent task families, variants, reviewer agreement and unresolved gaps.
No predetermined answer, scripted candidate or repeated variant counts as measured model
performance or an independently expert-authored sample.
