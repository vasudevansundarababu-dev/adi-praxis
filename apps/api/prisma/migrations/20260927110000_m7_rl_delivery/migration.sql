-- CreateEnum
CREATE TYPE "RLDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'PULL_ONLY');

-- CreateTable
CREATE TABLE "RLResultDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "status" "RLDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_status" INTEGER,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RLResultDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RLResultDelivery_record_id_key" ON "RLResultDelivery"("record_id");

