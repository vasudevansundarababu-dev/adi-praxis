-- CreateEnum
CREATE TYPE "OpportunityDocumentStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "clicks" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "IdentityAttempt" ADD COLUMN     "adult_confirmed" BOOLEAN;

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "draft_brief" JSONB,
ADD COLUMN     "draft_criteria" JSONB;

-- CreateTable
CREATE TABLE "OpportunityDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "extracted_text" TEXT NOT NULL,
    "confirmed_text" TEXT,
    "status" "OpportunityDocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "uploaded_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpportunityDocument_opportunity_id_idx" ON "OpportunityDocument"("opportunity_id");

-- AddForeignKey
ALTER TABLE "OpportunityDocument" ADD CONSTRAINT "OpportunityDocument_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
