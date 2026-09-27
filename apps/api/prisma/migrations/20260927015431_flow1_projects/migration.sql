-- AlterEnum
ALTER TYPE "DemographicAttributeType" ADD VALUE 'LANGUAGE_PROFICIENCY';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "figures" JSONB;
