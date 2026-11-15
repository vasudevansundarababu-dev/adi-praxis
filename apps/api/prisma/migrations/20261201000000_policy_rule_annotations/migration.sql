-- Policy rule annotations (docs/prd/PRD-POLICY-RULE-ANNOTATIONS.md). Additive: no existing column or row changes.

-- CreateEnum
CREATE TYPE "PolicyAnnotationSource" AS ENUM ('AI_SUGGESTION', 'AUTHOR_EDIT');

-- CreateTable
CREATE TABLE "PolicyRuleAnnotationRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "annotation_version" INTEGER NOT NULL,
    "source" "PolicyAnnotationSource" NOT NULL,
    "annotation" JSONB NOT NULL,
    "adopted" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "prompt_version" TEXT,
    "edited_by_id" TEXT NOT NULL,
    "edited_role" TEXT,
    "based_on_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRuleAnnotationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRuleAnnotationRevision_rule_id_annotation_version_key" ON "PolicyRuleAnnotationRevision"("rule_id", "annotation_version");

-- CreateIndex
CREATE INDEX "PolicyRuleAnnotationRevision_client_id_rule_id_idx" ON "PolicyRuleAnnotationRevision"("client_id", "rule_id");

-- AddForeignKey
ALTER TABLE "PolicyRuleAnnotationRevision" ADD CONSTRAINT "PolicyRuleAnnotationRevision_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "PolicyRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: the original AI suggestion and every author edit are kept as written.
CREATE TRIGGER "PolicyRuleAnnotationRevision_append_only" BEFORE UPDATE OR DELETE ON "PolicyRuleAnnotationRevision" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PolicyRuleAnnotationRevision_no_truncate" BEFORE TRUNCATE ON "PolicyRuleAnnotationRevision" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PolicyRuleAnnotationRevision" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PolicyRuleAnnotationRevision" FROM CURRENT_USER;
