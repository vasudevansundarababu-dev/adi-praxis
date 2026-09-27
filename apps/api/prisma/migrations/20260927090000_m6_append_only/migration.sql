-- AlterTable
ALTER TABLE "RLReviewRecord" DROP COLUMN "delivered_at",
ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RLReviewRecord_seq_key" ON "RLReviewRecord"("seq");


-- Append-only enforcement (SPEC: Approved Task Dataset "sacrosanct rules"; CLAUDE.md non-negotiables).
-- Enforced by the database, not application code: a trigger rejects UPDATE and DELETE, TRUNCATE needs an explicit
-- session opt-in (test resets only), and UPDATE/DELETE privileges are revoked from the application role.
CREATE OR REPLACE FUNCTION praxis_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table "%": % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION praxis_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('praxis.allow_truncate', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'append-only table "%": TRUNCATE is not allowed', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ApprovedTaskRecord', 'RLReviewRecord', 'AuditEvent', 'SelectionDecision', 'TaskReview'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION praxis_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION praxis_no_truncate()', t || '_no_truncate', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM CURRENT_USER', t);
  END LOOP;
END;
$$;
