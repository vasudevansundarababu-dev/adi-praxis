-- CreateEnum
CREATE TYPE "CertificationState" AS ENUM ('NOT_STARTED', 'IN_TRAINING', 'TEST_READY', 'IN_TEST', 'PASSED', 'RETAKE_AVAILABLE', 'REVIEW_REQUIRED', 'NOT_CERTIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SmeStandingState" AS ENUM ('PROBATION', 'ACTIVE', 'RETRAINING', 'SUSPENDED', 'OFFBOARDED');

-- CreateTable
CREATE TABLE "GuidelinesPackage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "task_family" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuidelinesPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidelinesVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "major" BOOLEAN NOT NULL DEFAULT true,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "published_tiers" "SmeTier"[] DEFAULT ARRAY[]::"SmeTier"[],
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuidelinesVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'FULL',
    "target" JSONB NOT NULL DEFAULT '{}',
    "stage" TEXT NOT NULL DEFAULT 'QUEUED',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "prompt_versions" JSONB NOT NULL DEFAULT '{}',
    "cost" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "tier" "SmeTier" NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "model" TEXT,
    "prompt_version" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "good_examples" JSONB NOT NULL DEFAULT '[]',
    "bad_examples" JSONB NOT NULL DEFAULT '[]',
    "quiz" JSONB NOT NULL DEFAULT '[]',
    "practice" JSONB NOT NULL DEFAULT '[]',
    "citations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationBlueprint" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "tier" "SmeTier" NOT NULL,
    "competencies" JSONB NOT NULL DEFAULT '[]',
    "item_count" INTEGER NOT NULL,
    "authoring_task" BOOLEAN NOT NULL DEFAULT false,
    "time_limit_minutes" INTEGER NOT NULL,
    "pass_rules" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "model" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemFamily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "blueprint_id" UUID NOT NULL,
    "competency" TEXT NOT NULL,
    "difficulty_min" INTEGER NOT NULL,
    "difficulty_max" INTEGER NOT NULL,
    "cognitive_level" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "stem_pattern" TEXT NOT NULL,
    "variable_schema" JSONB NOT NULL,
    "answer_rule" JSONB NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "distractor_rationale" TEXT NOT NULL DEFAULT '',
    "citation" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "variables" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "key_enc" TEXT NOT NULL,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(768),
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "served_to" UUID,
    "served_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestForm" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "blueprint_id" UUID NOT NULL,
    "item_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'BUFFERED',
    "used_by" UUID,
    "assembled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "TestForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "tier" "SmeTier" NOT NULL,
    "version_id" UUID NOT NULL,
    "requisition_id" UUID,
    "state" "CertificationState" NOT NULL DEFAULT 'NOT_STARTED',
    "completed_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts_used" INTEGER NOT NULL DEFAULT 0,
    "retake_available_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "licence_required" BOOLEAN NOT NULL DEFAULT false,
    "licence" JSONB,
    "licence_status" TEXT,
    "licence_decided_by" UUID,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "decided_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "certification_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "form_id" UUID NOT NULL,
    "item_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "identity_check" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "answers" JSONB NOT NULL DEFAULT '{}',
    "integrity_events" JSONB NOT NULL DEFAULT '[]',
    "grading" JSONB NOT NULL DEFAULT '{}',
    "score" DECIMAL(5,2),
    "section_scores" JSONB NOT NULL DEFAULT '{}',
    "result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmeStanding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "tier" "SmeTier" NOT NULL,
    "standing" "SmeStandingState" NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmeStanding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuidelinesPackage_client_id_domain_task_family_key" ON "GuidelinesPackage"("client_id", "domain", "task_family");

-- CreateIndex
CREATE UNIQUE INDEX "GuidelinesVersion_package_id_version_key" ON "GuidelinesVersion"("package_id", "version");

-- CreateIndex
CREATE INDEX "KnowledgeItem_version_id_idx" ON "KnowledgeItem"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "Course_version_id_tier_key" ON "Course"("version_id", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "CourseModule_course_id_position_key" ON "CourseModule"("course_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationBlueprint_version_id_tier_key" ON "CertificationBlueprint"("version_id", "tier");

-- CreateIndex
CREATE INDEX "ItemFamily_blueprint_id_status_idx" ON "ItemFamily"("blueprint_id", "status");

-- CreateIndex
CREATE INDEX "ItemInstance_family_id_status_idx" ON "ItemInstance"("family_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ItemInstance_family_id_fingerprint_key" ON "ItemInstance"("family_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "TestForm_used_by_key" ON "TestForm"("used_by");

-- CreateIndex
CREATE INDEX "TestForm_blueprint_id_status_idx" ON "TestForm"("blueprint_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_sme_user_id_domain_tier_version_id_key" ON "Certification"("sme_user_id", "domain", "tier", "version_id");

-- CreateIndex
CREATE UNIQUE INDEX "TestAttempt_certification_id_attempt_no_key" ON "TestAttempt"("certification_id", "attempt_no");

-- CreateIndex
CREATE INDEX "SmeStanding_sme_user_id_domain_created_at_idx" ON "SmeStanding"("sme_user_id", "domain", "created_at");

-- AddForeignKey
ALTER TABLE "GuidelinesVersion" ADD CONSTRAINT "GuidelinesVersion_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "GuidelinesPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "GuidelinesVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "GuidelinesVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "GuidelinesVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationBlueprint" ADD CONSTRAINT "CertificationBlueprint_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "GuidelinesVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemFamily" ADD CONSTRAINT "ItemFamily_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "CertificationBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "ItemFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestForm" ADD CONSTRAINT "TestForm_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "CertificationBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Standing history is append-only (every change is a new row).
CREATE TRIGGER "SmeStanding_append_only" BEFORE UPDATE OR DELETE ON "SmeStanding" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "SmeStanding_no_truncate" BEFORE TRUNCATE ON "SmeStanding" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "SmeStanding" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "SmeStanding" FROM CURRENT_USER;
