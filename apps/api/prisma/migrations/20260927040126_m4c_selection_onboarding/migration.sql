-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "decision_message" TEXT,
ADD COLUMN     "information_request" TEXT,
ADD COLUMN     "review_request_reason" TEXT;

-- AlterTable
ALTER TABLE "OnboardingAcknowledgement" ADD COLUMN     "data" JSONB;

-- AlterTable
ALTER TABLE "SmeAssignment" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "handoff_expires_at" TIMESTAMP(3),
ADD COLUMN     "handoff_token_hash" TEXT,
ADD COLUMN     "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "responded_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectReviewer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "placeholder" BOOLEAN NOT NULL DEFAULT false,
    "published_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReviewer_project_id_user_id_key" ON "ProjectReviewer"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "TermsDocument_client_id_key_version_key" ON "TermsDocument"("client_id", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SmeAssignment_handoff_token_hash_key" ON "SmeAssignment"("handoff_token_hash");

-- AddForeignKey
ALTER TABLE "ProjectReviewer" ADD CONSTRAINT "ProjectReviewer_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReviewer" ADD CONSTRAINT "ProjectReviewer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

