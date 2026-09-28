-- CreateEnum
CREATE TYPE "PayRoute" AS ENUM ('DIRECT', 'VIA_PARTNER');

-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('TASK', 'RL_REVIEW', 'HOURS', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PayeeStatus" AS ENUM ('NOT_REQUIRED', 'NOT_STARTED', 'PENDING', 'READY', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'APPROVED', 'SUBMITTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutItemStatus" AS ENUM ('PENDING', 'HELD', 'SUBMITTED', 'PAID', 'FAILED', 'RETURNED');

-- AlterEnum
ALTER TYPE "InternalRole" ADD VALUE 'FINANCE';

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "certified_fee" DECIMAL(12,2),
ADD COLUMN     "fee_currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Requisition" ADD COLUMN     "pay_route" "PayRoute" NOT NULL DEFAULT 'DIRECT';

-- CreateTable
CREATE TABLE "RateCard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "per_task" JSONB NOT NULL,
    "hourly_rate" DECIMAL(12,2),
    "weekly_cap" DECIMAL(12,2),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" "EarningKind" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "requisition_id" UUID,
    "rate_card_id" UUID,
    "rate_card_version" INTEGER,
    "reverses_id" UUID,
    "reason" TEXT,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "payee_ref" TEXT,
    "status" "PayeeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "payout_currency" TEXT,
    "status_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayHold" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "released_at" TIMESTAMP(3),
    "released_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMP(3),
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "provider_batch_ref" TEXT,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "pay_run_id" UUID NOT NULL,
    "sme_user_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "entry_ids" TEXT[],
    "status" "PayoutItemStatus" NOT NULL DEFAULT 'PENDING',
    "hold_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "provider_payment_ref" TEXT,
    "fx" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutProviderEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutException" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "payment_ref" TEXT NOT NULL,
    "payout_item_id" UUID,
    "detail" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerFeeEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "certification_id" UUID,
    "submission_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "fee_terms_version" TEXT,
    "reverses_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerFeeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerStatement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "totals" JSONB NOT NULL,
    "entry_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateCard_client_id_name_version_key" ON "RateCard"("client_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EarningEntry_reverses_id_key" ON "EarningEntry"("reverses_id");

-- CreateIndex
CREATE INDEX "EarningEntry_sme_user_id_earned_at_idx" ON "EarningEntry"("sme_user_id", "earned_at");

-- CreateIndex
CREATE UNIQUE INDEX "EarningEntry_source_type_source_id_kind_key" ON "EarningEntry"("source_type", "source_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Payee_sme_user_id_key" ON "Payee"("sme_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payee_provider_payee_ref_key" ON "Payee"("provider", "payee_ref");

-- CreateIndex
CREATE INDEX "PayHold_sme_user_id_released_at_idx" ON "PayHold"("sme_user_id", "released_at");

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_client_id_period_start_key" ON "PayRun"("client_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_idempotency_key_key" ON "PayoutItem"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_provider_payment_ref_key" ON "PayoutItem"("provider_payment_ref");

-- CreateIndex
CREATE INDEX "PayoutItem_sme_user_id_idx" ON "PayoutItem"("sme_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutProviderEvent_provider_event_id_key" ON "PayoutProviderEvent"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutException_report_date_kind_payment_ref_key" ON "PayoutException"("report_date", "kind", "payment_ref");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerFeeEntry_reverses_id_key" ON "PartnerFeeEntry"("reverses_id");

-- CreateIndex
CREATE INDEX "PartnerFeeEntry_partner_id_created_at_idx" ON "PartnerFeeEntry"("partner_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerFeeEntry_partner_id_certification_id_key" ON "PartnerFeeEntry"("partner_id", "certification_id");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerStatement_partner_id_period_key" ON "PartnerStatement"("partner_id", "period");

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_pay_run_id_fkey" FOREIGN KEY ("pay_run_id") REFERENCES "PayRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only ledgers (docs/SME-SUPPLY.md section 13): no UPDATE, DELETE or TRUNCATE, enforced in the database.
CREATE TRIGGER "EarningEntry_append_only" BEFORE UPDATE OR DELETE ON "EarningEntry" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "EarningEntry_no_truncate" BEFORE TRUNCATE ON "EarningEntry" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "EarningEntry" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "EarningEntry" FROM CURRENT_USER;
CREATE TRIGGER "PartnerFeeEntry_append_only" BEFORE UPDATE OR DELETE ON "PartnerFeeEntry" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "PartnerFeeEntry_no_truncate" BEFORE TRUNCATE ON "PartnerFeeEntry" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "PartnerFeeEntry" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "PartnerFeeEntry" FROM CURRENT_USER;
