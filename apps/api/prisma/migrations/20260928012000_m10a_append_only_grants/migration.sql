-- As in the M6 migration: the owner loses UPDATE and DELETE on the append-only candidate history (the trigger also
-- rejects them). Nothing references this table, so foreign-key checks are unaffected.
REVOKE UPDATE, DELETE ON "CandidateStateEvent" FROM CURRENT_USER;
