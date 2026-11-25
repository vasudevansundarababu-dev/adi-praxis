-- KYC Judgment v1 A3 (owner, 25 Nov 2026): Studio's coverage answer for one rule version's condition, kept for that exact
-- version and content hash, so the PM's review queue sorts without asking Studio again. Additive. Append-only.
CREATE TABLE "PolicyCoverageResult" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "environment_version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "checked_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyCoverageResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyCoverageResult_status_check" CHECK ("status" IN ('supported', 'needs_data', 'needs_environment_change'))
);
CREATE INDEX "PolicyCoverageResult_rule_version_id_content_hash_created_at_idx" ON "PolicyCoverageResult"("rule_version_id", "content_hash", "created_at");
CREATE INDEX "PolicyCoverageResult_project_id_created_at_idx" ON "PolicyCoverageResult"("project_id", "created_at");
CREATE TRIGGER "PolicyCoverageResult_append_only" BEFORE UPDATE OR DELETE ON "PolicyCoverageResult" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyCoverageResult_no_truncate" BEFORE TRUNCATE ON "PolicyCoverageResult" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyCoverageResult" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyCoverageResult" FROM CURRENT_USER;
