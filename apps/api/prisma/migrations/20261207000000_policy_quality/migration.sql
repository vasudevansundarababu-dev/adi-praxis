-- E-002 §4.1.4 (owner, 23 Nov 2026): PM-only quality evaluation. Reference labels are private to the project's PMs and
-- Admins, versioned per document version; each evaluation run is kept with its reproducibility metadata. Append-only.
CREATE TABLE "PolicyReferenceSet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "labels" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyReferenceSet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicyReferenceSet_document_version_id_version_key" ON "PolicyReferenceSet"("document_version_id", "version");
CREATE TRIGGER "PolicyReferenceSet_append_only" BEFORE UPDATE OR DELETE ON "PolicyReferenceSet" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyReferenceSet_no_truncate" BEFORE TRUNCATE ON "PolicyReferenceSet" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyReferenceSet" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyReferenceSet" FROM CURRENT_USER;

CREATE TABLE "PolicyQualityRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "reference_set_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyQualityRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PolicyQualityRun_project_id_created_at_idx" ON "PolicyQualityRun"("project_id", "created_at");
CREATE TRIGGER "PolicyQualityRun_append_only" BEFORE UPDATE OR DELETE ON "PolicyQualityRun" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyQualityRun_no_truncate" BEFORE TRUNCATE ON "PolicyQualityRun" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyQualityRun" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyQualityRun" FROM CURRENT_USER;
