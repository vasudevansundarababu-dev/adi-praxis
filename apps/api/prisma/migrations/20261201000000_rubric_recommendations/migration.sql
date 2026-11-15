-- Rubric editor and recommendations (docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md). Additive only: three new internal
-- tables, no change to any existing table or column. Append-only, enforced by the database.
CREATE TABLE "RubricRecommendationRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "task_revision" INTEGER NOT NULL,
    "input_digest" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "error" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RubricRecommendationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RubricRecommendationRun_task_instance_id_created_at_idx" ON "RubricRecommendationRun"("task_instance_id", "created_at");
CREATE INDEX "RubricRecommendationRun_task_instance_id_input_digest_mode_idx" ON "RubricRecommendationRun"("task_instance_id", "input_digest", "mode");

CREATE TABLE "RubricCriterionAnnotation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "criterion_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exportable" BOOLEAN NOT NULL,
    "from_run_id" UUID,
    "details" JSONB NOT NULL,
    "edited_fields" TEXT[],
    "ai_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RubricCriterionAnnotation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RubricCriterionAnnotation_task_instance_id_criterion_id_version_key" ON "RubricCriterionAnnotation"("task_instance_id", "criterion_id", "version");
CREATE INDEX "RubricCriterionAnnotation_task_instance_id_idx" ON "RubricCriterionAnnotation"("task_instance_id");

CREATE TABLE "RubricTaskSources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RubricTaskSources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RubricTaskSources_task_instance_id_version_key" ON "RubricTaskSources"("task_instance_id", "version");

CREATE TRIGGER "RubricRecommendationRun_append_only" BEFORE UPDATE OR DELETE ON "RubricRecommendationRun" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RubricCriterionAnnotation_append_only" BEFORE UPDATE OR DELETE ON "RubricCriterionAnnotation" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RubricTaskSources_append_only" BEFORE UPDATE OR DELETE ON "RubricTaskSources" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RubricRecommendationRun_no_truncate" BEFORE TRUNCATE ON "RubricRecommendationRun" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
CREATE TRIGGER "RubricCriterionAnnotation_no_truncate" BEFORE TRUNCATE ON "RubricCriterionAnnotation" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
CREATE TRIGGER "RubricTaskSources_no_truncate" BEFORE TRUNCATE ON "RubricTaskSources" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
