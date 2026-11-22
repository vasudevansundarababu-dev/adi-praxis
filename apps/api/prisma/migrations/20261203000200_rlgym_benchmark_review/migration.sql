-- New RL Gym part 3 (docs/design/FORGE-RLGYM-V2-DESIGN.md): SME review batches the RL Gym sends into a project, the
-- decisions people make on them (one per item, final) and each attempt to send a decision back. All append-only.
CREATE TABLE "RlGymReviewBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "forge_batch_ref" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "api_client_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RlGymReviewBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RlGymReviewBatch_client_id_batch_id_key" ON "RlGymReviewBatch"("client_id", "batch_id");
CREATE UNIQUE INDEX "RlGymReviewBatch_forge_batch_ref_key" ON "RlGymReviewBatch"("forge_batch_ref");
CREATE INDEX "RlGymReviewBatch_project_id_created_at_idx" ON "RlGymReviewBatch"("project_id", "created_at");

CREATE TABLE "RlGymReviewDecision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "review_batch_id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "task_revision" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "criterion_id" TEXT,
    "decided_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RlGymReviewDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RlGymReviewDecision_decision_check" CHECK ("decision" IN ('agent_failure', 'task_correction', 'rubric_correction', 'grader_wrong', 'environment_wrong')),
    CONSTRAINT "RlGymReviewDecision_rationale_check" CHECK (length(btrim("rationale")) > 0),
    CONSTRAINT "RlGymReviewDecision_criterion_check" CHECK ("decision" NOT IN ('rubric_correction', 'grader_wrong') OR "criterion_id" IS NOT NULL)
);
-- A decision is final: one per item.
CREATE UNIQUE INDEX "RlGymReviewDecision_review_batch_id_item_id_key" ON "RlGymReviewDecision"("review_batch_id", "item_id");
CREATE INDEX "RlGymReviewDecision_project_id_task_id_idx" ON "RlGymReviewDecision"("project_id", "task_id");

CREATE TABLE "RlGymDecisionDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "http_status" INTEGER,
    "request_id" TEXT,
    "error" JSONB,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RlGymDecisionDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RlGymDecisionDelivery_outcome_check" CHECK ("outcome" IN ('delivered', 'rejected', 'unavailable'))
);
CREATE INDEX "RlGymDecisionDelivery_decision_id_created_at_idx" ON "RlGymDecisionDelivery"("decision_id", "created_at");

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['RlGymReviewBatch', 'RlGymReviewDecision', 'RlGymDecisionDelivery'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION praxis_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate()', t || '_no_truncate', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM CURRENT_USER', t);
  END LOOP;
END $$;
