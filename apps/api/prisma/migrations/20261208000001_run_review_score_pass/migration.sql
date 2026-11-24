-- E-007 phase 2 (owner, 24 Nov 2026): a Benchmark review decision is bound to the run, the score pass and the evidence
-- digest the reviewer saw, and says Accept, Dispute or Can't assess. Existing rows keep NULL (decided before binding).
ALTER TABLE "RunReviewDecision" ADD COLUMN "verdict" TEXT;
ALTER TABLE "RunReviewDecision" ADD COLUMN "score_pass" INTEGER;
ALTER TABLE "RunReviewDecision" ADD COLUMN "evidence_sha256" TEXT;
