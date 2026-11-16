-- D2: AI tutorial video runs per template version, and their append-only spend ledger. Additive only.
CREATE TYPE "TutorialRunStatus" AS ENUM ('QUEUED', 'SCRIPTING', 'CLIPS', 'NARRATION', 'STITCHING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'FAILED');
CREATE TYPE "TutorialRunTrigger" AS ENUM ('PUBLISH', 'ADMIN');

CREATE TABLE "TemplateTutorialRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "lineage_id" UUID NOT NULL,
    "trigger" "TutorialRunTrigger" NOT NULL,
    "status" "TutorialRunStatus" NOT NULL DEFAULT 'QUEUED',
    "script_model" TEXT NOT NULL,
    "video_model" TEXT NOT NULL,
    "script" JSONB,
    "chapters" JSONB,
    "object_key" TEXT,
    "captions_key" TEXT,
    "duration_seconds" INTEGER,
    "estimated_usd" DECIMAL(10,4) NOT NULL,
    "actual_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "error" TEXT,
    "requested_by" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TemplateTutorialRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TemplateTutorialRun_lineage_id_created_at_idx" ON "TemplateTutorialRun"("lineage_id", "created_at");
CREATE INDEX "TemplateTutorialRun_created_at_idx" ON "TemplateTutorialRun"("created_at");
-- One open (not yet decided or failed) run per workflow lineage.
CREATE UNIQUE INDEX "TemplateTutorialRun_one_open_per_lineage" ON "TemplateTutorialRun"("lineage_id")
  WHERE "status" IN ('QUEUED', 'SCRIPTING', 'CLIPS', 'NARRATION', 'STITCHING', 'READY_FOR_REVIEW');
ALTER TABLE "TemplateTutorialRun" ADD CONSTRAINT "TemplateTutorialRun_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TutorialSpend" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('reserve', 'actual', 'release')),
    "provider" TEXT NOT NULL,
    "amount_usd" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TutorialSpend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TutorialSpend_created_at_idx" ON "TutorialSpend"("created_at");
ALTER TABLE "TutorialSpend" ADD CONSTRAINT "TutorialSpend_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "TemplateTutorialRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The spend ledger never changes.
CREATE TRIGGER "TutorialSpend_append_only" BEFORE UPDATE OR DELETE ON "TutorialSpend" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "TutorialSpend_no_truncate" BEFORE TRUNCATE ON "TutorialSpend" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "TutorialSpend" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "TutorialSpend" FROM CURRENT_USER;
