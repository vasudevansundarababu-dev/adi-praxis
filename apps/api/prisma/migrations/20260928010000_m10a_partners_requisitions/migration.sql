-- CreateEnum
CREATE TYPE "SmeTier" AS ENUM ('EXPERT', 'REVIEWER_SME', 'ANNOTATOR');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PartnerEnvironment" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "RequisitionState" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'FILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionState" AS ENUM ('RECEIVED', 'DUPLICATE', 'INVITED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ScreenState" AS ENUM ('NOT_RUN', 'MEETS', 'DOES_NOT_MEET_RECOMMENDED', 'UNCLEAR', 'CONFIRMED_NOT_MET');

-- CreateEnum
CREATE TYPE "SubmissionChannel" AS ENUM ('PARTNER_API', 'PARTNER_PORTAL', 'DIRECT');

-- AlterEnum
ALTER TYPE "ActorType" ADD VALUE 'PARTNER';

-- AlterEnum
ALTER TYPE "SessionAudience" ADD VALUE 'PARTNER';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sme_supply_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "partner_user_id" UUID;

-- CreateTable
CREATE TABLE "Partner" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "business_verification" TEXT NOT NULL DEFAULT 'PENDING',
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_tiers" "SmeTier"[] DEFAULT ARRAY[]::"SmeTier"[],
    "fee_terms_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerClient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "environment" "PartnerEnvironment" NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAccessToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_ref" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerWebhook" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "events" TEXT[],
    "environment" "PartnerEnvironment" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerWebhookDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "webhook_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "replay_of_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requisition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "domain" TEXT NOT NULL,
    "tier" "SmeTier" NOT NULL,
    "headcount" INTEGER NOT NULL,
    "start_date" DATE,
    "duration_weeks" INTEGER,
    "hours_per_week" INTEGER,
    "location" TEXT,
    "jurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minimum_requirements" JSONB NOT NULL DEFAULT '{}',
    "guidelines_package_id" UUID,
    "guidelines_version" INTEGER,
    "rate_card_id" UUID,
    "allowed_partner_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "direct_channel" BOOLEAN NOT NULL DEFAULT false,
    "submission_deadline" TIMESTAMP(3),
    "max_per_partner" INTEGER,
    "state" "RequisitionState" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyCandidate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "email_norm" TEXT NOT NULL,
    "phone_norm" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "sme_user_id" UUID,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSubmission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "partner_id" UUID,
    "requisition_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "channel" "SubmissionChannel" NOT NULL,
    "partner_ref" TEXT,
    "state" "SubmissionState" NOT NULL DEFAULT 'RECEIVED',
    "screen" "ScreenState" NOT NULL DEFAULT 'NOT_RUN',
    "screen_reasons" JSONB NOT NULL DEFAULT '[]',
    "screen_decided_by" UUID,
    "duplicate_reason" TEXT,
    "owner_until" TIMESTAMP(3),
    "details" JSONB NOT NULL DEFAULT '{}',
    "cv_storage_key" TEXT,
    "invite_token_hash" TEXT,
    "invited_at" TIMESTAMP(3),
    "invite_expires_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "invite_accepted_at" TIMESTAMP(3),
    "enrollment_id" UUID,
    "ended_at" TIMESTAMP(3),
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateStateEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "dimension" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateStateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_client_id_name_key" ON "Partner"("client_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_email_key" ON "PartnerUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerClient_public_id_key" ON "PartnerClient"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccessToken_token_hash_key" ON "PartnerAccessToken"("token_hash");

-- CreateIndex
CREATE INDEX "PartnerAccessToken_expires_at_idx" ON "PartnerAccessToken"("expires_at");

-- CreateIndex
CREATE INDEX "PartnerWebhookDelivery_status_next_attempt_at_idx" ON "PartnerWebhookDelivery"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "Requisition_project_id_idx" ON "Requisition"("project_id");

-- CreateIndex
CREATE INDEX "Requisition_state_idx" ON "Requisition"("state");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCandidate_sme_user_id_key" ON "SupplyCandidate"("sme_user_id");

-- CreateIndex
CREATE INDEX "SupplyCandidate_client_id_sandbox_phone_norm_idx" ON "SupplyCandidate"("client_id", "sandbox", "phone_norm");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCandidate_client_id_sandbox_email_norm_key" ON "SupplyCandidate"("client_id", "sandbox", "email_norm");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSubmission_invite_token_hash_key" ON "PartnerSubmission"("invite_token_hash");

-- CreateIndex
CREATE INDEX "PartnerSubmission_candidate_id_idx" ON "PartnerSubmission"("candidate_id");

-- CreateIndex
CREATE INDEX "PartnerSubmission_requisition_id_state_idx" ON "PartnerSubmission"("requisition_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSubmission_partner_id_partner_ref_key" ON "PartnerSubmission"("partner_id", "partner_ref");

-- CreateIndex
CREATE INDEX "CandidateStateEvent_submission_id_at_idx" ON "CandidateStateEvent"("submission_id", "at");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "PartnerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerUser" ADD CONSTRAINT "PartnerUser_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerClient" ADD CONSTRAINT "PartnerClient_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAccessToken" ADD CONSTRAINT "PartnerAccessToken_client_ref_fkey" FOREIGN KEY ("client_ref") REFERENCES "PartnerClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerWebhook" ADD CONSTRAINT "PartnerWebhook_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerWebhookDelivery" ADD CONSTRAINT "PartnerWebhookDelivery_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "PartnerWebhook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSubmission" ADD CONSTRAINT "PartnerSubmission_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSubmission" ADD CONSTRAINT "PartnerSubmission_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "Requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSubmission" ADD CONSTRAINT "PartnerSubmission_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "SupplyCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateStateEvent" ADD CONSTRAINT "CandidateStateEvent_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "PartnerSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only: the candidate state history shown to partners (as for the M6 tables).
CREATE TRIGGER "CandidateStateEvent_append_only" BEFORE UPDATE OR DELETE ON "CandidateStateEvent" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "CandidateStateEvent_no_truncate" BEFORE TRUNCATE ON "CandidateStateEvent" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "CandidateStateEvent" FROM PUBLIC;
