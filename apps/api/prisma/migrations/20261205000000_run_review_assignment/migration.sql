-- D-004 (owner, 23 Nov 2026): a PM or Admin assigns the SME who reviews a task's episodes in an RL Gym review batch.
-- Only the task's author or an SME Reviewer on the project may be assigned. Per task within a batch; the latest row is
-- in force, and it can change only until that task's first decision. Append-only, like the decisions.
CREATE TABLE "RunReviewAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "batch_row_id" UUID NOT NULL,
    "task_id" TEXT NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunReviewAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RunReviewAssignment_batch_fkey" FOREIGN KEY ("batch_row_id") REFERENCES "RunReviewBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RunReviewAssignment_batch_row_id_task_id_created_at_idx" ON "RunReviewAssignment"("batch_row_id", "task_id", "created_at");
CREATE INDEX "RunReviewAssignment_sme_user_id_idx" ON "RunReviewAssignment"("sme_user_id");
CREATE TRIGGER "RunReviewAssignment_append_only" BEFORE UPDATE OR DELETE ON "RunReviewAssignment" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RunReviewAssignment_no_truncate" BEFORE TRUNCATE ON "RunReviewAssignment" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "RunReviewAssignment" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "RunReviewAssignment" FROM CURRENT_USER;
