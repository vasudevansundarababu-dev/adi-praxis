-- New RL Gym: one authored task package per approved revision, fetched by hash (docs/design/FORGE-RLGYM-V2-DESIGN.md
-- part 1, 22 Nov 2026). The content is the canonical JSON whose SHA-256 is package_sha256. Append-only.
CREATE TABLE "AuthoredTaskPackage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "package_sha256" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "schema" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthoredTaskPackage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthoredTaskPackage_sha_check" CHECK ("package_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AuthoredTaskPackage_revision_check" CHECK ("revision" >= 1)
);
CREATE UNIQUE INDEX "AuthoredTaskPackage_client_id_package_sha256_key" ON "AuthoredTaskPackage"("client_id", "package_sha256");
CREATE UNIQUE INDEX "AuthoredTaskPackage_record_id_key" ON "AuthoredTaskPackage"("record_id");
CREATE INDEX "AuthoredTaskPackage_project_id_task_instance_id_idx" ON "AuthoredTaskPackage"("project_id", "task_instance_id");
CREATE TRIGGER "AuthoredTaskPackage_append_only" BEFORE UPDATE OR DELETE ON "AuthoredTaskPackage" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "AuthoredTaskPackage_no_truncate" BEFORE TRUNCATE ON "AuthoredTaskPackage" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "AuthoredTaskPackage" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "AuthoredTaskPackage" FROM CURRENT_USER;
