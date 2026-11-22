-- New RL Gym part 2 (docs/design/FORGE-RLGYM-V2-DESIGN.md): one row per press of Export / Re-export, with what was
-- sent (the export body, without package content) and what the RL Gym answered. Append-only.
CREATE TABLE "RlGymProjectExport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "export_id" TEXT NOT NULL,
    "export_sha256" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "tasks" JSONB NOT NULL,
    "not_sent" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "http_status" INTEGER,
    "request_id" TEXT,
    "receipt" JSONB,
    "error" JSONB,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RlGymProjectExport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RlGymProjectExport_outcome_check" CHECK ("outcome" IN ('received', 'rejected', 'unavailable')),
    CONSTRAINT "RlGymProjectExport_sha_check" CHECK ("export_sha256" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "RlGymProjectExport_project_id_created_at_idx" ON "RlGymProjectExport"("project_id", "created_at");
CREATE TRIGGER "RlGymProjectExport_append_only" BEFORE UPDATE OR DELETE ON "RlGymProjectExport" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "RlGymProjectExport_no_truncate" BEFORE TRUNCATE ON "RlGymProjectExport" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "RlGymProjectExport" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "RlGymProjectExport" FROM CURRENT_USER;
