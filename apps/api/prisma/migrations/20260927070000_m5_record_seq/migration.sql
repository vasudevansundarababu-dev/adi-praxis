-- AlterTable
ALTER TABLE "ApprovedTaskRecord" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedTaskRecord_seq_key" ON "ApprovedTaskRecord"("seq");

