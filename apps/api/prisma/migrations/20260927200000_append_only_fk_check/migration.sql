-- Foreign-key checks lock the referenced row (SELECT ... FOR KEY SHARE) as the table owner, which needs UPDATE on at
-- least one column. The m6 migration revoked UPDATE from the owner, so on a non-superuser owner (Cloud SQL) inserting a
-- QualificationScope (-> SelectionDecision) or a superseding ApprovedTaskRecord failed with "permission denied".
-- Granting UPDATE on the id column alone restores the check; the append-only trigger still rejects every UPDATE/DELETE.
GRANT UPDATE ("id") ON "SelectionDecision" TO CURRENT_USER;
GRANT UPDATE ("id") ON "ApprovedTaskRecord" TO CURRENT_USER;
