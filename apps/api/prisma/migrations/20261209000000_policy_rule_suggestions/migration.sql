-- KYC Judgment v1 A1/A2 (owner, 25 Nov 2026: "Accept recommendations"): AI suggestions for one exact rule version
-- (dispositions, conditions, scope, jurisdiction), kept with the server's checks. Only a PM adopts one, as a rule edit.
-- Additive. Append-only.
CREATE TABLE "PolicyRuleSuggestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyRuleSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyRuleSuggestion_source_check" CHECK ("source" IN ('disposition', 'enrichment'))
);
CREATE UNIQUE INDEX "PolicyRuleSuggestion_rule_version_id_content_hash_source_prompt_version_model_key" ON "PolicyRuleSuggestion"("rule_version_id", "content_hash", "source", "prompt_version", "model");
CREATE INDEX "PolicyRuleSuggestion_project_id_created_at_idx" ON "PolicyRuleSuggestion"("project_id", "created_at");
CREATE INDEX "PolicyRuleSuggestion_rule_id_idx" ON "PolicyRuleSuggestion"("rule_id");
CREATE TRIGGER "PolicyRuleSuggestion_append_only" BEFORE UPDATE OR DELETE ON "PolicyRuleSuggestion" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyRuleSuggestion_no_truncate" BEFORE TRUNCATE ON "PolicyRuleSuggestion" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyRuleSuggestion" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyRuleSuggestion" FROM CURRENT_USER;
