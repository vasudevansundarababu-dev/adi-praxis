-- Golden task packs (owner, 12 Nov 2026): uploaded authoring forms and their worked cases. Append-only.
CREATE TABLE "UploadedProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "profile_id" TEXT NOT NULL,
    "workflow_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "examples" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadedProfile_profile_id_key" ON "UploadedProfile"("profile_id");
CREATE INDEX "UploadedProfile_client_id_workflow_name_idx" ON "UploadedProfile"("client_id", "workflow_name");
CREATE TRIGGER "UploadedProfile_append_only" BEFORE UPDATE OR DELETE ON "UploadedProfile" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "UploadedProfile_no_truncate" BEFORE TRUNCATE ON "UploadedProfile" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "UploadedProfile" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "UploadedProfile" FROM CURRENT_USER;
