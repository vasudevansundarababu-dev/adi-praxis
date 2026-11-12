-- Project export and Anvil validation runs (owner, 12 Nov 2026). Append-only.
CREATE TABLE "ProjectValidationRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "validator" TEXT NOT NULL,
    "validator_version" TEXT NOT NULL,
    "record_ids" UUID[],
    "results" JSONB NOT NULL,
    "file_key" TEXT,
    "file_sha256" TEXT,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectValidationRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectValidationRun_kind_check" CHECK ("kind" IN ('VALIDATE', 'EXPORT'))
);
CREATE INDEX "ProjectValidationRun_project_id_created_at_idx" ON "ProjectValidationRun"("project_id", "created_at");
CREATE TRIGGER "ProjectValidationRun_append_only" BEFORE UPDATE OR DELETE ON "ProjectValidationRun" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "ProjectValidationRun_no_truncate" BEFORE TRUNCATE ON "ProjectValidationRun" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "ProjectValidationRun" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ProjectValidationRun" FROM CURRENT_USER;
