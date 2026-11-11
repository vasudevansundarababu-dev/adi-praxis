-- Authoring v2.1 Wave 2: the SME -> Expert -> PM review route.
-- The task carries its pending stage; each stage decision is a TaskReview row bound to the exact submission version
-- and the sha256 of its content. Existing SME -> PM rows keep stage NULL and are unchanged. TaskReview stays
-- append-only (trigger from 20260927090000_m6_append_only).
CREATE TYPE "ReviewStage" AS ENUM ('EXPERT_REVIEW', 'PM_APPROVAL');
ALTER TYPE "TaskReviewDecision" ADD VALUE 'PASS';
ALTER TYPE "TaskReviewDecision" ADD VALUE 'EDIT';
ALTER TABLE "TaskInstance" ADD COLUMN "review_stage" "ReviewStage";
ALTER TABLE "TaskReview" ADD COLUMN "stage" "ReviewStage";
ALTER TABLE "TaskReview" ADD COLUMN "content_hash" TEXT;
ALTER TABLE "TaskReview" ADD COLUMN "edit_reason" TEXT;
ALTER TABLE "TaskReview" ADD COLUMN "material" BOOLEAN;
