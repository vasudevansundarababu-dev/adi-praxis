-- Generated job descriptions (owner, 12 Nov 2026): JDs written from the template's skills and the project's
-- demographics, plus a reviewer JD (more years of experience) for the SME -> Expert -> PM route.
CREATE TYPE "JdRole" AS ENUM ('AUTHOR', 'REVIEWER');

ALTER TABLE "JobDescription"
  ADD COLUMN "role" "JdRole" NOT NULL DEFAULT 'AUTHOR',
  ADD COLUMN "generated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "project_id" UUID,
  ADD COLUMN "mandatory_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "min_experience_years" INTEGER,
  ADD COLUMN "education_level" TEXT,
  ADD COLUMN "demographic_profile" JSONB NOT NULL DEFAULT '[]';

-- One generated JD per project and role.
CREATE UNIQUE INDEX "JobDescription_project_id_role_key" ON "JobDescription"("project_id", "role");

-- A generated JD keeps every mandatory skill among its skills.
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_mandatory_skills_kept" CHECK ("skills" @> "mandatory_skills");

ALTER TABLE "Project"
  ADD COLUMN "reviewer_job_description_id" UUID,
  ADD COLUMN "reviewer_jd_snapshot" JSONB,
  ADD COLUMN "jd_generated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Project" ADD CONSTRAINT "Project_reviewer_job_description_id_fkey"
  FOREIGN KEY ("reviewer_job_description_id") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
