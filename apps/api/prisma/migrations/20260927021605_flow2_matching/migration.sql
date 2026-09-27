/*
  Warnings:

  - You are about to drop the column `availability` on the `Candidate` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Candidate` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Candidate" DROP COLUMN "availability",
DROP COLUMN "location",
ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" CHAR(2),
ADD COLUMN     "domain_experience_years" DOUBLE PRECISION,
ADD COLUMN     "education_level" TEXT,
ADD COLUMN     "hours_per_week" INTEGER,
ADD COLUMN     "last_validated_at" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "skills" TEXT[],
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "matched_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectMatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMatchRejection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "reason" TEXT,
    "rejected_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMatchRejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMatch_project_id_rank_idx" ON "ProjectMatch"("project_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMatch_project_id_candidate_id_key" ON "ProjectMatch"("project_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMatchRejection_project_id_candidate_id_key" ON "ProjectMatchRejection"("project_id", "candidate_id");

-- CreateIndex
CREATE INDEX "Candidate_country_idx" ON "Candidate"("country");

-- CreateIndex
CREATE INDEX "Candidate_specialties_idx" ON "Candidate" USING GIN ("specialties");

-- AddForeignKey
ALTER TABLE "ProjectMatch" ADD CONSTRAINT "ProjectMatch_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMatch" ADD CONSTRAINT "ProjectMatch_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMatchRejection" ADD CONSTRAINT "ProjectMatchRejection_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMatchRejection" ADD CONSTRAINT "ProjectMatchRejection_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Decision 26 Sep 2026 (FLOW2-SME section 9: do not match using age): remove the seeded age-band attribute.
-- Kept if any project already filters on it, so no existing project loses data.
DELETE FROM "DemographicAttribute" a
WHERE a.key = 'age_band'
  AND NOT EXISTS (SELECT 1 FROM "ProjectDemographicFilter" f WHERE f.client_id = a.client_id AND f.attribute_key = 'age_band');
