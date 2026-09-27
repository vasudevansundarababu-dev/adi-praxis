-- CreateEnum
CREATE TYPE "TaskSourceKind" AS ENUM ('DOCUMENT', 'TRANSCRIPT');

-- CreateEnum
CREATE TYPE "TaskDraftRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "TaskInstance" ADD COLUMN     "drafting" JSONB;

-- AlterTable (additive: append-only rows are not updated; older rows keep NULL)
ALTER TABLE "ApprovedTaskRecord" ADD COLUMN     "provenance" JSONB;

-- CreateTable
CREATE TABLE "TaskSource" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "kind" "TaskSourceKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "text_chars" INTEGER NOT NULL,
    "scan_flags" JSONB NOT NULL DEFAULT '[]',
    "scan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploaded_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInterviewTurn" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "client_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskInterviewTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDraftRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "section" TEXT,
    "instruction" TEXT,
    "status" "TaskDraftRunStatus" NOT NULL DEFAULT 'QUEUED',
    "source_ids" TEXT[],
    "interview_turns" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "problems" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "error" TEXT,
    "requested_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDraftRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSource_storage_key_key" ON "TaskSource"("storage_key");

-- CreateIndex
CREATE INDEX "TaskSource_task_instance_id_idx" ON "TaskSource"("task_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInterviewTurn_task_instance_id_seq_key" ON "TaskInterviewTurn"("task_instance_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInterviewTurn_task_instance_id_client_message_id_key" ON "TaskInterviewTurn"("task_instance_id", "client_message_id");

-- CreateIndex
CREATE INDEX "TaskDraftRun_task_instance_id_created_at_idx" ON "TaskDraftRun"("task_instance_id", "created_at");

-- AddForeignKey
ALTER TABLE "TaskSource" ADD CONSTRAINT "TaskSource_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInterviewTurn" ADD CONSTRAINT "TaskInterviewTurn_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDraftRun" ADD CONSTRAINT "TaskDraftRun_task_instance_id_fkey" FOREIGN KEY ("task_instance_id") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

