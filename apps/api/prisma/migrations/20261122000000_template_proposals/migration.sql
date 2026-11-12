-- Praxis-Anvil contract (12 Nov 2026): Anvil template proposals and qualification receipts. Append-only.
ALTER TABLE "Template" ADD COLUMN "anvil_spec" JSONB;
CREATE TABLE "TemplateProposal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "api_client_id" UUID NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "template_id" UUID NOT NULL,
    "spec" JSONB NOT NULL,
    "spec_sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TemplateProposal_client_id_created_at_idx" ON "TemplateProposal"("client_id", "created_at");
CREATE TABLE "TemplateQualification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "api_client_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateQualification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TemplateQualification_status_check" CHECK ("status" IN ('QUALIFIED', 'REVOKED'))
);
CREATE INDEX "TemplateQualification_template_id_created_at_idx" ON "TemplateQualification"("template_id", "created_at");
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TemplateProposal', 'TemplateQualification'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION praxis_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate()', t || '_no_truncate', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM CURRENT_USER', t);
  END LOOP;
END $$;
