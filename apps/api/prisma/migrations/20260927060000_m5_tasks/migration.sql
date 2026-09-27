-- CreateEnum
CREATE TYPE "TaskReviewDecision" AS ENUM ('ACCEPT', 'REWORK', 'REJECT');

-- CreateEnum
CREATE TYPE "TaskRejectReason" AS ENUM ('DUPLICATE', 'NOT_REALISTIC', 'INCORRECT', 'REAL_DATA');

-- AlterEnum
ALTER TYPE "TaskInstanceStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "CoverageSlot" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TaskInstance" ADD COLUMN     "checks" JSONB,
ADD COLUMN     "coverage_tags" JSONB,
ADD COLUMN     "embedding" vector(768),
ADD COLUMN     "flags" JSONB,
ADD COLUMN     "last_saved_at" TIMESTAMP(3),
ADD COLUMN     "quarantined_at" TIMESTAMP(3),
ADD COLUMN     "reject_reason" "TaskRejectReason";

-- CreateTable
CREATE TABLE "TaskSubmission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "output" JSONB NOT NULL,
    "coverage_tags" JSONB,
    "checks" JSONB,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReview" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "submission_version" INTEGER NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "TaskReviewDecision" NOT NULL,
    "reject_reason" "TaskRejectReason",
    "duplicate_decision" "DuplicateDecision",
    "checklist" JSONB NOT NULL,
    "comments" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSubmission_task_instance_id_version_key" ON "TaskSubmission"("task_instance_id", "version");

-- CreateIndex
CREATE INDEX "TaskReview_task_instance_id_idx" ON "TaskReview"("task_instance_id");

-- AddForeignKey
ALTER TABLE "TaskSubmission" ADD CONSTRAINT "TaskSubmission_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

