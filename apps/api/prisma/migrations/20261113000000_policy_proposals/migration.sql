-- Authoring v2.1 Wave 3: SME policy proposals (handover chapter 07).
-- A proposal is pending until an assigned Expert or the project's PM/Admin decides. Its file columns never change,
-- and a decided proposal is frozen: both enforced here, not only in the API.
ALTER TYPE "PolicyDocumentOrigin" ADD VALUE 'SME_PROPOSAL';
CREATE TYPE "PolicyProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RETURNED', 'REJECTED');
CREATE TYPE "PolicyProposalCategory" AS ENUM ('BANK_POLICY', 'CUSTOMER_POLICY', 'REGULATION', 'SUPPORTING_REFERENCE');
CREATE TYPE "PolicyQualification" AS ENUM ('POLICY_CANDIDATE', 'SUPPORTING_REFERENCE', 'UNRELATED', 'UNREADABLE', 'SENSITIVE');

CREATE TABLE "PolicyProposal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_instance_id" UUID,
    "sme_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "PolicyProposalCategory" NOT NULL,
    "issuer" TEXT,
    "version_label" TEXT,
    "language" TEXT,
    "jurisdiction" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "reason" TEXT NOT NULL,
    "rights_declared" BOOLEAN NOT NULL,
    "sha256" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "format" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "storage_key" TEXT NOT NULL,
    "text_storage_key" TEXT,
    "text_chars" INTEGER NOT NULL DEFAULT 0,
    "intake_flags" JSONB NOT NULL DEFAULT '[]',
    "status" "PolicyProposalStatus" NOT NULL DEFAULT 'PENDING',
    "qualification" "PolicyQualification",
    "decision_reason" TEXT,
    "decided_by_id" UUID,
    "decided_role" TEXT,
    "decided_at" TIMESTAMP(3),
    "document_id" UUID,
    "document_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolicyProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyProposal_rights_declared" CHECK ("rights_declared"),
    CONSTRAINT "PolicyProposal_decision_complete" CHECK (
      ("status" = 'PENDING' AND "decided_at" IS NULL AND "qualification" IS NULL)
      OR ("status" <> 'PENDING' AND "decided_at" IS NOT NULL AND "decided_by_id" IS NOT NULL AND "qualification" IS NOT NULL AND "decision_reason" IS NOT NULL)
    ),
    CONSTRAINT "PolicyProposal_accept_links_document" CHECK ("status" <> 'ACCEPTED' OR "document_version_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "PolicyProposal_storage_key_key" ON "PolicyProposal"("storage_key");
CREATE INDEX "PolicyProposal_client_id_project_id_status_idx" ON "PolicyProposal"("client_id", "project_id", "status");
CREATE INDEX "PolicyProposal_sme_user_id_project_id_idx" ON "PolicyProposal"("sme_user_id", "project_id");
-- One pending proposal per SME, project and file: a re-upload returns the existing one.
CREATE UNIQUE INDEX "PolicyProposal_one_pending_per_file" ON "PolicyProposal"("sme_user_id", "project_id", "sha256") WHERE "status" = 'PENDING';

CREATE FUNCTION policy_proposal_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PolicyProposal rows cannot be deleted';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'PolicyProposal % is decided and cannot change', OLD.id;
  END IF;
  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.text_storage_key IS DISTINCT FROM OLD.text_storage_key OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.sme_user_id IS DISTINCT FROM OLD.sme_user_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'PolicyProposal % file and owner are immutable', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER policy_proposal_guard BEFORE UPDATE OR DELETE ON "PolicyProposal" FOR EACH ROW EXECUTE FUNCTION policy_proposal_guard();
