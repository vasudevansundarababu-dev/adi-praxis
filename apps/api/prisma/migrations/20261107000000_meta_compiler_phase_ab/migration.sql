-- Templates Meta-Compiler, Phases A and B (docs/architecture/ARCH-TEMPLATES-META-COMPILER.md section 3). Additive only.
-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('HERMETIC_MCP', 'HERMETIC_GRAPH', 'HERMETIC_SQL');

-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('BLUEPRINT', 'FULL_CODE');

-- CreateEnum
CREATE TYPE "DrafterProvider" AS ENUM ('claude', 'gemini', 'mock');

-- CreateEnum
CREATE TYPE "MetaCompilerRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CAPPED');

-- CreateEnum
CREATE TYPE "StudioDeploymentStatus" AS ENUM ('ACTIVE', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "StudioRuntime" AS ENUM ('SHARED', 'ISOLATED');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('SYNTHETIC', 'REAL_PUBLIC');

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "blueprint" JSONB,
ADD COLUMN     "blueprint_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "execution_mode" "ExecutionMode",
ADD COLUMN     "variant_of_id" UUID;

-- CreateTable
CREATE TABLE "ElicitationPreset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "field" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElicitationPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompilerGenerationRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "mode" "GenerationMode" NOT NULL DEFAULT 'BLUEPRINT',
    "provider" "DrafterProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "status" "MetaCompilerRunStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB NOT NULL DEFAULT '{"ui":0,"backend":0,"message":"Queued"}',
    "estimated_cost_usd" DECIMAL(10,4),
    "actual_cost_usd" DECIMAL(10,4),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "output_ref" TEXT,
    "output_sha256" TEXT,
    "log_ref" TEXT,
    "error" TEXT,
    "requested_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompilerGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompilerVerificationRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "generation_run_id" UUID NOT NULL,
    "status" "MetaCompilerRunStatus" NOT NULL DEFAULT 'QUEUED',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "zero_baseline_score" DECIMAL(4,2),
    "oracle_score" DECIMAL(4,2),
    "bundle_ref" TEXT,
    "bundle_sha256" TEXT,
    "runner_ref" TEXT,
    "log_ref" TEXT,
    "error" TEXT,
    "requested_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompilerVerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioDeployment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_lineage_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "project_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "verification_run_id" UUID NOT NULL,
    "studio_key" TEXT NOT NULL,
    "status" "StudioDeploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "runtime" "StudioRuntime" NOT NULL DEFAULT 'SHARED',
    "deployed_by_id" UUID NOT NULL,
    "stopped_at" TIMESTAMP(3),
    "stopped_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmeAuthoredTask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "submission_version" INTEGER NOT NULL,
    "deployment_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "project_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "external_task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tpt_estimate" TEXT,
    "execution_mode" "ExecutionMode" NOT NULL,
    "task_json" JSONB NOT NULL,
    "bundle_ref" TEXT NOT NULL,
    "bundle_sha256" TEXT NOT NULL,
    "zero_baseline_score" DECIMAL(4,2),
    "oracle_score" DECIMAL(4,2),
    "verification_evidence" JSONB,
    "data_classification" "DataClassification" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmeAuthoredTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ElicitationPreset_client_id_domain_id_idx" ON "ElicitationPreset"("client_id", "domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "ElicitationPreset_domain_id_label_key" ON "ElicitationPreset"("domain_id", "label");

-- CreateIndex
CREATE INDEX "CompilerGenerationRun_client_id_created_at_idx" ON "CompilerGenerationRun"("client_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "CompilerGenerationRun_template_id_prompt_hash_mode_model_key" ON "CompilerGenerationRun"("template_id", "prompt_hash", "mode", "model");

-- CreateIndex
CREATE INDEX "CompilerVerificationRun_client_id_generation_run_id_idx" ON "CompilerVerificationRun"("client_id", "generation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "StudioDeployment_studio_key_key" ON "StudioDeployment"("studio_key");

-- CreateIndex
CREATE INDEX "StudioDeployment_client_id_status_idx" ON "StudioDeployment"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudioDeployment_template_lineage_id_project_id_candidate_i_key" ON "StudioDeployment"("template_lineage_id", "project_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "SmeAuthoredTask_external_task_id_key" ON "SmeAuthoredTask"("external_task_id");

-- CreateIndex
CREATE INDEX "SmeAuthoredTask_client_id_created_at_idx" ON "SmeAuthoredTask"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "SmeAuthoredTask_client_id_deployment_id_idx" ON "SmeAuthoredTask"("client_id", "deployment_id");

-- CreateIndex
CREATE UNIQUE INDEX "SmeAuthoredTask_task_instance_id_submission_version_key" ON "SmeAuthoredTask"("task_instance_id", "submission_version");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_variant_of_id_fkey" FOREIGN KEY ("variant_of_id") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElicitationPreset" ADD CONSTRAINT "ElicitationPreset_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompilerGenerationRun" ADD CONSTRAINT "CompilerGenerationRun_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompilerVerificationRun" ADD CONSTRAINT "CompilerVerificationRun_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "CompilerGenerationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioDeployment" ADD CONSTRAINT "StudioDeployment_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioDeployment" ADD CONSTRAINT "StudioDeployment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioDeployment" ADD CONSTRAINT "StudioDeployment_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioDeployment" ADD CONSTRAINT "StudioDeployment_verification_run_id_fkey" FOREIGN KEY ("verification_run_id") REFERENCES "CompilerVerificationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAuthoredTask" ADD CONSTRAINT "SmeAuthoredTask_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAuthoredTask" ADD CONSTRAINT "SmeAuthoredTask_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "StudioDeployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAuthoredTask" ADD CONSTRAINT "SmeAuthoredTask_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAuthoredTask" ADD CONSTRAINT "SmeAuthoredTask_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmeAuthoredTask" ADD CONSTRAINT "SmeAuthoredTask_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- PRD D-14 and architecture section 3.2: an authored task's content, bundle hash and data classification never change
-- after commit. Scores and verification evidence may still be recorded by the per-task verification run.
CREATE FUNCTION praxis_sme_authored_task_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."task_json" IS DISTINCT FROM OLD."task_json"
     OR NEW."bundle_sha256" IS DISTINCT FROM OLD."bundle_sha256"
     OR NEW."bundle_ref" IS DISTINCT FROM OLD."bundle_ref"
     OR NEW."data_classification" IS DISTINCT FROM OLD."data_classification" THEN
    RAISE EXCEPTION 'SmeAuthoredTask content is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SmeAuthoredTask_immutable" BEFORE UPDATE ON "SmeAuthoredTask" FOR EACH ROW EXECUTE FUNCTION praxis_sme_authored_task_immutable();
