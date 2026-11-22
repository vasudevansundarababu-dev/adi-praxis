-- Studio edge cases and verifiers, project export to the new RL Gym, SME review batches and SME needs
-- (adi-labs-design praxis/AUTHORING-SPEC-EDGE-CASES-VERIFIERS-BRANDING.md; AUTHORING-SNAPSHOT 3.1-3.3). Additive only.

-- What the SME fills for benchmarks on a task (edge-case focus, expected-result slots, extra state checks). Kept
-- server-side, like "drafting", so the workbench's autosave cannot change it. Copied into the approved package.
ALTER TABLE "TaskInstance" ADD COLUMN "benchmark" JSONB;

-- One press of Export / Re-export: the body sent (no package content) and the RL Gym's answer. Append-only.
CREATE TABLE "RlGymProjectExport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "export_id" TEXT NOT NULL,
    "export_sha256" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "tasks" JSONB NOT NULL,
    "not_sent" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "http_status" INTEGER,
    "request_id" TEXT,
    "receipt" JSONB,
    "error" JSONB,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RlGymProjectExport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RlGymProjectExport_outcome_check" CHECK ("outcome" IN ('received', 'rejected', 'unavailable')),
    CONSTRAINT "RlGymProjectExport_sha_check" CHECK ("export_sha256" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "RlGymProjectExport_project_id_created_at_idx" ON "RlGymProjectExport"("project_id", "created_at");
CREATE TRIGGER "RlGymProjectExport_append_only" BEFORE UPDATE OR DELETE ON "RlGymProjectExport" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RlGymProjectExport_no_truncate" BEFORE TRUNCATE ON "RlGymProjectExport" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "RlGymProjectExport" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "RlGymProjectExport" FROM CURRENT_USER;

-- An SME review batch the RL Gym sent into a project (rlgym.sme-review-package.v1). Append-only; one per batch_id.
CREATE TABLE "RunReviewBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "forge_batch_ref" TEXT NOT NULL,
    "run_id" TEXT,
    "body" JSONB NOT NULL,
    "body_sha256" TEXT NOT NULL,
    "api_client_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunReviewBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunReviewBatch_client_id_batch_id_key" ON "RunReviewBatch"("client_id", "batch_id");
CREATE UNIQUE INDEX "RunReviewBatch_forge_batch_ref_key" ON "RunReviewBatch"("forge_batch_ref");
CREATE INDEX "RunReviewBatch_project_id_created_at_idx" ON "RunReviewBatch"("project_id", "created_at");
CREATE TRIGGER "RunReviewBatch_append_only" BEFORE UPDATE OR DELETE ON "RunReviewBatch" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RunReviewBatch_no_truncate" BEFORE TRUNCATE ON "RunReviewBatch" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "RunReviewBatch" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "RunReviewBatch" FROM CURRENT_USER;

-- A person's decision on one episode of a batch, and what the RL Gym answered. One decision per item, final.
CREATE TABLE "RunReviewDecision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "batch_row_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "criterion_id" TEXT,
    "decided_by_id" UUID NOT NULL,
    "decided_by" TEXT NOT NULL,
    "send_outcome" TEXT NOT NULL,
    "http_status" INTEGER,
    "response" JSONB,
    "rework_task_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunReviewDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RunReviewDecision_decision_check" CHECK ("decision" IN ('agent_failure', 'task_correction', 'rubric_correction', 'grader_wrong', 'environment_wrong')),
    CONSTRAINT "RunReviewDecision_send_check" CHECK ("send_outcome" IN ('received', 'rejected', 'unavailable', 'not_connected')),
    CONSTRAINT "RunReviewDecision_rationale_check" CHECK (length(btrim("rationale")) > 0),
    CONSTRAINT "RunReviewDecision_batch_fkey" FOREIGN KEY ("batch_row_id") REFERENCES "RunReviewBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RunReviewDecision_batch_row_id_item_id_key" ON "RunReviewDecision"("batch_row_id", "item_id");
CREATE TRIGGER "RunReviewDecision_append_only" BEFORE UPDATE OR DELETE ON "RunReviewDecision" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RunReviewDecision_no_truncate" BEFORE TRUNCATE ON "RunReviewDecision" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "RunReviewDecision" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "RunReviewDecision" FROM CURRENT_USER;

-- An SME need (Raise an edge case, More data). Its state moves open -> merged | sent | rejected, each change audited.
CREATE TABLE "SmeNeed" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "raised_by_sme_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "merged_into_id" UUID,
    "reject_reason" TEXT,
    "summary" TEXT,
    "studio_item_id" TEXT,
    "studio_state" TEXT,
    "studio_detail" JSONB,
    "sent_at" TIMESTAMP(3),
    "sent_by_id" UUID,
    "template_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmeNeed_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmeNeed_kind_check" CHECK ("kind" IN ('new_case_kind', 'more_data')),
    CONSTRAINT "SmeNeed_state_check" CHECK ("state" IN ('open', 'merged', 'sent', 'rejected'))
);
CREATE INDEX "SmeNeed_project_id_state_idx" ON "SmeNeed"("project_id", "state");
CREATE INDEX "SmeNeed_task_instance_id_idx" ON "SmeNeed"("task_instance_id");
