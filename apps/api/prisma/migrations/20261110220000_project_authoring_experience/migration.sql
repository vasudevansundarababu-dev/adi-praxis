CREATE TYPE "AuthoringExperience" AS ENUM ('CLASSIC', 'CHATBOT', 'BOTH');
ALTER TABLE "Project" ADD COLUMN "authoring_experience" "AuthoringExperience";
-- Existing rows remain NULL: audited legacy compatibility with both editors.
