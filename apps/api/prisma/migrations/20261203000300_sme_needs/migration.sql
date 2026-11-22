-- New RL Gym part 4 (docs/design/FORGE-RLGYM-V2-DESIGN.md): SME needs. An author, a Reviewer or the PM raises a need
-- (more data, or a new kind of case); the PM sends one or more needs to Studio's next-version inbox, rejects them, or
-- marks them resolved. All append-only.
CREATE TABLE "SmeNeed" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "raised_by_kind" TEXT NOT NULL,
    "raised_by_id" UUID NOT NULL,
    "source" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmeNeed_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmeNeed_kind_check" CHECK ("kind" IN ('more_data', 'new_case_kind')),
    CONSTRAINT "SmeNeed_raised_by_kind_check" CHECK ("raised_by_kind" IN ('AUTHOR', 'REVIEWER', 'PM')),
    CONSTRAINT "SmeNeed_note_check" CHECK (length(btrim("note")) > 0)
);
CREATE INDEX "SmeNeed_project_id_created_at_idx" ON "SmeNeed"("project_id", "created_at");

CREATE TABLE "SmeNeedClosure" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "closed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmeNeedClosure_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmeNeedClosure_kind_check" CHECK ("kind" IN ('REJECTED', 'RESOLVED')),
    CONSTRAINT "SmeNeedClosure_reason_check" CHECK (length(btrim("reason")) > 0)
);
-- A need is closed once.
CREATE UNIQUE INDEX "SmeNeedClosure_need_id_key" ON "SmeNeedClosure"("need_id");

CREATE TABLE "SmeNeedSend" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "need_ids" UUID[] NOT NULL,
    "kind" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "studio_item_id" TEXT,
    "http_status" INTEGER,
    "error" JSONB,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmeNeedSend_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmeNeedSend_outcome_check" CHECK ("outcome" IN ('received', 'rejected', 'unavailable')),
    CONSTRAINT "SmeNeedSend_kind_check" CHECK ("kind" IN ('more_data', 'new_case_kind'))
);
CREATE INDEX "SmeNeedSend_project_id_created_at_idx" ON "SmeNeedSend"("project_id", "created_at");

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['SmeNeed', 'SmeNeedClosure', 'SmeNeedSend'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION praxis_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate()', t || '_no_truncate', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM CURRENT_USER', t);
  END LOOP;
END $$;
