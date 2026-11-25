-- KYC Judgment v1 A4 (owner, 25 Nov 2026; contract C1 policy-library.v1): the policy library export. Additive.
-- A policy document's library kind and, for an official text, where and when it was downloaded (nullable columns).
ALTER TABLE "PolicyDocument" ADD COLUMN "library_kind" TEXT;
ALTER TABLE "PolicyDocument" ADD COLUMN "capture_source_url" TEXT;
ALTER TABLE "PolicyDocument" ADD COLUMN "capture_downloaded_on" DATE;
ALTER TABLE "PolicyDocument" ADD CONSTRAINT "PolicyDocument_library_kind_check" CHECK ("library_kind" IS NULL OR "library_kind" IN ('official_text', 'bank_policy'));

-- Each export's exact bytes and their SHA-256; the revision increases only when the content changes. Append-only.
CREATE TABLE "PolicyLibraryExport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "export_id" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "bytes" TEXT NOT NULL,
    "bytes_sha256" TEXT NOT NULL,
    "rules" INTEGER NOT NULL,
    "versions" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyLibraryExport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicyLibraryExport_project_id_revision_key" ON "PolicyLibraryExport"("project_id", "revision");
CREATE INDEX "PolicyLibraryExport_project_id_content_sha256_idx" ON "PolicyLibraryExport"("project_id", "content_sha256");
CREATE TRIGGER "PolicyLibraryExport_append_only" BEFORE UPDATE OR DELETE ON "PolicyLibraryExport" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyLibraryExport_no_truncate" BEFORE TRUNCATE ON "PolicyLibraryExport" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyLibraryExport" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyLibraryExport" FROM CURRENT_USER;
