-- E-002 §4.1 and owner decision 9.1 (23 Nov 2026): the project scope's fact catalog (fact-catalog.v1, owner kind
-- project_scope), frozen and versioned. Clause conditions are checked against its latest version. Append-only.
CREATE TABLE "ProjectFactCatalog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "catalog" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFactCatalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectFactCatalog_project_id_version_key" ON "ProjectFactCatalog"("project_id", "version");
CREATE TRIGGER "ProjectFactCatalog_append_only" BEFORE UPDATE OR DELETE ON "ProjectFactCatalog" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "ProjectFactCatalog_no_truncate" BEFORE TRUNCATE ON "ProjectFactCatalog" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "ProjectFactCatalog" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ProjectFactCatalog" FROM CURRENT_USER;

-- E-001 decision Q4 (owner, 23 Nov 2026): after a task has been held 3 days waiting for a new case kind, the PM chases
-- it or releases the task (its edge-case focus is dropped and it exports as a normal case). A release is recorded, never
-- edited. Held tasks stay visible until then and are never lost.
CREATE TABLE "TaskHoldRelease" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_instance_id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "released_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskHoldRelease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskHoldRelease_reason_check" CHECK (length(btrim("reason")) > 0)
);
CREATE INDEX "TaskHoldRelease_task_instance_id_idx" ON "TaskHoldRelease"("task_instance_id");
CREATE TRIGGER "TaskHoldRelease_append_only" BEFORE UPDATE OR DELETE ON "TaskHoldRelease" FOR EACH ROW EXECUTE FUNCTION praxis_append_only();
CREATE TRIGGER "TaskHoldRelease_no_truncate" BEFORE TRUNCATE ON "TaskHoldRelease" FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate();
REVOKE UPDATE, DELETE ON "TaskHoldRelease" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "TaskHoldRelease" FROM CURRENT_USER;
