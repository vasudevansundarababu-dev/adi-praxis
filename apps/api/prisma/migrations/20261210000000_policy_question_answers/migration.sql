-- Owner and Jose, 27 Nov 2026: "We can answer the question in a text box. Use AI to decipher the answer and fill the
-- fields." An open question's answer, stored verbatim with who answered and when, and (when asked) the AI's proposed
-- field changes and their cost. Proposals are never applied here: the reviewer accepts them as an ordinary rule edit.
-- Additive. Append-only.
CREATE TABLE "PolicyQuestionAnswer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "answered_by_id" UUID NOT NULL,
    "ai_status" TEXT NOT NULL DEFAULT 'none',
    "ai_model" TEXT,
    "ai_prompt_version" TEXT,
    "ai_proposal" JSONB,
    "ai_message" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyQuestionAnswer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyQuestionAnswer_ai_status_check" CHECK ("ai_status" IN ('none', 'proposed', 'unmapped', 'failed', 'paused')),
    CONSTRAINT "PolicyQuestionAnswer_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "PolicyRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PolicyQuestionAnswer_rule_id_idx" ON "PolicyQuestionAnswer"("rule_id");
CREATE INDEX "PolicyQuestionAnswer_client_id_created_at_idx" ON "PolicyQuestionAnswer"("client_id", "created_at");
CREATE TRIGGER "PolicyQuestionAnswer_append_only" BEFORE UPDATE OR DELETE ON "PolicyQuestionAnswer" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyQuestionAnswer_no_truncate" BEFORE TRUNCATE ON "PolicyQuestionAnswer" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyQuestionAnswer" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyQuestionAnswer" FROM CURRENT_USER;
