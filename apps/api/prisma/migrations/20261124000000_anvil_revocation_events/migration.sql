-- Anvil's four confirmations (11 Nov 2026), point 4: revocation events delivered to the qualifications endpoint.
-- Append-only: one row per distinct event; a repeat is acknowledged without a new row.
CREATE TABLE "AnvilRevocationEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "api_client_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "anvil_project_id" UUID NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "template_id" UUID NOT NULL,
    "event_sha256" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnvilRevocationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnvilRevocationEvent_outcome_check" CHECK ("outcome" IN ('applied', 'already_applied'))
);
CREATE UNIQUE INDEX "AnvilRevocationEvent_event_id_key" ON "AnvilRevocationEvent"("event_id");
CREATE UNIQUE INDEX "AnvilRevocationEvent_environment_anvil_project_id_sequence_key" ON "AnvilRevocationEvent"("environment", "anvil_project_id", "sequence");
CREATE INDEX "AnvilRevocationEvent_receipt_id_idx" ON "AnvilRevocationEvent"("receipt_id");
CREATE TRIGGER "AnvilRevocationEvent_append_only" BEFORE UPDATE OR DELETE ON "AnvilRevocationEvent" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "AnvilRevocationEvent_no_truncate" BEFORE TRUNCATE ON "AnvilRevocationEvent" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "AnvilRevocationEvent" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "AnvilRevocationEvent" FROM CURRENT_USER;

-- Generic Anvil export (praxis.authored-task-export.v1): the packages sent and Anvil's resolution, kept with the run.
ALTER TABLE "ProjectValidationRun" ADD COLUMN "anvil" JSONB;
