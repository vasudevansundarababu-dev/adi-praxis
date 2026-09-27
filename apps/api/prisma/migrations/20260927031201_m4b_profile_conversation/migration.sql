-- AlterTable
ALTER TABLE "ConversationTurn" ADD COLUMN     "extraction_status" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "redacted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sensitive_kinds" TEXT[];

-- AlterTable
ALTER TABLE "EvidenceArtifact" ADD COLUMN     "filename" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "draft_question_policy" JSONB;

-- AlterTable
ALTER TABLE "ProfileVersion" ADD COLUMN     "enrollment_id" UUID;
