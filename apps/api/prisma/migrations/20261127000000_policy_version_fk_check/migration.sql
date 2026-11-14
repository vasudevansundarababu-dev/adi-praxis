-- Same fix as 20260927200000_append_only_fk_check, for the policy tables. Foreign-key checks lock the referenced row
-- (SELECT ... FOR KEY SHARE) as the table owner, which needs UPDATE on at least one column. 20261110000000_policy_rules
-- revoked UPDATE on PolicyDocumentVersion from the owner, so on a non-superuser owner (Cloud SQL) creating an
-- ExtractionJob or a PolicyCitation failed with "permission denied for table PolicyDocumentVersion" (QA, 14 Nov 2026).
-- Granting UPDATE on the id column alone restores the check; the append-only trigger still rejects every UPDATE/DELETE.
GRANT UPDATE ("id") ON "PolicyDocumentVersion" TO CURRENT_USER;
