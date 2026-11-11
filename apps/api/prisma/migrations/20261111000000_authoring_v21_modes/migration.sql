-- Authoring v2.1: template-fixed agent mode and the project's platform review route.
CREATE TYPE "AgentMode" AS ENUM ('SINGLE', 'MULTI');
CREATE TYPE "ReviewRoute" AS ENUM ('SME_PM', 'SME_EXPERT_PM');
ALTER TABLE "Template" ADD COLUMN "agent_mode" "AgentMode" NOT NULL DEFAULT 'SINGLE';
-- Existing projects keep today's one-stage review, which is the SME -> PM route.
ALTER TABLE "Project" ADD COLUMN "review_route" "ReviewRoute" NOT NULL DEFAULT 'SME_PM';
