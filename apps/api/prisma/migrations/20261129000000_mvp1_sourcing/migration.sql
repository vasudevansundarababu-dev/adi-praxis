-- CreateEnum
CREATE TYPE "SourcedRole" AS ENUM ('SME', 'REVIEWER');

-- AlterTable
ALTER TABLE "TaskInstance" ADD COLUMN     "reviewer_sme_user_id" UUID;

-- CreateTable
CREATE TABLE "SourcedPerson" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" "SourcedRole" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email_norm" TEXT NOT NULL,
    "linkedin_url" TEXT,
    "cv_storage_key" TEXT,
    "assessment_storage_key" TEXT,
    "assessment" JSONB NOT NULL DEFAULT '{}',
    "agency" TEXT,
    "submitted_by_id" UUID NOT NULL,
    "sme_user_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "assigned_by_id" UUID,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCredential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sme_user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePasswordToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sme_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidatePasswordToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcedPerson_client_id_email_norm_idx" ON "SourcedPerson"("client_id", "email_norm");

-- CreateIndex
CREATE INDEX "SourcedPerson_sme_user_id_idx" ON "SourcedPerson"("sme_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "SourcedPerson_project_id_role_email_norm_key" ON "SourcedPerson"("project_id", "role", "email_norm");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateCredential_sme_user_id_key" ON "CandidateCredential"("sme_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "CandidatePasswordToken_token_hash_key" ON "CandidatePasswordToken"("token_hash");

-- CreateIndex
CREATE INDEX "CandidatePasswordToken_sme_user_id_idx" ON "CandidatePasswordToken"("sme_user_id");

-- AddForeignKey
ALTER TABLE "SourcedPerson" ADD CONSTRAINT "SourcedPerson_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedPerson" ADD CONSTRAINT "SourcedPerson_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCredential" ADD CONSTRAINT "CandidateCredential_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePasswordToken" ADD CONSTRAINT "CandidatePasswordToken_sme_user_id_fkey" FOREIGN KEY ("sme_user_id") REFERENCES "SmeUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

