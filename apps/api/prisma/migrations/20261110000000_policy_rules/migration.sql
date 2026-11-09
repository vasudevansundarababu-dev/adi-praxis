-- Policy Rules (docs/architecture/ARCH-POLICY-RULES.md section 3). Additive only: new tables plus two nullable columns.

-- CreateEnum
CREATE TYPE "PolicyDocumentOrigin" AS ENUM ('UPLOAD', 'MANUAL_TEXT', 'SEED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "PolicyRuleState" AS ENUM ('DRAFT', 'NEEDS_DEFINITION', 'REVIEWED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "TaskPolicyChangeType" AS ENUM ('CLARIFICATION', 'STRICTER', 'EXEMPTION');

-- AlterTable
ALTER TABLE "SmeAuthoredTask" ADD COLUMN     "policy_snapshot_id" UUID;

-- AlterTable
ALTER TABLE "TaskSubmission" ADD COLUMN     "policy_snapshot_id" UUID;

-- CreateTable
CREATE TABLE "TemplatePolicyProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "suggested_patterns" JSONB NOT NULL DEFAULT '[]',
    "expected_evidence" JSONB NOT NULL DEFAULT '[]',
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplatePolicyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPolicyRequirement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "suggested_patterns" JSONB NOT NULL DEFAULT '[]',
    "expected_evidence" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPolicyRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "language" TEXT,
    "jurisdiction" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "latest_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDocumentVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER NOT NULL,
    "page_count_method" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "text_storage_key" TEXT NOT NULL,
    "text_chars" INTEGER NOT NULL,
    "locator_granularity" TEXT NOT NULL,
    "origin" "PolicyDocumentOrigin" NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionProfile" (
    "id" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionProfile_pkey" PRIMARY KEY ("client_id", "id")
);

