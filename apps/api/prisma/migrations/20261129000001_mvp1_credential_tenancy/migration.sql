-- Tenancy: every business table carries client_id (infra test). Both tables are new and still empty (not used yet).
ALTER TABLE "CandidateCredential" ADD COLUMN "client_id" UUID NOT NULL;
ALTER TABLE "CandidatePasswordToken" ADD COLUMN "client_id" UUID NOT NULL;
