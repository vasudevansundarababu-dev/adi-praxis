-- E-001 §6b (owner, 24 Nov 2026): edge-case variant outcomes are written by SMEs (or the owner acting as Admin for an
-- SME) in one batch the PM sends, then written to Studio (outcome-request.v1). New tables only; nothing existing changes.
CREATE TABLE "OutcomeBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "studio_template_id" TEXT NOT NULL,
    "studio_version" INTEGER NOT NULL,
    "catalog_revision" INTEGER,
    "request_id" TEXT NOT NULL,
    "answerer_kind" TEXT NOT NULL,
    "assignee_sme_user_id" UUID,
    "second_check" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "due_by" DATE,
    "state" TEXT NOT NULL DEFAULT 'open',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "send_outcome" TEXT,
    "send_response" JSONB,
    "request_sha256" TEXT,
    CONSTRAINT "OutcomeBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutcomeBatch_answerer_check" CHECK ("answerer_kind" IN ('sme', 'admin')),
    CONSTRAINT "OutcomeBatch_state_check" CHECK ("state" IN ('open', 'awaiting_check', 'sent', 'send_failed'))
);
CREATE UNIQUE INDEX "OutcomeBatch_request_id_key" ON "OutcomeBatch"("request_id");
CREATE INDEX "OutcomeBatch_project_id_created_at_idx" ON "OutcomeBatch"("project_id", "created_at");
CREATE INDEX "OutcomeBatch_assignee_sme_user_id_idx" ON "OutcomeBatch"("assignee_sme_user_id");

CREATE TABLE "OutcomeBatchItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "family_id" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "boundary" TEXT,
    "proposed_outcome" JSONB,
    "answer" JSONB,
    "answered_by_id" UUID,
    "answered_by_kind" TEXT,
    "answered_at" TIMESTAMP(3),
    "checked_by_id" UUID,
    "checked_by_kind" TEXT,
    "checked_at" TIMESTAMP(3),
    CONSTRAINT "OutcomeBatchItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutcomeBatchItem_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "OutcomeBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OutcomeBatchItem_batch_id_variant_id_key" ON "OutcomeBatchItem"("batch_id", "variant_id");
