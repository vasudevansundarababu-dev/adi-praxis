-- Reviewer job post (owner, 12 Nov 2026): one opportunity per project and role. Existing posts recruit authors.
ALTER TABLE "Opportunity" ADD COLUMN "role" "JdRole" NOT NULL DEFAULT 'AUTHOR';
DROP INDEX "Opportunity_project_id_key";
CREATE UNIQUE INDEX "Opportunity_project_id_role_key" ON "Opportunity"("project_id", "role");