-- CreateTable
CREATE TABLE "ProjectExtractionSetting" (
    "project_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "profile_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExtractionSetting_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "ExtractionBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "profile_revision" INTEGER NOT NULL,
    "profile_snapshot" JSONB NOT NULL,
    "selection_source" TEXT NOT NULL,
    "schema_hash" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "parent_batch_id" UUID,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ExtractionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_operation_id" TEXT,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "raw_receipt_key" TEXT,
    "usage" JSONB,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "actual_usd" DECIMAL(10,4),
    "cleanup" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionSpend" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "job_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_usd" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "source_key" TEXT,
    "latest_version" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRuleVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "PolicyRuleState" NOT NULL DEFAULT 'DRAFT',
    "body" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "extraction_job_id" UUID,
    "origin" TEXT NOT NULL,
    "edited_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "exclude_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "field_path" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "resolution" TEXT NOT NULL,
    "provider_raw" JSONB,
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRuleSet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "inheritance_mode" TEXT NOT NULL DEFAULT 'ALL_TASKS',
    "rule_version_ids" TEXT[],
    "excluded" JSONB NOT NULL DEFAULT '[]',
    "content" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "published_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPolicyChange" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "type" "TaskPolicyChangeType" NOT NULL,
    "scope" JSONB NOT NULL,
    "requirement" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source_citation_id" UUID,
    "exception_index" INTEGER,
    "created_by_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPolicyChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPolicySnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "rubric_version" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "published_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPolicySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplatePolicyProfile_template_id_key" ON "TemplatePolicyProfile"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPolicyRequirement_project_id_key" ON "ProjectPolicyRequirement"("project_id");

-- CreateIndex
CREATE INDEX "PolicyDocument_client_id_project_id_idx" ON "PolicyDocument"("client_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocumentVersion_storage_key_key" ON "PolicyDocumentVersion"("storage_key");

-- CreateIndex
CREATE INDEX "PolicyDocumentVersion_client_id_project_id_idx" ON "PolicyDocumentVersion"("client_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocumentVersion_document_id_version_key" ON "PolicyDocumentVersion"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionBatch_idempotency_key_key" ON "ExtractionBatch"("idempotency_key");

-- CreateIndex
CREATE INDEX "ExtractionBatch_client_id_project_id_created_at_idx" ON "ExtractionBatch"("client_id", "project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionJob_batch_id_document_version_id_key" ON "ExtractionJob"("batch_id", "document_version_id");

-- CreateIndex
CREATE INDEX "ExtractionSpend_provider_idx" ON "ExtractionSpend"("provider");

-- CreateIndex
CREATE INDEX "PolicyRule_client_id_project_id_idx" ON "PolicyRule"("client_id", "project_id");

-- CreateIndex
CREATE INDEX "PolicyRule_project_id_source_key_idx" ON "PolicyRule"("project_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRule_project_id_rule_key_key" ON "PolicyRule"("project_id", "rule_key");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRuleVersion_rule_id_version_key" ON "PolicyRuleVersion"("rule_id", "version");

-- CreateIndex
CREATE INDEX "PolicyCitation_rule_version_id_idx" ON "PolicyCitation"("rule_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRuleSet_project_id_version_key" ON "ProjectRuleSet"("project_id", "version");

-- CreateIndex
CREATE INDEX "ProjectRuleSet_project_id_digest_idx" ON "ProjectRuleSet"("project_id", "digest");

-- CreateIndex
CREATE INDEX "TaskPolicyChange_task_instance_id_idx" ON "TaskPolicyChange"("task_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPolicySnapshot_task_instance_id_version_key" ON "TaskPolicySnapshot"("task_instance_id", "version");

-- CreateIndex
CREATE INDEX "TaskPolicySnapshot_task_instance_id_digest_idx" ON "TaskPolicySnapshot"("task_instance_id", "digest");

-- AddForeignKey
ALTER TABLE "PolicyDocumentVersion" ADD CONSTRAINT "PolicyDocumentVersion_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "PolicyDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ExtractionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "PolicyDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRuleVersion" ADD CONSTRAINT "PolicyRuleVersion_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "PolicyRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyCitation" ADD CONSTRAINT "PolicyCitation_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "PolicyRuleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyCitation" ADD CONSTRAINT "PolicyCitation_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "PolicyDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Published records never change (architecture section 3): document versions, rule sets, task snapshots, spend ledger.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PolicyDocumentVersion', 'ProjectRuleSet', 'TaskPolicySnapshot', 'ExtractionSpend'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION praxis_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate()', t || '_no_truncate', t);
  END LOOP;
END;
$$;

-- A Reviewed or Excluded rule version is immutable; editing creates a new draft version (PRD PR-R04).
CREATE FUNCTION praxis_policy_rule_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."state" IN ('REVIEWED', 'EXCLUDED') THEN
      RAISE EXCEPTION 'PolicyRuleVersion % is % and cannot be deleted', OLD."id", OLD."state" USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."state" IN ('REVIEWED', 'EXCLUDED') THEN
    RAISE EXCEPTION 'PolicyRuleVersion % is % and immutable', OLD."id", OLD."state" USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PolicyRuleVersion_immutable" BEFORE UPDATE OR DELETE ON "PolicyRuleVersion" FOR EACH ROW EXECUTE FUNCTION praxis_policy_rule_version_immutable();
CREATE TRIGGER "PolicyRuleVersion_no_truncate" BEFORE TRUNCATE ON "PolicyRuleVersion" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();

-- Citations of a Reviewed or Excluded version are frozen with it.
CREATE FUNCTION praxis_policy_citation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "state" INTO st FROM "PolicyRuleVersion" WHERE "id" = COALESCE(OLD."rule_version_id", NEW."rule_version_id");
  IF st IN ('REVIEWED', 'EXCLUDED') THEN
    RAISE EXCEPTION 'citations of a % rule version are immutable', st USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "PolicyCitation_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PolicyCitation" FOR EACH ROW EXECUTE FUNCTION praxis_policy_citation_immutable();
